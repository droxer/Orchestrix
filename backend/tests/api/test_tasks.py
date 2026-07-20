from __future__ import annotations

import asyncio
from datetime import date
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from relay.api import task_routes
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


def test_routine_create_defaults_next_run_when_omitted(monkeypatch) -> None:
    class FixedDate(date):
        @classmethod
        def today(cls) -> date:
            return cls(2026, 7, 7)

    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    monkeypatch.setattr(task_routes, "date", FixedDate)
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _create_user(client, "alice", employee_id="alice")

        created = client.post("/tasks", json={
            "title": "Daily routine",
            "ownerEmployeeId": "alice",
            "assigneeEmployeeId": "alice",
            "isRoutine": True,
            "routineCadence": "daily",
        })

        assert created.status_code == 201
        task = created.json()
        assert task["routineNextRunDate"] == "2026-07-08"
        assert task["routineEnabled"] is True

        explicit_unscheduled = client.post("/tasks", json={
            "title": "Manual routine",
            "ownerEmployeeId": "alice",
            "assigneeEmployeeId": "alice",
            "isRoutine": True,
            "routineNextRunDate": "",
        })

        assert explicit_unscheduled.status_code == 201
        assert "routineNextRunDate" not in explicit_unscheduled.json()


def test_routine_cadence_change_and_reenable_recalculate_next_run(monkeypatch) -> None:
    class FixedDate(date):
        @classmethod
        def today(cls) -> date:
            return cls(2026, 7, 7)

    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    monkeypatch.setattr(task_routes, "date", FixedDate)
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _create_user(client, "alice", employee_id="alice")
        created = client.post("/tasks", json={
            "title": "Routine",
            "ownerEmployeeId": "alice",
            "assigneeEmployeeId": "alice",
            "isRoutine": True,
            "routineCadence": "weekly",
            "routineNextRunDate": "2026-06-01",
            "routineEnabled": False,
        })
        assert created.status_code == 201

        reenabled = client.patch(f"/tasks/{created.json()['id']}", json={
            "routineEnabled": True,
            "routineNextRunDate": "2026-06-01",
        })
        assert reenabled.status_code == 200
        assert reenabled.json()["routineNextRunDate"] == "2026-07-14"

        cadence_changed = client.patch(f"/tasks/{created.json()['id']}", json={
            "routineCadence": "daily",
            "routineNextRunDate": "2026-07-14",
        })
        assert cadence_changed.status_code == 200
        assert cadence_changed.json()["routineNextRunDate"] == "2026-07-08"

        title_changed = client.patch(f"/tasks/{created.json()['id']}", json={
            "title": "Renamed routine",
        })
        assert title_changed.status_code == 200
        assert title_changed.json()["routineNextRunDate"] == "2026-07-08"


def test_marking_task_done_completes_linked_running_session(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _create_user(client, "alice", employee_id="alice")

        created = client.post("/tasks", json={
            "title": "Write the report",
            "ownerEmployeeId": "alice",
            "assigneeEmployeeId": "alice",
            "createSession": True,
        })
        assert created.status_code == 201
        task = created.json()
        [session_id] = task["linkedSessionIds"]

        session = client.get(f"/sessions/{session_id}")
        assert session.status_code == 200
        assert session.json()["status"] == "running"

        updated = client.patch(f"/tasks/{task['id']}", json={"status": "done"})
        assert updated.status_code == 200
        assert updated.json()["status"] == "done"

        completed = client.get(f"/sessions/{session_id}")
        assert completed.status_code == 200
        body = completed.json()
        assert body["status"] == "completed"
        assert body["finalOutcome"] == "Task marked done."
        assert body["events"][-1]["type"] == "session.completed"


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
        assert started.json()["task"]["id"] == task["id"]
        assert started.json()["task"]["status"] == "running"
        assert started.json()["task"]["linkedSessionIds"] == [started.json()["session"]["id"]]

        commands = client.get("/daemon-nodes/sbx_alice/commands", headers={"Authorization": "Bearer node_token"})
        assert commands.status_code == 200
        [command] = commands.json()["commands"]
        assert command["type"] == "run.start"
        assert command["agent"] == "codex"
        assert command["sessionId"] == started.json()["session"]["id"]
        assert command["taskGoal"] == "Run from backlog"


def test_task_start_preserves_ask_mode(monkeypatch) -> None:
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
            "title": "Explain backlog",
            "ownerEmployeeId": "alice",
            "assigneeEmployeeId": "alice",
            "assignedAgent": "codex",
        })
        assert created.status_code == 201

        started = client.post(f"/tasks/{created.json()['id']}/start", json={"agent": "codex", "mode": "ask"})
        assert started.status_code == 202

        commands = client.get("/daemon-nodes/sbx_alice/commands", headers={"Authorization": "Bearer node_token"})
        assert commands.status_code == 200
        [command] = commands.json()["commands"]
        assert command["agent"] == "codex"
        assert command["mode"] == "ask"
        assert command["state"]["task_goal"] == "Explain backlog"


def test_task_start_requests_managed_capacity_when_no_node_is_ready(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _create_user(client, "alice", employee_id="alice")
        task = client.post(
            "/tasks",
            json={
                "title": "Provision before running",
                "ownerEmployeeId": "alice",
                "assigneeEmployeeId": "alice",
                "assignedAgent": "codex",
            },
        ).json()

        started = client.post(f"/tasks/{task['id']}/start", json={"agent": "codex"})

        assert started.status_code == 202
        assert started.json()["session"] is None
        assert started.json()["task"]["activity"][-1]["message"] == (
            "Managed node provisioning requested for alice."
        )
        [managed] = app.state.managed_node_store.list_nodes()
        assert managed["employeeId"] == "alice"


def test_task_start_reports_restart_of_stopped_managed_capacity(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _create_user(client, "alice", employee_id="alice")
        managed = app.state.managed_node_store.create_node({"employeeId": "alice"})
        app.state.managed_node_store.update_node(
            managed["id"], {"desiredState": "stopped"}
        )
        task = client.post(
            "/tasks",
            json={
                "title": "Restart managed capacity",
                "ownerEmployeeId": "alice",
                "assigneeEmployeeId": "alice",
                "assignedAgent": "codex",
            },
        ).json()

        started = client.post(f"/tasks/{task['id']}/start", json={"agent": "codex"})

        assert started.status_code == 202
        assert started.json()["task"]["activity"][-1]["message"] == (
            "Managed node provisioning requested for alice."
        )
        restarted = app.state.managed_node_store.get_node(managed["id"])
        assert restarted["desiredState"] == "running"
        assert restarted["phase"] == "requested"


def test_task_start_discussion_runs_multi_agent_ask_and_keeps_task_open(monkeypatch) -> None:
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
            "supportedAgents": ["claude", "codex"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})
        assert registered.status_code == 200
        created = client.post("/tasks", json={
            "title": "Plan onboarding",
            "description": "Discuss rollout and implementation.",
            "ownerEmployeeId": "alice",
            "assigneeEmployeeId": "alice",
        })
        assert created.status_code == 201

        started = client.post(f"/tasks/{created.json()['id']}/start", json={
            "assignments": [
                {"agent": "claude", "mode": "ask"},
                {"agent": "codex", "mode": "ask"},
            ],
        })
        assert started.status_code == 202
        session_id = started.json()["session"]["id"]
        assert started.json()["task"]["linkedSessionIds"] == [session_id]
        assert started.json()["task"]["status"] == "running"

        commands = client.get("/daemon-nodes/sbx_alice/commands", headers={"Authorization": "Bearer node_token"})
        assert commands.status_code == 200
        [first] = commands.json()["commands"]
        assert first["agent"] == "claude"
        assert first["mode"] == "ask"
        assert first["taskGoal"] == "Plan onboarding\n\nDiscuss rollout and implementation."

        completed_first = client.post("/daemon-nodes/sbx_alice/events", json={
            "type": "run.completed",
            "commandId": first["id"],
            **({"leaseId": first["leaseId"]} if first.get("leaseId") else {}),
            "sessionId": first["sessionId"],
            "runId": first["runId"],
            "agent": "claude",
            "mode": "ask",
            "exitCode": 0,
            "agentLog": "Planner says define milestones.",
        }, headers={"Authorization": "Bearer node_token"})
        assert completed_first.status_code == 202

        commands = client.get("/daemon-nodes/sbx_alice/commands", headers={"Authorization": "Bearer node_token"})
        assert commands.status_code == 200
        [second] = commands.json()["commands"]
        assert second["agent"] == "codex"
        assert second["mode"] == "ask"
        assert "prior_agent_bridge" in second["state"]

        completed_second = client.post("/daemon-nodes/sbx_alice/events", json={
            "type": "run.completed",
            "commandId": second["id"],
            **({"leaseId": second["leaseId"]} if second.get("leaseId") else {}),
            "sessionId": second["sessionId"],
            "runId": second["runId"],
            "agent": "codex",
            "mode": "ask",
            "exitCode": 0,
            "agentLog": "Engineer says implementation is feasible.",
        }, headers={"Authorization": "Bearer node_token"})
        assert completed_second.status_code == 202

        task = client.get(f"/tasks/{created.json()['id']}")
        assert task.status_code == 200
        assert task.json()["status"] == "waiting_for_human"
        assert task.json()["linkedSessionIds"] == [session_id]
        assert any(item["message"] == "Discussion started." for item in task.json()["activity"])


def test_task_start_without_agent_runs_ready_team_discussion(monkeypatch) -> None:
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
            "supportedAgents": ["claude", "codex"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})
        assert registered.status_code == 200
        team_agents = {
            agent["executorKind"]: agent
            for agent in app.state.agent_store.list_agents(
                supervisor_employee_id="alice"
            )
        }
        for executor_kind, agent in team_agents.items():
            team_agents[executor_kind] = app.state.agent_store.update_agent(
                agent["id"],
                {"instructions": f"Act as Alice's {executor_kind} teammate."},
            )
            [placement] = app.state.agent_placement_store.list_placements(
                agent_id=agent["id"]
            )
            app.state.agent_placement_store.update_placement(
                placement["id"],
                {"agentVersion": team_agents[executor_kind]["version"]},
            )
        created = client.post("/tasks", json={
            "title": "Design checkout recovery",
            "description": "Find the right implementation plan and risks.",
            "ownerEmployeeId": "alice",
            "assigneeEmployeeId": "alice",
        })
        assert created.status_code == 201
        assert "assignedAgent" not in created.json()

        started = client.post(f"/tasks/{created.json()['id']}/start", json={})
        assert started.status_code == 202
        session_id = started.json()["session"]["id"]
        assert started.json()["task"]["linkedSessionIds"] == [session_id]
        assert started.json()["task"]["status"] == "running"
        assert "assignedAgent" not in started.json()["task"]

        commands = client.get("/daemon-nodes/sbx_alice/commands", headers={"Authorization": "Bearer node_token"})
        assert commands.status_code == 200
        [first] = commands.json()["commands"]
        assert first["agent"] == "claude"
        assert first["logicalAgentId"] == team_agents["claude"]["id"]
        assert first["state"]["agent_instructions"] == (
            "Act as Alice's claude teammate."
        )
        assert first["mode"] == "ask"
        assert first["taskGoal"] == "Design checkout recovery\n\nFind the right implementation plan and risks."

        completed_first = client.post("/daemon-nodes/sbx_alice/events", json={
            "type": "run.completed",
            "commandId": first["id"],
            **({"leaseId": first["leaseId"]} if first.get("leaseId") else {}),
            "sessionId": first["sessionId"],
            "runId": first["runId"],
            "agent": "claude",
            "mode": "ask",
            "exitCode": 0,
            "agentLog": "Planner recommends a staged rollout.",
        }, headers={"Authorization": "Bearer node_token"})
        assert completed_first.status_code == 202

        commands = client.get("/daemon-nodes/sbx_alice/commands", headers={"Authorization": "Bearer node_token"})
        assert commands.status_code == 200
        [second] = commands.json()["commands"]
        assert second["agent"] == "codex"
        assert second["logicalAgentId"] == team_agents["codex"]["id"]
        assert second["state"]["agent_instructions"] == (
            "Act as Alice's codex teammate."
        )
        assert second["mode"] == "ask"
        assert "prior_agent_bridge" in second["state"]

        completed_second = client.post("/daemon-nodes/sbx_alice/events", json={
            "type": "run.completed",
            "commandId": second["id"],
            **({"leaseId": second["leaseId"]} if second.get("leaseId") else {}),
            "sessionId": second["sessionId"],
            "runId": second["runId"],
            "agent": "codex",
            "mode": "ask",
            "exitCode": 0,
            "agentLog": "Engineer identifies the implementation steps.",
        }, headers={"Authorization": "Bearer node_token"})
        assert completed_second.status_code == 202

        task = client.get(f"/tasks/{created.json()['id']}")
        assert task.status_code == 200
        assert task.json()["status"] == "waiting_for_human"
        assert task.json()["linkedSessionIds"] == [session_id]
        assert "assignedAgent" not in task.json()
        assert any(item["message"] == "Discussion started." for item in task.json()["activity"])


def test_review_run_leaves_task_in_review_for_human(monkeypatch) -> None:
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
            "title": "Audit the release",
            "ownerEmployeeId": "alice",
            "assigneeEmployeeId": "alice",
        })
        assert created.status_code == 201

        started = client.post(f"/tasks/{created.json()['id']}/start", json={
            "assignments": [{"agent": "codex", "mode": "review"}],
        })
        assert started.status_code == 202

        commands = client.get("/daemon-nodes/sbx_alice/commands", headers={"Authorization": "Bearer node_token"})
        assert commands.status_code == 200
        [command] = commands.json()["commands"]
        assert command["mode"] == "review"

        completed = client.post("/daemon-nodes/sbx_alice/events", json={
            "type": "run.completed",
            "commandId": command["id"],
            **({"leaseId": command["leaseId"]} if command.get("leaseId") else {}),
            "sessionId": command["sessionId"],
            "runId": command["runId"],
            "agent": "codex",
            "mode": "review",
            "exitCode": 0,
            "agentLog": "Review passed with notes.",
        }, headers={"Authorization": "Bearer node_token"})
        assert completed.status_code == 202

        task = client.get(f"/tasks/{created.json()['id']}")
        assert task.status_code == 200
        assert task.json()["status"] == "review"


def test_routine_start_preserves_discussion_assignments(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")

    class FixedDate(date):
        @classmethod
        def today(cls) -> date:
            return cls(2026, 6, 26)

    monkeypatch.setattr(task_routes, "date", FixedDate)
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
            "supportedAgents": ["claude", "codex"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})
        assert registered.status_code == 200
        created = client.post("/tasks", json={
            "title": "Weekly retro",
            "ownerEmployeeId": "alice",
            "assigneeEmployeeId": "alice",
            "isRoutine": True,
            "routineCadence": "weekly",
            "routineNextRunDate": "2026-06-25",
            "routineEnabled": True,
        })
        assert created.status_code == 201

        started = client.post(f"/tasks/{created.json()['id']}/start", json={
            "assignments": [
                {"agent": "claude", "mode": "ask"},
                {"agent": "codex", "mode": "ask"},
            ],
        })
        assert started.status_code == 202
        occurrence = started.json()["task"]
        assert occurrence["id"] != created.json()["id"]
        definition = client.get(f"/tasks/{created.json()['id']}").json()
        assert definition["routineNextRunDate"] == "2026-07-02"

        commands = client.get("/daemon-nodes/sbx_alice/commands", headers={"Authorization": "Bearer node_token"})
        assert commands.status_code == 200
        [first] = commands.json()["commands"]
        assert first["agent"] == "claude"
        assert first["mode"] == "ask"


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
        updated = client.get(f"/tasks/{created.json()['id']}")
        assert updated.status_code == 200
        assert updated.json()["status"] == "running"
        assert updated.json()["linkedSessionIds"]

        commands = client.get("/daemon-nodes/sbx_alice/commands", headers={"Authorization": "Bearer node_token"})
        assert commands.status_code == 200
        [command] = commands.json()["commands"]
        assert command["type"] == "run.start"
        assert command["agent"] == "codex"
        assert command["sessionId"] == updated.json()["linkedSessionIds"][0]
        assert command["taskGoal"] == "Scheduled backlog"


def test_routine_start_dispatches_occurrence_not_definition(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")

    class FixedDate(date):
        @classmethod
        def today(cls) -> date:
            return cls(2026, 6, 26)

    monkeypatch.setattr(task_routes, "date", FixedDate)
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
        assert start.json()["session"]["id"]
        occurrence = start.json()["task"]
        assert occurrence["id"] != task["id"]
        assert occurrence["isRoutine"] is False
        assert occurrence["status"] == "running"
        assert occurrence["dueDate"] == "2026-06-25"

        updated_definition = client.get(f"/tasks/{task['id']}").json()
        assert updated_definition["status"] == "assigned"
        assert updated_definition["routineNextRunDate"] == "2026-07-02"
        assert updated_definition["linkedSessionIds"] == [start.json()["session"]["id"]]

        commands = client.get("/daemon-nodes/sbx_alice/commands", headers={"Authorization": "Bearer node_token"})
        assert commands.status_code == 200
        [command] = commands.json()["commands"]
        assert command["type"] == "run.start"
        assert command["agent"] == "codex"
        assert command["sessionId"] == start.json()["session"]["id"]
        assert command["taskGoal"] == "Weekly report"


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


def test_task_delete_hides_task_from_list_and_get(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _create_user(client, "alice", employee_id="alice")

        created = client.post("/tasks", json={
            "title": "Delete me",
            "ownerEmployeeId": "alice",
            "assigneeEmployeeId": "alice",
            "isRoutine": True,
            "routineType": "task",
            "routineCadence": "daily",
            "routineEnabled": True,
        })
        assert created.status_code == 201
        task_id = created.json()["id"]

        deleted = client.delete(f"/tasks/{task_id}")
        assert deleted.status_code == 200
        assert deleted.json()["deletedAt"]

        again = client.delete(f"/tasks/{task_id}")
        assert again.status_code == 200
        assert again.json()["deletedAt"] == deleted.json()["deletedAt"]

        listed = client.get("/tasks")
        assert listed.status_code == 200
        assert all(task["id"] != task_id for task in listed.json()["tasks"])

        missing = client.delete("/tasks/task_missing")
        assert missing.status_code == 404
