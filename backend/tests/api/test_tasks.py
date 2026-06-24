from __future__ import annotations

from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from relay.app import create_app


def _bootstrap_admin(client: TestClient) -> None:
    response = client.post("/auth/bootstrap", json={
        "token": "admin_token",
        "username": "admin",
        "password": "secret123",
    })
    assert response.status_code == 200


def _create_user(client: TestClient, username: str, *, employee_id: str) -> None:
    response = client.post("/cp/users", json={
        "username": username,
        "password": "userpass",
        "role": "user",
        "employeeId": employee_id,
    })
    assert response.status_code == 201


def test_task_create_update_and_claim_next(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _create_user(client, "alice", employee_id="alice")

        created = client.post("/tasks", json={
            "title": "Ship backlog",
            "description": "Add the task board.",
            "priority": "high",
            "ownerEmployeeId": "alice",
            "assigneeEmployeeId": "alice",
            "dueDate": "2026-06-30",
            "isRoutine": True,
            "routineType": "job",
            "routineCadence": "weekly",
            "routineNextRunDate": "2026-06-25",
            "routineEnabled": True,
        })
        assert created.status_code == 201
        task = created.json()
        assert task["assigneeEmployeeId"] == "alice"
        assert task["dueDate"] == "2026-06-30"
        assert task["isRoutine"] is True
        assert task["routineType"] == "job"
        assert task["routineCadence"] == "weekly"
        assert task["routineNextRunDate"] == "2026-06-25"
        assert task["routineEnabled"] is True

        updated = client.patch(f"/tasks/{task['id']}", json={
            "priority": "low",
            "assignedAgent": "codex",
            "routineNextRunDate": "2026-07-02",
            "routineEnabled": False,
        })
        assert updated.status_code == 200
        assert updated.json()["assignedAgent"] == "codex"
        assert updated.json()["status"] == "assigned"
        assert updated.json()["routineNextRunDate"] == "2026-07-02"
        assert updated.json()["routineEnabled"] is False

        claimed = client.post("/tasks/claim-next", json={"agent": "codex", "assigneeEmployeeId": "alice"})
        assert claimed.status_code == 200
        assert claimed.json()["task"]["id"] == task["id"]
        assert claimed.json()["task"]["status"] == "running"


def test_task_start_dispatches_to_ready_assignee_node(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _create_user(client, "alice", employee_id="alice")
        registered = client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_alice",
            "employeeId": "alice",
            "token": "node_token",
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})
        assert registered.status_code == 200

        created = client.post("/tasks", json={
            "title": "Run from backlog",
            "ownerEmployeeId": "alice",
            "assigneeEmployeeId": "alice",
            "assignedAgent": "codex",
        })
        assert created.status_code == 201
        task = created.json()
        assert task["status"] == "running"
        assert task["linkedSessionIds"]

        commands = client.get("/daemon-nodes/sbx_alice/commands", headers={"Authorization": "Bearer node_token"})
        assert commands.status_code == 200
        [command] = commands.json()["commands"]
        assert command["type"] == "run.start"
        assert command["agent"] == "codex"
        assert command["taskGoal"] == "Run from backlog"


def test_task_rejects_invalid_due_date(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)

        response = client.post("/tasks", json={"title": "Bad date", "dueDate": "06/30/2026"})

        assert response.status_code == 400
        assert "YYYY-MM-DD" in response.json()["detail"]


def test_task_rejects_invalid_routine_fields(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)

        invalid_type = client.post("/tasks", json={"title": "Bad routine", "isRoutine": True, "routineType": "cron"})
        assert invalid_type.status_code == 400
        assert "routineType" in invalid_type.json()["detail"]

        invalid_cadence = client.post("/tasks", json={"title": "Bad cadence", "isRoutine": True, "routineCadence": "hourly"})
        assert invalid_cadence.status_code == 400
        assert "routineCadence" in invalid_cadence.json()["detail"]

        invalid_date = client.post("/tasks", json={"title": "Bad next run", "isRoutine": True, "routineNextRunDate": "06/30/2026"})
        assert invalid_date.status_code == 400
        assert "YYYY-MM-DD" in invalid_date.json()["detail"]

        invalid_enabled = client.post("/tasks", json={"title": "Bad enabled", "isRoutine": True, "routineEnabled": "yes"})
        assert invalid_enabled.status_code == 400
        assert "routineEnabled" in invalid_enabled.json()["detail"]
