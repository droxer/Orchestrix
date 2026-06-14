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


def _login_admin(client: TestClient) -> None:
    response = client.post("/auth/login", json={
        "username": "admin",
        "password": "secret123",
    })
    assert response.status_code == 200


def test_fastapi_daemon_routes_register_and_poll(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _login_admin(client)
        response = client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_alice",
            "employeeId": "alice",
            "token": "node_token",
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["claude", "codex"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})

        assert response.status_code == 200
        assert response.json()["agents"]["codex"] == "ready"
        response = client.get("/daemon-nodes/sbx_alice/commands", headers={"Authorization": "Bearer node_token"})
        assert response.status_code == 200
        assert response.json() == {"commands": []}
        response = client.get("/cp/daemon-nodes")
        assert response.status_code == 200
        assert response.json()["nodes"][0].get("nodeToken") == "node_token"


def test_admin_creates_employee_login_and_assigns_unassigned_node(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _login_admin(client)

        response = client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_unassigned",
            "token": "node_token",
            "workspacePath": "/workspace/unassigned",
            "protocolVersion": 1,
            "supportedAgents": ["claude", "codex"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})
        assert response.status_code == 200
        assert "employeeId" not in response.json()

        response = client.get("/cp/daemon-nodes")
        assert response.status_code == 200
        assert "employeeId" not in response.json()["nodes"][0]

        response = client.post("/cp/employees", json={
            "employeeId": "alice",
            "username": "alice",
            "password": "userpass",
            "email": "alice@example.com",
            "displayName": "Alice",
            "nodeId": "sbx_unassigned",
        })
        assert response.status_code == 201
        body = response.json()
        assert body["user"]["username"] == "alice"
        assert body["user"]["role"] == "user"
        assert body["user"]["employeeId"] == "alice"
        assert body["employee"]["id"] == "alice"
        assert body["employee"]["displayName"] == "Alice"
        assert body["node"]["id"] == "sbx_unassigned"
        assert body["node"]["employeeId"] == "alice"

        poll = client.get("/daemon-nodes/sbx_unassigned/commands", headers={"Authorization": "Bearer node_token"})
        assert poll.status_code == 200
        assert poll.json() == {"commands": []}

        alice_client = TestClient(app)
        login = alice_client.post("/auth/login", json={"username": "alice", "password": "userpass"})
        assert login.status_code == 200
        assert login.json()["user"]["employeeId"] == "alice"


def test_admin_assigns_unassigned_node_to_existing_employee(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _login_admin(client)

        created = client.post("/cp/users", json={
            "username": "alice",
            "password": "userpass",
            "role": "user",
            "employeeId": "alice",
        })
        assert created.status_code == 201

        registered = client.post("/daemon-nodes/register", json={
            "sandboxId": "node_unassigned",
            "token": "node_token",
            "workspacePath": "/workspace/unassigned",
            "protocolVersion": 1,
            "supportedAgents": ["claude", "codex"],
            "status": "ready",
        })
        assert registered.status_code == 200
        assert "employeeId" not in registered.json()

        assigned = client.post("/cp/daemon-nodes/node_unassigned/assign", json={"employeeId": "alice"})
        assert assigned.status_code == 200
        body = assigned.json()
        assert body["employee"]["id"] == "alice"
        assert body["node"]["id"] == "node_unassigned"
        assert body["node"]["employeeId"] == "alice"

        second = client.post("/cp/daemon-nodes/node_unassigned/assign", json={"employeeId": "alice"})
        assert second.status_code == 409


def test_create_employee_rejects_invalid_node_assignment(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login_admin(client)

        missing_field = client.post("/cp/employees", json={
            "employeeId": "alice",
            "username": "alice",
            "password": "userpass",
        })
        assert missing_field.status_code == 400
        assert missing_field.json()["detail"] == "nodeId is required."

        missing_node = client.post("/cp/employees", json={
            "employeeId": "alice",
            "username": "alice",
            "password": "userpass",
            "nodeId": "sbx_missing",
        })
        assert missing_node.status_code == 404

        client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_unassigned",
            "token": "node_token",
            "protocolVersion": 1,
            "supportedAgents": ["claude"],
            "status": "ready",
        })
        first = client.post("/cp/employees", json={
            "employeeId": "alice",
            "username": "alice",
            "password": "userpass",
            "nodeId": "sbx_unassigned",
        })
        assert first.status_code == 201

        client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_second",
            "token": "node_token_2",
            "protocolVersion": 1,
            "supportedAgents": ["claude"],
            "status": "ready",
        })
        duplicate_user = client.post("/cp/employees", json={
            "employeeId": "bob",
            "username": "alice",
            "password": "userpass",
            "nodeId": "sbx_second",
        })
        assert duplicate_user.status_code == 409

        already_assigned = client.post("/cp/employees", json={
            "employeeId": "carol",
            "username": "carol",
            "password": "userpass",
            "nodeId": "sbx_unassigned",
        })
        assert already_assigned.status_code == 409


def test_control_panel_requires_admin_session(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))

        response = client.get("/cp/daemon-nodes")
        assert response.status_code == 401
        assert response.json()["detail"] == "Authentication required."

        _bootstrap_admin(client)
        # Bootstrap also signs the admin in, so the admin console is now accessible.
        response = client.get("/cp/daemon-nodes")
        assert response.status_code == 200

        # After logout the admin console requires authentication again.
        response = client.post("/auth/logout")
        assert response.status_code == 200

        response = client.get("/cp/daemon-nodes")
        assert response.status_code == 401

        _login_admin(client)
        response = client.get("/cp/daemon-nodes")
        assert response.status_code == 200


def test_control_panel_creates_pending_daemon_node_and_reuses_duplicate(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login_admin(client)

        response = client.post("/cp/daemon-nodes", json={
            "employeeId": "alice",
            "workspacePath": "/workspace/alice",
        })

        assert response.status_code == 201
        body = response.json()
        node = body["node"]
        assert node["employeeId"] == "alice"
        assert node["workspacePath"] == "/workspace/alice"
        assert node["status"] == "provisioning"
        assert body["sandboxToken"].startswith("tok_")
        assert body["nodeToken"].startswith("tok_")
        assert body["nodeToken"] in body["daemonCommand"]
        assert body["daemonEnv"]["RELAY_SANDBOX_ID"] == node["id"]
        assert body["daemonEnv"]["RELAY_EMPLOYEE_ID"] == "alice"
        assert body["daemonEnv"]["RELAY_DAEMON_NODE_TOKEN"] == body["nodeToken"]

        sandboxes = client.get("/sandboxes", headers={"Authorization": f"Bearer {body['sandboxToken']}"})
        assert sandboxes.status_code == 200
        assert sandboxes.json()["sandboxes"][0]["id"] == node["id"]

        wrong_poll = client.get(f"/daemon-nodes/{node['id']}/commands", headers={"Authorization": "Bearer wrong"})
        assert wrong_poll.status_code == 401

        register = client.post("/daemon-nodes/register", json={
            "sandboxId": node["id"],
            "token": body["nodeToken"],
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["claude", "codex"],
            "status": "ready",
        })
        assert register.status_code == 200
        assert register.json()["employeeId"] == "alice"
        assert register.json()["agents"]["codex"] == "ready"

        mismatched_register = client.post("/daemon-nodes/register", json={
            "sandboxId": node["id"],
            "employeeId": "mallory",
            "token": body["nodeToken"],
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["claude", "codex"],
            "status": "ready",
        })
        assert mismatched_register.status_code == 401

        poll = client.get(f"/daemon-nodes/{node['id']}/commands", headers={"Authorization": f"Bearer {body['nodeToken']}"})
        assert poll.status_code == 200
        assert poll.json() == {"commands": []}

        duplicate = client.post("/cp/daemon-nodes", json={
            "employeeId": "alice",
            "workspacePath": "/workspace/alice",
        })
        assert duplicate.status_code == 201
        duplicate_body = duplicate.json()
        assert duplicate_body["node"]["id"] == node["id"]
        assert "sandboxToken" not in duplicate_body
        assert "nodeToken" not in duplicate_body
        assert "daemonCommand" not in duplicate_body
