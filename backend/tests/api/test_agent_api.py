from __future__ import annotations

from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from relay.app import create_app
from relay.persistence.store_common import _write_json


def _bootstrap_admin(client: TestClient) -> None:
    response = client.post(
        "/auth/bootstrap",
        json={"token": "admin_token", "username": "admin", "password": "secret123"},
    )
    assert response.status_code == 200


def test_admin_manages_agents_and_employee_lists_own_agents(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        employee = client.post(
            "/cp/employees",
            json={
                "employeeId": "alice",
                "username": "alice",
                "password": "userpass",
                "displayName": "Alice",
            },
        )
        assert employee.status_code == 201

        researcher = client.post(
            "/cp/employees/alice/agents",
            json={
                "displayName": "Researcher",
                "executorKind": "claude",
                "defaultRole": "planner",
            },
        )
        reviewer = client.post(
            "/cp/employees/alice/agents",
            json={
                "displayName": "Reviewer",
                "executorKind": "claude",
                "defaultRole": "reviewer",
            },
        )
        assert researcher.status_code == reviewer.status_code == 201

        assert client.post("/auth/logout").status_code == 200
        assert (
            client.post(
                "/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )
        own_agents = client.get("/agents")

        assert own_agents.status_code == 200
        assert {agent["displayName"] for agent in own_agents.json()["agents"]} == {
            "Researcher",
            "Reviewer",
        }


def test_employee_agent_admin_routes_require_admin(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))

        assert client.get("/cp/agents").status_code == 401
        assert (
            client.post(
                "/cp/employees/alice/agents",
                json={"displayName": "Builder", "executorKind": "codex"},
            ).status_code
            == 401
        )


def test_employee_updates_own_agent_meta(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        employee = client.post(
            "/cp/employees",
            json={
                "employeeId": "alice",
                "username": "alice",
                "password": "userpass",
                "displayName": "Alice",
            },
        )
        assert employee.status_code == 201
        researcher = client.post(
            "/cp/employees/alice/agents",
            json={
                "displayName": "Researcher",
                "executorKind": "claude",
                "defaultRole": "planner",
            },
        ).json()["agent"]

        assert client.post("/auth/logout").status_code == 200
        assert (
            client.post(
                "/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )

        updated = client.patch(
            f"/agents/{researcher['id']}",
            json={
                "displayName": "Analyst",
                "instructions": "Cite primary sources.",
            },
        )
        assert updated.status_code == 200
        payload = updated.json()["agent"]
        assert payload["displayName"] == "Analyst"
        assert payload["instructions"] == "Cite primary sources."

        forbidden_field = client.patch(
            f"/agents/{researcher['id']}",
            json={"enabled": False},
        )
        assert forbidden_field.status_code == 400

        assert client.post("/auth/logout").status_code == 200
        assert (
            client.post(
                "/auth/login", json={"username": "admin", "password": "secret123"}
            ).status_code
            == 200
        )
        bob = client.post(
            "/cp/employees",
            json={
                "employeeId": "bob",
                "username": "bob",
                "password": "userpass",
            },
        )
        assert bob.status_code == 201
        assert client.post("/auth/logout").status_code == 200
        assert (
            client.post(
                "/auth/login", json={"username": "bob", "password": "userpass"}
            ).status_code
            == 200
        )
        forbidden_owner = client.patch(
            f"/agents/{researcher['id']}",
            json={"displayName": "Hijacked"},
        )
        assert forbidden_owner.status_code == 403


def test_admin_places_agents_on_different_runtime_nodes(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        assert (
            client.post(
                "/cp/employees",
                json={
                    "employeeId": "alice",
                    "username": "alice",
                    "password": "userpass",
                },
            ).status_code
            == 201
        )
        for node_id, executor in (("node_a", "claude"), ("node_b", "codex")):
            app.state.registry.register(
                {
                    "sandboxId": node_id,
                    "employeeId": "alice",
                    "token": f"token_{node_id}",
                    "protocolVersion": 1,
                    "supportedAgents": [executor],
                    "status": "ready",
                }
            )

        researcher = client.post(
            "/cp/employees/alice/agents",
            json={"displayName": "Researcher", "executorKind": "claude"},
        ).json()["agent"]
        builder = client.post(
            "/cp/employees/alice/agents",
            json={"displayName": "Builder", "executorKind": "codex"},
        ).json()["agent"]
        first = client.post(
            f"/cp/agents/{researcher['id']}/placements", json={"daemonNodeId": "node_a"}
        )
        second = client.post(
            f"/cp/agents/{builder['id']}/placements", json={"daemonNodeId": "node_b"}
        )

        assert first.status_code == second.status_code == 201
        agents = client.get("/cp/agents?employeeId=alice").json()["agents"]
        assert {agent["availability"] for agent in agents} == {"ready"}
        assert {agent["placements"][0]["daemonNodeId"] for agent in agents} == {
            "node_a",
            "node_b",
        }


def test_employee_dispatches_work_by_logical_agent_id(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        assert (
            client.post(
                "/cp/employees",
                json={
                    "employeeId": "alice",
                    "username": "alice",
                    "password": "userpass",
                },
            ).status_code
            == 201
        )
        app.state.registry.register(
            {
                "sandboxId": "node_a",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            }
        )
        agent = client.post(
            "/cp/employees/alice/agents",
            json={
                "displayName": "Builder",
                "executorKind": "codex",
            },
        ).json()["agent"]
        assert (
            client.post(
                f"/cp/agents/{agent['id']}/placements", json={"daemonNodeId": "node_a"}
            ).status_code
            == 201
        )

        assert client.post("/auth/logout").status_code == 200
        assert (
            client.post(
                "/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )
        response = client.post(
            "/agent-runs",
            json={
                "taskGoal": "Build the feature",
                "assignments": [{"agentId": agent["id"], "mode": "action"}],
                "idempotencyKey": "telegram:chat_1:42",
            },
        )

        assert response.status_code == 202
        duplicate = client.post(
            "/agent-runs",
            json={
                "taskGoal": "Build the feature",
                "assignments": [{"agentId": agent["id"], "mode": "action"}],
                "idempotencyKey": "telegram:chat_1:42",
            },
        )
        assert duplicate.status_code == 202
        assert duplicate.json()["id"] == response.json()["id"]
        run = response.json()["agentRuns"][0]
        assert run["logicalAgentId"] == agent["id"]
        assert run["daemonNodeId"] == "node_a"
        commands = app.state.daemon_store.take_queued_commands("node_a")
        assert len(commands) == 1
        command = commands[0]["command"]
        assert command["logicalAgentId"] == agent["id"]


def test_existing_session_dispatch_normalizes_legacy_agent_supervisor(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        assert client.post(
            "/cp/employees",
            json={
                "employeeId": "alice",
                "username": "alice",
                "password": "userpass",
            },
        ).status_code == 201
        app.state.registry.register(
            {
                "sandboxId": "node_a",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            }
        )
        agent = app.state.agent_store.create_agent(
            "alice", {"displayName": "Builder", "executorKind": "codex"}
        )
        placement = app.state.agent_placement_store.create_placement(agent, "node_a")
        legacy_agent = {**agent, "employeeId": "alice"}
        legacy_agent.pop("supervisorEmployeeId")
        legacy_placement = {**placement, "employeeId": "alice"}
        legacy_placement.pop("supervisorEmployeeId")
        _write_json(app.state.agent_store._snapshot_path(agent["id"]), legacy_agent)
        _write_json(
            app.state.agent_placement_store._snapshot_path(placement["id"]),
            legacy_placement,
        )
        session = app.state.session_store.create_session(
            {
                "workspacePath": "/workspace/alice",
                "ownerEmployeeId": "alice",
                "ownerAgentId": agent["id"],
                "taskGoal": "Build the feature",
            }
        )

        response = client.post(
            "/agent-runs",
            json={
                "taskGoal": "Continue the feature",
                "sessionId": session["id"],
                "assignments": [{"agentId": agent["id"], "mode": "action"}],
            },
        )

        assert response.status_code == 202, response.text


def test_employee_cannot_list_or_dispatch_another_employees_agent(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        for employee_id in ("alice", "bob"):
            assert client.post(
                "/cp/employees",
                json={
                    "employeeId": employee_id,
                    "username": employee_id,
                    "password": "userpass",
                },
            ).status_code == 201
        app.state.registry.register(
            {
                "sandboxId": "shared_node",
                "token": "node_token",
                "workspacePath": "/workspace/shared",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            }
        )
        agent = client.post(
            "/cp/employees/alice/agents",
            json={"displayName": "Builder", "executorKind": "codex"},
        ).json()["agent"]
        assert client.post(
            f"/cp/agents/{agent['id']}/placements",
            json={"daemonNodeId": "shared_node"},
        ).status_code == 201

        assert client.post("/auth/logout").status_code == 200
        assert client.post(
            "/auth/login", json={"username": "bob", "password": "userpass"}
        ).status_code == 200
        assert client.get("/agents").json()["agents"] == []

        denied = client.post(
            "/agent-runs",
            json={
                "taskGoal": "Use Alice's agent",
                "assignments": [{"agentId": agent["id"], "mode": "action"}],
            },
        )
        assert denied.status_code == 409
        assert denied.json()["detail"]["code"] == "agent_forbidden"


def test_legacy_run_materializes_compatibility_agent_without_get_side_effects(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        assert (
            client.post(
                "/cp/employees",
                json={
                    "employeeId": "alice",
                    "username": "alice",
                    "password": "userpass",
                },
            ).status_code
            == 201
        )
        app.state.registry.register(
            {
                "sandboxId": "node_a",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["claude", "codex"],
                "status": "ready",
            }
        )
        assert client.post("/auth/logout").status_code == 200
        assert (
            client.post(
                "/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )

        assert client.get("/agents").json()["agents"] == []
        response = client.post(
            "/sandboxes/node_a/runs",
            json={
                "taskGoal": "Build it",
                "assignments": [{"agent": "codex", "mode": "action"}],
            },
        )

        assert response.status_code == 202
        [agent] = client.get("/agents").json()["agents"]
        assert agent["executorKind"] == "codex"
        assert agent["compatibilityKey"] == "alice:codex"
        assert agent["placements"][0]["daemonNodeId"] == "node_a"
        assert response.json()["agentRuns"][0]["logicalAgentId"] == agent["id"]


def test_task_persists_and_dispatches_a_logical_agent_assignment(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        assert (
            client.post(
                "/cp/employees",
                json={
                    "employeeId": "alice",
                    "username": "alice",
                    "password": "userpass",
                },
            ).status_code
            == 201
        )
        app.state.registry.register(
            {
                "sandboxId": "node_a",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            }
        )
        agent = client.post(
            "/cp/employees/alice/agents",
            json={
                "displayName": "Builder",
                "executorKind": "codex",
            },
        ).json()["agent"]
        assert (
            client.post(
                f"/cp/agents/{agent['id']}/placements", json={"daemonNodeId": "node_a"}
            ).status_code
            == 201
        )
        assert client.post("/auth/logout").status_code == 200
        assert (
            client.post(
                "/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )

        task = client.post(
            "/tasks", json={"title": "Build it", "assignedAgentId": agent["id"]}
        )
        started = client.post(f"/tasks/{task.json()['id']}/start", json={})

        assert task.status_code == 201
        assert task.json()["assignedAgent"] == "codex"
        assert task.json()["assignedAgentId"] == agent["id"]
        assert started.status_code == 202
        assert (
            started.json()["session"]["agentRuns"][0]["logicalAgentId"] == agent["id"]
        )


def test_task_reassignment_cannot_retain_another_employees_agent(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        agents = {}
        for employee_id in ("alice", "bob"):
            assert client.post(
                "/cp/employees",
                json={
                    "employeeId": employee_id,
                    "username": employee_id,
                    "password": "userpass",
                },
            ).status_code == 201
            agents[employee_id] = client.post(
                f"/cp/employees/{employee_id}/agents",
                json={"displayName": "Builder", "executorKind": "codex"},
            ).json()["agent"]

        task = client.post(
            "/tasks",
            json={
                "title": "Move ownership safely",
                "ownerEmployeeId": "alice",
                "assigneeEmployeeId": "alice",
                "assignedAgentId": agents["alice"]["id"],
            },
        ).json()

        missing_agent = client.patch(
            f"/tasks/{task['id']}", json={"assigneeEmployeeId": "bob"}
        )
        assert missing_agent.status_code == 400

        reassigned = client.patch(
            f"/tasks/{task['id']}",
            json={
                "assigneeEmployeeId": "bob",
                "assignedAgentId": agents["bob"]["id"],
            },
        )
        assert reassigned.status_code == 200
        assert reassigned.json()["assigneeEmployeeId"] == "bob"
        assert reassigned.json()["assignedAgentId"] == agents["bob"]["id"]

        cleared = client.patch(
            f"/tasks/{task['id']}", json={"assignedAgentId": ""}
        )
        assert cleared.status_code == 200
        assert "assignedAgentId" not in cleared.json()
