from __future__ import annotations

import asyncio
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

        skipped_routine = client.post("/tasks/claim-next", json={"agent": "codex", "assigneeEmployeeId": "alice"})
        assert skipped_routine.status_code == 200
        assert skipped_routine.json()["task"] is None

        normal = client.post("/tasks", json={
            "title": "Claim normal backlog",
            "ownerEmployeeId": "alice",
            "assigneeEmployeeId": "alice",
            "assignedAgent": "codex",
        })
        assert normal.status_code == 201

        claimed = client.post("/tasks/claim-next", json={"agent": "codex", "assigneeEmployeeId": "alice"})
        assert claimed.status_code == 200
        assert claimed.json()["task"]["id"] == normal.json()["id"]
        assert claimed.json()["task"]["status"] == "running"


def test_assigned_backlog_waits_for_scheduler_and_start_can_dispatch_manually(monkeypatch) -> None:
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
        assert task["status"] == "assigned"
        assert task["linkedSessionIds"] == []

        pending_commands = client.get("/daemon-nodes/sbx_alice/commands", headers={"Authorization": "Bearer node_token"})
        assert pending_commands.status_code == 200
        assert pending_commands.json()["commands"] == []

        started = client.post(f"/tasks/{task['id']}/start", json={"agent": "codex"})
        assert started.status_code == 202
        assert started.json()["session"]["id"]

        commands = client.get("/daemon-nodes/sbx_alice/commands", headers={"Authorization": "Bearer node_token"})
        assert commands.status_code == 200
        [command] = commands.json()["commands"]
        assert command["type"] == "run.start"
        assert command["agent"] == "codex"
        assert command["taskGoal"] == "Run from backlog"


def test_scheduler_dispatches_assigned_backlog_task(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
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
            "title": "Scheduled backlog",
            "ownerEmployeeId": "alice",
            "assigneeEmployeeId": "alice",
            "assignedAgent": "codex",
        })
        assert created.status_code == 201
        assert created.json()["status"] == "assigned"

        result = asyncio.run(app.state.task_scheduler.tick())
        assert result.dispatched == 1

        commands = client.get("/daemon-nodes/sbx_alice/commands", headers={"Authorization": "Bearer node_token"})
        assert commands.status_code == 200
        [command] = commands.json()["commands"]
        assert command["type"] == "run.start"
        assert command["agent"] == "codex"
        assert command["taskGoal"] == "Scheduled backlog"


def test_routine_assignment_does_not_dispatch_definition(monkeypatch) -> None:
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
            "title": "Weekly report",
            "ownerEmployeeId": "alice",
            "assigneeEmployeeId": "alice",
            "assignedAgent": "codex",
            "isRoutine": True,
            "routineCadence": "weekly",
            "routineNextRunDate": "2026-06-25",
            "routineEnabled": True,
        })
        assert created.status_code == 201
        task = created.json()
        assert task["isRoutine"] is True
        assert task["status"] == "assigned"
        assert task["linkedSessionIds"] == []

        start = client.post(f"/tasks/{task['id']}/start", json={"agent": "codex"})
        assert start.status_code == 202
        assert start.json()["session"] is None
        assert start.json()["task"]["status"] == "assigned"

        commands = client.get("/daemon-nodes/sbx_alice/commands", headers={"Authorization": "Bearer node_token"})
        assert commands.status_code == 200
        assert commands.json()["commands"] == []


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
