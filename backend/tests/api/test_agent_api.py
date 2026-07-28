from __future__ import annotations

from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient
from relay.app import create_app
from relay.persistence.store_common import _write_json


def _bootstrap_admin(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/bootstrap",
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
            "/api/v1/admin/employees",
            json={
                "employeeId": "alice",
                "username": "alice",
                "password": "userpass",
                "displayName": "Alice",
            },
        )
        assert employee.status_code == 201

        researcher = client.post(
            "/api/v1/admin/agents",
            json={
                "supervisorEmployeeId": "alice",
                "displayName": "Researcher",
                "executorKind": "claude",
                "defaultRole": "planner",
            },
        )
        reviewer = client.post(
            "/api/v1/admin/agents",
            json={
                "supervisorEmployeeId": "alice",
                "displayName": "Reviewer",
                "executorKind": "claude",
                "defaultRole": "reviewer",
            },
        )
        assert researcher.status_code == reviewer.status_code == 201

        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )
        own_agents = client.get("/api/v1/agents")

        assert own_agents.status_code == 200
        assert {agent["displayName"] for agent in own_agents.json()["agents"]} == {
            "Researcher",
            "Reviewer",
        }


def test_employee_agent_admin_routes_require_admin(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))

        assert client.get("/api/v1/admin/agents").status_code == 401
        assert (
            client.post(
                "/api/v1/admin/agents",
                json={
                    "supervisorEmployeeId": "alice",
                    "displayName": "Builder",
                    "executorKind": "codex",
                },
            ).status_code
            == 401
        )


def test_unprovisioned_daemon_registration_cannot_mint_logical_agents(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        admin_client = TestClient(app)
        _bootstrap_admin(admin_client)
        assert (
            admin_client.post(
                "/api/v1/admin/employees",
                json={
                    "employeeId": "alice",
                    "username": "alice",
                    "password": "userpass",
                },
            ).status_code
            == 201
        )

        daemon_client = TestClient(app)
        registered = daemon_client.post(
            "/api/v1/daemon-node-registrations",
            headers={"Authorization": "Bearer untrusted_ui_token"},
            json={
                "sandboxId": "unprovisioned",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "nodeLocation": "employee-device",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "stopped",
            },
        )

        assert registered.status_code == 200
        assert "employeeId" not in registered.json()
        restarted_app = create_app(root)
        restarted_daemon = TestClient(restarted_app)
        heartbeat = restarted_daemon.post(
            "/api/v1/daemon-node-registrations",
            headers={"Authorization": "Bearer untrusted_ui_token"},
            json={
                "sandboxId": "unprovisioned",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "nodeLocation": "employee-device",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            },
        )
        assert heartbeat.status_code == 200
        assert "employeeId" not in heartbeat.json()
        assert "nodeLocation" not in heartbeat.json()
        restarted_admin = TestClient(restarted_app)
        assert (
            restarted_admin.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "secret123"},
            ).status_code
            == 200
        )
        assert (
            restarted_admin.get("/api/v1/admin/agents?employeeId=alice").json()[
                "agents"
            ]
            == []
        )


def test_control_plane_provisioned_node_materializes_compatibility_agents(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        assert (
            client.post(
                "/api/v1/admin/employees",
                json={
                    "employeeId": "alice",
                    "username": "alice",
                    "password": "userpass",
                },
            ).status_code
            == 201
        )
        provisioned = client.post(
            "/api/v1/admin/daemon-nodes",
            json={
                "employeeId": "alice",
                "workspacePath": "/workspace/alice",
                "sandboxMode": "boxlite",
            },
        ).json()

        registered = client.post(
            "/api/v1/daemon-node-registrations",
            json={
                "sandboxId": provisioned["node"]["id"],
                "token": provisioned["nodeToken"],
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            },
        )

        assert registered.status_code == 200
        agents = client.get("/api/v1/admin/agents?employeeId=alice").json()["agents"]
        assert any(agent["executorKind"] == "codex" for agent in agents)


def test_agent_policies_are_rejected_until_runtime_enforcement_exists(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        assert (
            client.post(
                "/api/v1/admin/employees",
                json={
                    "employeeId": "alice",
                    "username": "alice",
                    "password": "userpass",
                },
            ).status_code
            == 201
        )

        rejected_create = client.post(
            "/api/v1/admin/agents",
            json={
                "supervisorEmployeeId": "alice",
                "displayName": "Restricted",
                "executorKind": "codex",
                "toolPolicy": {"allowedTools": ["read"]},
            },
        )
        assert rejected_create.status_code == 400
        assert "runtime enforcement" in rejected_create.json()["detail"]

        agent = client.post(
            "/api/v1/admin/agents",
            json={
                "supervisorEmployeeId": "alice",
                "displayName": "Builder",
                "executorKind": "codex",
            },
        ).json()["agent"]
        rejected_update = client.patch(
            f"/api/v1/admin/agents/{agent['id']}",
            json={"modelPolicy": {"model": "example"}},
        )
        assert rejected_update.status_code == 400
        assert "runtime enforcement" in rejected_update.json()["detail"]


def test_legacy_sandbox_run_blocks_unenforced_agent_policy(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        assert (
            client.post(
                "/api/v1/admin/employees",
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
        agent = app.state.agent_store.ensure_compatibility_agent(
            "alice", "codex", "node_a"
        )
        app.state.agent_placement_store.create_placement(agent, "node_a")
        _write_json(
            app.state.agent_store._snapshot_path(agent["id"]),
            {**agent, "toolPolicy": {"allowedTools": ["read"]}},
        )
        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )

        response = client.post(
            "/api/v1/sandboxes/node_a/runs",
            json={
                "taskGoal": "Blocked legacy policy",
                "assignments": [{"agent": "codex", "mode": "action"}],
            },
        )

        assert response.status_code == 409
        assert "agent_policy_unsupported" in response.json()["detail"]


def test_employee_updates_own_agent_meta(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        employee = client.post(
            "/api/v1/admin/employees",
            json={
                "employeeId": "alice",
                "username": "alice",
                "password": "userpass",
                "displayName": "Alice",
            },
        )
        assert employee.status_code == 201
        researcher = client.post(
            "/api/v1/admin/agents",
            json={
                "supervisorEmployeeId": "alice",
                "displayName": "Researcher",
                "executorKind": "claude",
                "defaultRole": "planner",
            },
        ).json()["agent"]

        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )

        updated = client.patch(
            f"/api/v1/agents/{researcher['id']}",
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
            f"/api/v1/agents/{researcher['id']}",
            json={"enabled": False},
        )
        assert forbidden_field.status_code == 400

        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "secret123"},
            ).status_code
            == 200
        )
        bob = client.post(
            "/api/v1/admin/employees",
            json={
                "employeeId": "bob",
                "username": "bob",
                "password": "userpass",
            },
        )
        assert bob.status_code == 201
        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "bob", "password": "userpass"}
            ).status_code
            == 200
        )
        forbidden_owner = client.patch(
            f"/api/v1/agents/{researcher['id']}",
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
                "/api/v1/admin/employees",
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
            "/api/v1/admin/agents",
            json={
                "supervisorEmployeeId": "alice",
                "displayName": "Researcher",
                "executorKind": "claude",
            },
        ).json()["agent"]
        builder = client.post(
            "/api/v1/admin/agents",
            json={
                "supervisorEmployeeId": "alice",
                "displayName": "Builder",
                "executorKind": "codex",
            },
        ).json()["agent"]
        first = client.post(
            f"/api/v1/admin/agents/{researcher['id']}/placements",
            json={"daemonNodeId": "node_a"},
        )
        second = client.post(
            f"/api/v1/admin/agents/{builder['id']}/placements",
            json={"daemonNodeId": "node_b"},
        )

        assert first.status_code == second.status_code == 201
        agents = client.get("/api/v1/admin/agents?employeeId=alice").json()["agents"]
        assert {agent["availability"] for agent in agents} == {"ready"}
        assert {agent["placements"][0]["daemonNodeId"] for agent in agents} == {
            "node_a",
            "node_b",
        }


def test_agent_placements_describe_managed_and_local_runtime_nodes(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        assert (
            client.post(
                "/api/v1/admin/employees",
                json={
                    "employeeId": "alice",
                    "username": "alice",
                    "password": "userpass",
                },
            ).status_code
            == 201
        )
        local_runtime = client.post(
            "/api/v1/admin/daemon-nodes",
            json={
                "employeeId": "alice",
                "workspacePath": "/Users/alice/relay",
                "sandboxMode": "none",
                "nodeLocation": "employee-device",
            },
        ).json()
        local_node_id = local_runtime["node"]["id"]
        app.state.registry.register(
            {
                "sandboxId": local_node_id,
                "employeeId": "alice",
                "token": local_runtime["nodeToken"],
                "workspacePath": "/Users/alice/relay",
                "sandboxMode": "none",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            }
        )
        managed = client.post(
            "/api/v1/admin/managed-nodes",
            json={"employeeId": "alice", "displayName": "Alice managed node"},
        ).json()["node"]
        attempt = client.post(
            f"/api/v1/admin/managed-nodes/{managed['id']}/attempts"
        ).json()
        enrolled = client.post(
            "/api/v1/daemon-node-enrollments",
            json={"workspacePath": "/workspace/alice"},
            headers={"Authorization": f"Enrollment {attempt['enrollmentCredential']}"},
        ).json()
        assert (
            client.post(
                "/api/v1/daemon-node-registrations",
                json={
                    "sandboxId": enrolled["sandboxId"],
                    "token": enrolled["token"],
                    "workspacePath": "/workspace/alice",
                    "workspaceId": "employee:alice:home",
                    "sandboxMode": "boxlite",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
            ).status_code
            == 200
        )
        # One agent lives on one computer, so a managed and a local runtime are
        # described through two agents — one placed on each.
        managed_agent = client.post(
            "/api/v1/admin/agents",
            json={
                "supervisorEmployeeId": "alice",
                "displayName": "Managed Builder",
                "executorKind": "codex",
            },
        ).json()["agent"]
        local_agent = client.post(
            "/api/v1/admin/agents",
            json={
                "supervisorEmployeeId": "alice",
                "displayName": "Local Builder",
                "executorKind": "codex",
            },
        ).json()["agent"]
        assert (
            client.post(
                f"/api/v1/admin/agents/{managed_agent['id']}/placements",
                json={"daemonNodeId": enrolled["sandboxId"], "priority": 100},
            ).status_code
            == 201
        )
        assert (
            client.post(
                f"/api/v1/admin/agents/{local_agent['id']}/placements",
                json={"daemonNodeId": local_node_id, "priority": 200},
            ).status_code
            == 201
        )
        assert (
            client.patch(
                f"/api/v1/daemon-nodes/{local_node_id}",
                json={"displayName": "Alice's MacBook"},
            ).status_code
            == 200
        )

        listed = {
            item["id"]: item
            for item in client.get(
                "/api/v1/admin/agents?supervisorEmployeeId=alice"
            ).json()["agents"]
        }
        managed_placement = listed[managed_agent["id"]]["placements"][0]
        local_placement = listed[local_agent["id"]]["placements"][0]

        assert managed_placement["nodeDisplayName"] == "Alice managed node"
        assert managed_placement["nodeOwnership"] == "managed"
        assert managed_placement["nodeSandboxMode"] == "boxlite"
        assert local_placement["nodeDisplayName"] == "Alice's MacBook"
        assert local_placement["nodeOwnership"] == "employee-device"
        assert local_placement["nodeSandboxMode"] == "none"


def test_employee_dispatches_work_by_logical_agent_id(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        assert (
            client.post(
                "/api/v1/admin/employees",
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
            "/api/v1/admin/agents",
            json={
                "supervisorEmployeeId": "alice",
                "displayName": "Builder",
                "executorKind": "codex",
            },
        ).json()["agent"]
        placement_response = client.post(
            f"/api/v1/admin/agents/{agent['id']}/placements",
            json={"daemonNodeId": "node_a"},
        )
        assert placement_response.status_code == 201
        placement = placement_response.json()["placement"]

        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )
        updated = client.patch(
            f"/api/v1/agents/{agent['id']}",
            json={"instructions": "Use the repository tests as evidence."},
        )
        assert updated.status_code == 200
        assert updated.json()["agent"]["availability"] == "ready"
        response = client.post(
            "/api/v1/agent-runs",
            json={
                "taskGoal": "Build the feature",
                "assignments": [{"agentId": agent["id"], "mode": "action"}],
                "idempotencyKey": "telegram:chat_1:42",
            },
        )

        assert response.status_code == 202
        duplicate = client.post(
            "/api/v1/agent-runs",
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
        assert run["workspaceIdentity"] == {
            "kind": "path",
            "value": "/workspace/alice",
        }
        monitor_node = next(
            node
            for node in client.get("/api/v1/daemon-nodes").json()["nodes"]
            if node["id"] == "node_a"
        )
        active_run = next(
            active
            for active in monitor_node["activeRuns"]
            if active["runId"] == run["id"]
        )
        assert active_run["logicalAgentId"] == agent["id"]
        assert active_run["placementId"] == placement["id"]
        commands = app.state.daemon_store.take_queued_commands("node_a")
        assert len(commands) == 1
        command = commands[0]["command"]
        assert command["logicalAgentId"] == agent["id"]
        assert command["state"]["agent_display_name"] == "Builder"
        assert command["state"]["agent_instructions"] == (
            "Use the repository tests as evidence."
        )
        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "secret123"},
            ).status_code
            == 200
        )
        deleting = client.delete(f"/api/v1/admin/agents/{agent['id']}")
        assert deleting.status_code == 409
        assert not app.state.agent_store.get_agent(agent["id"]).get("deletedAt")


def test_existing_session_dispatch_normalizes_legacy_agent_supervisor(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        assert (
            client.post(
                "/api/v1/admin/employees",
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
            "/api/v1/agent-runs",
            json={
                "taskGoal": "Continue the feature",
                "sessionId": session["id"],
                "assignments": [{"agentId": agent["id"], "mode": "action"}],
            },
        )

        assert response.status_code == 202, response.text


def test_logical_agent_handoff_records_the_target_agent_id(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        assert (
            client.post(
                "/api/v1/admin/employees",
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
        builder = app.state.agent_store.create_agent(
            "alice", {"displayName": "Builder", "executorKind": "codex"}
        )
        reviewer = app.state.agent_store.create_agent(
            "alice", {"displayName": "Reviewer", "executorKind": "codex"}
        )
        for agent in (builder, reviewer):
            app.state.agent_placement_store.create_placement(agent, "node_a")
        session = app.state.session_store.create_session(
            {
                "workspacePath": "/workspace/alice",
                "ownerEmployeeId": "alice",
                "taskGoal": "Build the feature",
                "participants": ["human", "codex"],
            }
        )

        response = client.post(
            "/api/v1/agent-runs",
            json={
                "taskGoal": session["taskGoal"],
                "sessionId": session["id"],
                "assignments": [{"agentId": reviewer["id"], "mode": "review"}],
                "decision": {"kind": "handoff", "targetAgent": "codex"},
            },
        )

        assert response.status_code == 202, response.text
        assert response.json()["decisions"][-1]["targetAgentId"] == reviewer["id"]


def test_employee_cannot_dispatch_a_team_across_shared_workspace_nodes(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        assert (
            client.post(
                "/api/v1/admin/employees",
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
                    "workspacePath": "/workspace/shared",
                    "workspaceId": "workspace:alice:shared",
                    "protocolVersion": 1,
                    "supportedAgents": [executor],
                    "maxConcurrentRuns": 2,
                    "runCapacityByMode": {"ask": 2},
                    "status": "ready",
                }
            )
        planner = app.state.agent_store.create_agent(
            "alice", {"displayName": "Planner", "executorKind": "claude"}
        )
        builder = app.state.agent_store.create_agent(
            "alice", {"displayName": "Builder", "executorKind": "codex"}
        )
        for agent, node_id in ((planner, "node_a"), (builder, "node_b")):
            app.state.agent_placement_store.create_placement(
                agent,
                node_id,
                {"workspacePolicy": {"kind": "shared-path"}},
            )
        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )

        seeded = client.post(
            "/api/v1/agent-runs",
            json={
                "taskGoal": "Research the feature",
                "assignments": [{"agentId": planner["id"], "mode": "ask"}],
            },
        )
        assert seeded.status_code == 202, seeded.text

        response = client.post(
            "/api/v1/agent-runs",
            json={
                "taskGoal": "Plan and build the feature",
                "assignments": [
                    {"agentId": planner["id"], "mode": "ask"},
                    {"agentId": builder["id"], "mode": "action"},
                ],
            },
        )

        assert response.status_code == 409, response.text
        assert response.json()["detail"]["code"] == "workspace_unavailable"


def test_new_thread_runs_on_the_selected_computer(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        assert (
            client.post(
                "/api/v1/admin/employees",
                json={
                    "employeeId": "alice",
                    "username": "alice",
                    "password": "userpass",
                },
            ).status_code
            == 201
        )
        for node_id in ("node_a", "node_b"):
            app.state.registry.register(
                {
                    "sandboxId": node_id,
                    "employeeId": "alice",
                    "token": f"token_{node_id}",
                    "workspacePath": f"/workspace/{node_id}",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                }
            )
        builder = app.state.agent_store.create_agent(
            "alice", {"displayName": "Builder", "executorKind": "codex"}
        )
        app.state.agent_placement_store.create_placement(builder, "node_b")
        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )

        response = client.post(
            "/api/v1/agent-runs",
            json={
                "taskGoal": "Build on computer B",
                "daemonNodeId": "node_b",
                "assignments": [{"agentId": builder["id"], "mode": "action"}],
            },
        )

        assert response.status_code == 202, response.text
        session = response.json()
        assert session["daemonNodeId"] == "node_b"
        created = next(
            event for event in session["events"] if event["type"] == "session.created"
        )
        assert created["daemonNodeId"] == "node_b"

        conflicting = client.post(
            "/api/v1/agent-runs",
            json={
                "taskGoal": "Try to move the existing thread",
                "sessionId": session["id"],
                "daemonNodeId": "node_a",
                "assignments": [{"agentId": builder["id"], "mode": "action"}],
            },
        )

        assert conflicting.status_code == 409, conflicting.text
        assert conflicting.json()["detail"]["code"] == "workspace_unavailable"


def test_new_thread_rejects_an_agent_outside_the_selected_computer(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        assert (
            client.post(
                "/api/v1/admin/employees",
                json={
                    "employeeId": "alice",
                    "username": "alice",
                    "password": "userpass",
                },
            ).status_code
            == 201
        )
        for node_id in ("node_a", "node_b"):
            app.state.registry.register(
                {
                    "sandboxId": node_id,
                    "employeeId": "alice",
                    "token": f"token_{node_id}",
                    "workspacePath": f"/workspace/{node_id}",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                }
            )
        builder = app.state.agent_store.create_agent(
            "alice", {"displayName": "Builder", "executorKind": "codex"}
        )
        app.state.agent_placement_store.create_placement(builder, "node_b")
        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )

        response = client.post(
            "/api/v1/agent-runs",
            json={
                "taskGoal": "Build on computer A",
                "daemonNodeId": "node_a",
                "assignments": [{"agentId": builder["id"], "mode": "action"}],
            },
        )

        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "workspace_unavailable"


def test_employee_cannot_list_or_dispatch_another_employees_agent(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        for employee_id in ("alice", "bob"):
            assert (
                client.post(
                    "/api/v1/admin/employees",
                    json={
                        "employeeId": employee_id,
                        "username": employee_id,
                        "password": "userpass",
                    },
                ).status_code
                == 201
            )
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
            "/api/v1/admin/agents",
            json={
                "supervisorEmployeeId": "alice",
                "displayName": "Builder",
                "executorKind": "codex",
            },
        ).json()["agent"]
        assert (
            client.post(
                f"/api/v1/admin/agents/{agent['id']}/placements",
                json={"daemonNodeId": "shared_node"},
            ).status_code
            == 201
        )

        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "bob", "password": "userpass"}
            ).status_code
            == 200
        )
        assert client.get("/api/v1/agents").json()["agents"] == []

        denied = client.post(
            "/api/v1/agent-runs",
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
                "/api/v1/admin/employees",
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
        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )

        assert client.get("/api/v1/agents").json()["agents"] == []
        response = client.post(
            "/api/v1/sandboxes/node_a/runs",
            json={
                "taskGoal": "Build it",
                "assignments": [{"agent": "codex", "mode": "action"}],
            },
        )

        assert response.status_code == 202
        [agent] = client.get("/api/v1/agents").json()["agents"]
        assert agent["executorKind"] == "codex"
        assert agent["compatibilityKey"] == "alice:node_a:codex"
        assert agent["placements"][0]["daemonNodeId"] == "node_a"
        assert response.json()["agentRuns"][0]["logicalAgentId"] == agent["id"]


def test_compatibility_agent_drops_from_roster_when_its_computer_is_gone(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        assert (
            client.post(
                "/api/v1/admin/employees",
                json={
                    "employeeId": "alice",
                    "username": "alice",
                    "password": "userpass",
                },
            ).status_code
            == 201
        )
        # A custom agent with no placement stays visible on the roster.
        client.post(
            "/api/v1/admin/agents",
            json={
                "supervisorEmployeeId": "alice",
                "displayName": "Freelancer",
                "executorKind": "claude",
            },
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
        # Materialize the node's compatibility agent + placement.
        from types import SimpleNamespace

        from relay.services.node_agents import sync_node_agents

        sync_node_agents(
            SimpleNamespace(
                agent_store=app.state.agent_store,
                agent_placement_store=app.state.agent_placement_store,
            ),
            app.state.registry.get("node_a"),
        )

        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )

        before = client.get("/api/v1/agents").json()["agents"]
        names = {agent["displayName"] for agent in before}
        assert "Freelancer" in names
        assert "Codex" in names

        # Unassigning the computer retires the placement; the per-computer agent
        # must leave the roster while the placement-less custom agent remains.
        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "secret123"},
            ).status_code
            == 200
        )
        assert (
            client.delete("/api/v1/admin/daemon-nodes/node_a/assignment").status_code
            == 200
        )
        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )

        after = client.get("/api/v1/agents").json()["agents"]
        assert {agent["displayName"] for agent in after} == {"Freelancer"}


def test_compatibility_agent_drops_when_its_computer_is_deregistered(
    monkeypatch,
) -> None:
    """A placement left dangling at a node that vanished from the registry must
    not linger as a struck-through, computer-less entry in the header/roster."""
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        assert (
            client.post(
                "/api/v1/admin/employees",
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
        from types import SimpleNamespace

        from relay.services.node_agents import sync_node_agents

        sync_node_agents(
            SimpleNamespace(
                agent_store=app.state.agent_store,
                agent_placement_store=app.state.agent_placement_store,
            ),
            app.state.registry.get("node_a"),
        )

        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )
        assert any(
            agent["displayName"] == "Codex"
            for agent in client.get("/api/v1/agents").json()["agents"]
        )

        # The computer vanishes from the registry (crash / re-enroll under a new
        # id) WITHOUT the placement being retired — the exact stale state seen in
        # the header. The dangling active placement must no longer surface it.
        app.state.registry.delete("node_a")

        assert client.get("/api/v1/agents").json()["agents"] == []


def test_task_persists_and_dispatches_a_logical_agent_assignment(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        assert (
            client.post(
                "/api/v1/admin/employees",
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
            "/api/v1/admin/agents",
            json={
                "supervisorEmployeeId": "alice",
                "displayName": "Builder",
                "executorKind": "codex",
            },
        ).json()["agent"]
        assert (
            client.post(
                f"/api/v1/admin/agents/{agent['id']}/placements",
                json={"daemonNodeId": "node_a"},
            ).status_code
            == 201
        )
        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )

        task = client.post(
            "/api/v1/tasks", json={"title": "Build it", "assignedAgentId": agent["id"]}
        )
        started = client.post(f"/api/v1/tasks/{task.json()['id']}/runs", json={})

        assert task.status_code == 201
        assert task.json()["assignedAgent"] == "codex"
        assert task.json()["assignedAgentId"] == agent["id"]
        assert started.status_code == 202
        assert (
            started.json()["session"]["agentRuns"][0]["logicalAgentId"] == agent["id"]
        )


def test_task_owner_cannot_be_reassigned_to_another_employees_agent(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        agents = {}
        for employee_id in ("alice", "bob"):
            assert (
                client.post(
                    "/api/v1/admin/employees",
                    json={
                        "employeeId": employee_id,
                        "username": employee_id,
                        "password": "userpass",
                    },
                ).status_code
                == 201
            )
            agents[employee_id] = client.post(
                "/api/v1/admin/agents",
                json={
                    "supervisorEmployeeId": employee_id,
                    "displayName": "Builder",
                    "executorKind": "codex",
                },
            ).json()["agent"]

        task = client.post(
            "/api/v1/tasks",
            json={
                "title": "Move ownership safely",
                "ownerEmployeeId": "alice",
                "assigneeEmployeeId": "alice",
                "assignedAgentId": agents["alice"]["id"],
            },
        ).json()

        missing_agent = client.patch(
            f"/api/v1/tasks/{task['id']}", json={"assigneeEmployeeId": "bob"}
        )
        assert missing_agent.status_code == 400

        reassigned = client.patch(
            f"/api/v1/tasks/{task['id']}",
            json={
                "assigneeEmployeeId": "bob",
                "assignedAgentId": agents["bob"]["id"],
            },
        )
        assert reassigned.status_code == 403


def test_employee_task_writes_require_named_agents_and_preserve_status(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        assert (
            client.post(
                "/api/v1/admin/employees",
                json={
                    "employeeId": "alice",
                    "username": "alice",
                    "password": "userpass",
                },
            ).status_code
            == 201
        )
        agent = client.post(
            "/api/v1/admin/agents",
            json={
                "supervisorEmployeeId": "alice",
                "displayName": "Builder",
                "executorKind": "codex",
            },
        ).json()["agent"]
        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )

        legacy = client.post(
            "/api/v1/tasks",
            json={"title": "Legacy assignment", "assignedAgent": "codex"},
        )
        assert legacy.status_code == 400

        agentless_routine = client.post(
            "/api/v1/tasks",
            json={
                "title": "Unsafe routine",
                "isRoutine": True,
                "routineEnabled": True,
            },
        )
        assert agentless_routine.status_code == 400

        created = client.post(
            "/api/v1/tasks",
            json={
                "title": "Explicitly blocked",
                "status": "blocked",
                "assignedAgentId": agent["id"],
            },
        )
        assert created.status_code == 201
        assert created.json()["status"] == "blocked"
        assert created.json()["assigneeEmployeeId"] == "alice"

        cleared = client.patch(
            f"/api/v1/tasks/{created.json()['id']}", json={"assignedAgentId": None}
        )
        assert cleared.status_code == 200
        assert cleared.json()["status"] == "blocked"
        assert "assignedAgent" not in cleared.json()
        assert "assignedAgentId" not in cleared.json()


def test_manual_start_materializes_a_legacy_task_assignment(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        assert (
            client.post(
                "/api/v1/admin/employees",
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
        legacy = app.state.task_store.create_task(
            {
                "title": "Start legacy work",
                "ownerEmployeeId": "requester",
                "assigneeEmployeeId": "alice",
                "assignedAgent": "codex",
                "status": "assigned",
            }
        )
        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )

        started = client.post(f"/api/v1/tasks/{legacy['id']}/runs", json={})

        assert started.status_code == 202
        updated = app.state.task_store.get_task(legacy["id"])
        agent = app.state.agent_store.get_agent(updated["assignedAgentId"])
        assert agent["compatibilityKey"] == "alice:node_a:codex"
        assert (
            started.json()["session"]["agentRuns"][0]["logicalAgentId"] == agent["id"]
        )
