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
        assert "nodeToken" not in response.json()["nodes"][0]


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
        assert body["nodeToken"].startswith("tok_")
        assert body["nodeToken"] in body["daemonCommand"]
        assert body["daemonEnv"]["RELAY_SANDBOX_ID"] == node["id"]
        assert body["daemonEnv"]["RELAY_EMPLOYEE_ID"] == "alice"
        assert body["daemonEnv"]["RELAY_DAEMON_NODE_TOKEN"] == body["nodeToken"]

        wrong_poll = client.get(f"/daemon-nodes/{node['id']}/commands", headers={"Authorization": "Bearer wrong"})
        assert wrong_poll.status_code == 401

        register = client.post("/daemon-nodes/register", json={
            "sandboxId": node["id"],
            "employeeId": "alice",
            "token": body["nodeToken"],
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["claude", "codex"],
            "status": "ready",
        })
        assert register.status_code == 200
        assert register.json()["agents"]["codex"] == "ready"

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
        assert "nodeToken" not in duplicate_body
        assert "daemonCommand" not in duplicate_body
