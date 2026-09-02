"""Dispatch resolves the task workspace layout against the chosen node.

`TaskDispatcher._run_request` and the scheduler's dispatch request used to
hardcode `workspaceLayout: "project"` only when a project snapshot existed,
leaving every other task on the legacy per-thread directory. These tests
drive dispatch through the real HTTP surface (the same harness the existing
task-dispatch tests in `backend/tests/api/test_tasks.py` use) and assert on
the `run.start` command a daemon actually receives, so a regression here
would be caught the same way a daemon would see it: a wrong or missing
`workspaceLayout`/`workspaceSubpath` on the wire.
"""

from __future__ import annotations

from datetime import date
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient
from relay.app import create_app
from relay.core.computer_identity import computer_id


def _bootstrap_admin(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/bootstrap",
        json={
            "token": "admin_token",
            "username": "admin",
            "password": "kestrel-vault-7719",
        },
    )
    assert response.status_code == 200


def _bootstrap_employee(client: TestClient, employee_id: str = "alice") -> None:
    response = client.post(
        "/api/v1/admin/employees",
        json={
            "employeeId": employee_id,
            "username": employee_id,
            "password": "userpass",
            "displayName": employee_id.title(),
        },
    )
    assert response.status_code == 201


def _login_employee(client: TestClient, employee_id: str = "alice") -> None:
    assert client.post("/api/v1/auth/logout").status_code == 200
    response = client.post(
        "/api/v1/auth/login",
        json={"username": employee_id, "password": "userpass"},
    )
    assert response.status_code == 200


def _register_node(
    app,
    node_id: str,
    *,
    capabilities: list[str],
    employee_id: str = "alice",
) -> dict:
    return app.state.registry.register(
        {
            "sandboxId": node_id,
            "employeeId": employee_id,
            "token": f"token_{node_id}",
            "workspacePath": f"/workspace/{employee_id}",
            "workspaceId": f"machine-{node_id}",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "capabilities": capabilities,
            "status": "ready",
        },
        "ui_token",
    )


def _agent(app, node: dict, *, employee_id: str = "alice") -> dict:
    agent = app.state.agent_store.create_agent(
        employee_id,
        {
            "displayName": "Task Agent",
            "executorKind": "codex",
            "defaultRole": "implementer",
        },
    )
    app.state.agent_placement_store.create_placement(agent, node["id"])
    return agent


def _take_command(app, node: dict) -> dict:
    [command] = app.state.registry.take_commands(
        node["id"], f"token_{node['id']}"
    )
    return command


def test_dispatch_sends_the_task_layout_to_a_capable_node(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        node = _register_node(
            app, "sbx_alice", capabilities=["thread-workspaces", "task-workspaces"]
        )
        agent = _agent(app, node)

        task = client.post(
            "/api/v1/tasks",
            json={
                "title": "Write the report",
                "ownerEmployeeId": "alice",
                "assigneeEmployeeId": "alice",
                "assignedAgentId": agent["id"],
            },
        ).json()

        started = client.post(f"/api/v1/tasks/{task['id']}/runs", json={})
        assert started.status_code == 202, started.text

        command = _take_command(app, node)
        assert command["workspaceLayout"] == "task"
        assert command["workspaceSubpath"] == f"tasks/{task['id']}"


def test_dispatch_falls_back_to_thread_on_an_older_node(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        node = _register_node(app, "sbx_alice", capabilities=["thread-workspaces"])
        agent = _agent(app, node)

        task = client.post(
            "/api/v1/tasks",
            json={
                "title": "Write the report",
                "ownerEmployeeId": "alice",
                "assigneeEmployeeId": "alice",
                "assignedAgentId": agent["id"],
            },
        ).json()

        started = client.post(f"/api/v1/tasks/{task['id']}/runs", json={})
        assert started.status_code == 202, started.text

        command = _take_command(app, node)
        assert command["workspaceLayout"] == "thread"
        assert "workspaceSubpath" not in command


def test_project_task_keeps_the_project_workspace(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _bootstrap_employee(client)
        node = _register_node(
            app,
            "sbx_alice",
            capabilities=[
                "thread-workspaces",
                "task-workspaces",
                "project-workspaces",
            ],
        )
        lead = _agent(app, node)
        _login_employee(client)

        project = client.post(
            "/api/v1/projects",
            json={
                "name": "Launch",
                "daemonNodeId": node["id"],
                "leadAgentId": lead["id"],
                "members": [
                    {
                        "agentId": lead["id"],
                        "role": "planner",
                        "functionTitle": "Lead",
                        "responsibilities": "Plan",
                    }
                ],
            },
        ).json()["project"]

        task = client.post(
            "/api/v1/tasks",
            json={"title": "Ship project", "projectId": project["id"]},
        ).json()

        started = client.post(f"/api/v1/tasks/{task['id']}/runs", json={})
        assert started.status_code == 202, started.text

        command = _take_command(app, node)
        assert command["workspaceLayout"] == "project"
        assert command["workspaceSubpath"] == project["workspaceSubpath"]


def test_routine_occurrence_dispatch_nests_under_its_routine(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")

    class FixedDate(date):
        @classmethod
        def today(cls) -> date:
            return cls(2026, 6, 26)

    with TemporaryDirectory() as root:
        app = create_app(root)
        app.state.today = FixedDate.today
        client = TestClient(app)
        _bootstrap_admin(client)
        node = _register_node(
            app, "sbx_alice", capabilities=["thread-workspaces", "task-workspaces"]
        )
        agent = _agent(app, node)

        routine = client.post(
            "/api/v1/tasks",
            json={
                "title": "Nightly",
                "ownerEmployeeId": "alice",
                "assigneeEmployeeId": "alice",
                "assignedAgentId": agent["id"],
                "isRoutine": True,
                "routineCadence": "weekly",
                "routineNextRunDate": "2026-06-25",
                "routineEnabled": True,
            },
        ).json()

        started = client.post(f"/api/v1/tasks/{routine['id']}/runs", json={})
        assert started.status_code == 202, started.text
        occurrence = started.json()["task"]
        assert occurrence["sourceRoutineId"] == routine["id"]

        command = _take_command(app, node)
        assert command["workspaceLayout"] == "task"
        assert (
            command["workspaceSubpath"]
            == f"tasks/{routine['id']}/{occurrence['id']}"
        )
