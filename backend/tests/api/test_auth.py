from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from relay.app import create_app
from relay.auth import DatabaseUserAuthStore
from relay.stores import DatabaseDaemonStore, DatabaseSessionStore, DatabaseTaskStore


def _bootstrap_admin(client: TestClient, token: str = "admin_token") -> None:
    response = client.post("/auth/bootstrap", json={
        "token": token,
        "username": "admin",
        "password": "secret123",
    })
    assert response.status_code == 200


def _login(client: TestClient, username: str, password: str) -> None:
    response = client.post("/auth/login", json={
        "username": username,
        "password": password,
    })
    assert response.status_code == 200


def _create_user(client: TestClient, username: str, *, employee_id: str | None = None) -> None:
    response = client.post("/cp/users", json={
        "username": username,
        "password": "userpass",
        "role": "user",
        **({"employeeId": employee_id} if employee_id else {}),
    })
    assert response.status_code == 201


def _assert_no_secret_fields(value: object) -> None:
    if isinstance(value, dict):
        forbidden = {"passwordHash", "token", "sandboxToken", "nodeToken", "sessionToken"}
        assert forbidden.isdisjoint(value.keys())
        for child in value.values():
            _assert_no_secret_fields(child)
    elif isinstance(value, list):
        for child in value:
            _assert_no_secret_fields(child)


def test_control_panel_requires_admin_session(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))

        response = client.get("/cp/daemon-nodes")
        assert response.status_code == 401
        assert response.json()["detail"] == "Authentication required."


def test_bootstrap_creates_first_admin(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))

        response = client.post("/auth/bootstrap", json={
            "token": "admin_token",
            "username": "admin",
            "password": "secret123",
        })
        assert response.status_code == 200
        body = response.json()
        assert body["user"]["username"] == "admin"
        assert body["user"]["role"] == "admin"
        assert "passwordHash" not in body["user"]
        assert "token" not in body["user"]


def test_bootstrap_requires_bootstrap_token(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))

        response = client.post("/auth/bootstrap", json={
            "token": "wrong",
            "username": "admin",
            "password": "secret123",
        })
        assert response.status_code == 401


def test_bootstrap_only_once(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)

        response = client.post("/auth/bootstrap", json={
            "token": "admin_token",
            "username": "admin2",
            "password": "secret123",
        })
        assert response.status_code == 409


def test_login_and_session_cookie(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)

        response = client.post("/auth/login", json={
            "username": "admin",
            "password": "secret123",
        })
        assert response.status_code == 200
        assert "relay_session" in response.cookies

        response = client.get("/auth/me")
        assert response.status_code == 200
        assert response.json()["authenticated"] is True
        assert response.json()["user"]["username"] == "admin"
        assert response.json()["user"]["role"] == "admin"

        response = client.get("/cp/daemon-nodes")
        assert response.status_code == 200


def test_login_rejects_wrong_password(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)

        response = client.post("/auth/login", json={
            "username": "admin",
            "password": "wrong",
        })
        assert response.status_code == 401


def test_logout_clears_session(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login(client, "admin", "secret123")

        response = client.post("/auth/logout")
        assert response.status_code == 200

        response = client.get("/auth/me")
        assert response.status_code == 401


def test_auth_status_reports_bootstrap_need(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))

        response = client.get("/auth/status")
        assert response.status_code == 200
        assert response.json()["requiresBootstrap"] is True

        _bootstrap_admin(client)

        response = client.get("/auth/status")
        assert response.status_code == 200
        assert response.json()["requiresBootstrap"] is False


def test_bootstrap_unavailable_without_env_token(monkeypatch) -> None:
    monkeypatch.delenv("RELAY_ADMIN_TOKEN", raising=False)
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))

        response = client.post("/auth/bootstrap", json={
            "token": "anything",
            "username": "admin",
            "password": "secret123",
        })
        assert response.status_code == 503


def test_user_creation_validation_returns_client_errors(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login(client, "admin", "secret123")

        response = client.post("/cp/users", json={
            "username": "alice",
            "password": "userpass",
            "role": "manager",
        })
        assert response.status_code == 400
        assert response.json()["detail"] == "role must be admin or user."

        response = client.post("/cp/users", json={
            "username": " ",
            "password": "userpass",
            "role": "user",
        })
        assert response.status_code == 400
        assert response.json()["detail"] == "username is required."

        response = client.post("/cp/users", json={
            "username": "alice",
            "password": "",
            "role": "user",
        })
        assert response.status_code == 400
        assert response.json()["detail"] == "password is required."


def test_duplicate_username_validation_normalizes_case_and_spacing(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login(client, "admin", "secret123")

        response = client.post("/cp/users", json={
            "username": " Alice ",
            "password": "userpass",
            "role": "user",
        })
        assert response.status_code == 201
        assert response.json()["user"]["username"] == "alice"

        response = client.post("/cp/users", json={
            "username": "ALICE",
            "password": "userpass",
            "role": "user",
        })
        assert response.status_code == 400
        assert response.json()["detail"] == "username already exists."


def test_bootstrap_validation_returns_client_errors(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))

        response = client.post("/auth/bootstrap", json={
            "token": "admin_token",
            "username": "",
            "password": "secret123",
        })
        assert response.status_code == 400
        assert response.json()["detail"] == "username is required."

        response = client.post("/auth/bootstrap", json={
            "token": "admin_token",
            "username": "admin",
            "password": "",
        })
        assert response.status_code == 400
        assert response.json()["detail"] == "password is required."


def test_regular_user_can_access_sessions_and_tasks_but_not_admin_panel(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login(client, "admin", "secret123")

        response = client.post("/cp/users", json={
            "username": "alice",
            "password": "userpass",
            "role": "user",
        })
        assert response.status_code == 201
        assert response.json()["user"]["role"] == "user"

        # Use a fresh client so the admin session cookie is not reused.
        user_client = TestClient(create_app(root))
        _login(user_client, "alice", "userpass")

        response = user_client.get("/auth/me")
        assert response.status_code == 200
        assert response.json()["user"]["role"] == "user"

        response = user_client.get("/sessions")
        assert response.status_code == 200
        response = user_client.get("/tasks")
        assert response.status_code == 200

        response = user_client.get("/cp/version")
        assert response.status_code == 403
        assert response.json()["detail"] == "Admin access required."

        response = user_client.get("/cp/users")
        assert response.status_code == 403
        assert response.json()["detail"] == "Admin access required."

        response = user_client.get("/cp/employees")
        assert response.status_code == 403
        assert response.json()["detail"] == "Admin access required."

        response = user_client.get("/cp/daemon-nodes")
        assert response.status_code == 403
        assert response.json()["detail"] == "Admin access required."

        response = user_client.post("/cp/users", json={
            "username": "bob",
            "password": "userpass",
            "role": "user",
        })
        assert response.status_code == 403

        response = user_client.post("/cp/daemon-nodes", json={
            "employeeId": "alice",
            "workspacePath": "/workspace/alice",
        })
        assert response.status_code == 403

        response = user_client.post("/cp/employees", json={
            "employeeId": "alice-2",
            "username": "alice2",
            "password": "userpass",
            "nodeId": "sbx_unassigned",
        })
        assert response.status_code == 403


def test_unauthenticated_user_cannot_access_sessions_or_admin_panel(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        bootstrap_client = TestClient(create_app(root))
        _bootstrap_admin(bootstrap_client)

        # Use a fresh client so no session cookie is present.
        client = TestClient(create_app(root))

        response = client.get("/sessions")
        assert response.status_code == 401

        response = client.get("/tasks")
        assert response.status_code == 401

        response = client.get("/cp/daemon-nodes")
        assert response.status_code == 401

        response = client.post("/cp/employees", json={
            "employeeId": "alice",
            "username": "alice",
            "password": "userpass",
            "nodeId": "sbx_unassigned",
        })
        assert response.status_code == 401


def test_user_routes_are_scoped_to_authenticated_employee(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        admin_client = TestClient(app)
        _bootstrap_admin(admin_client)
        _login(admin_client, "admin", "secret123")
        _create_user(admin_client, "alice", employee_id="alice")
        _create_user(admin_client, "bob", employee_id="bob")

        alice_client = TestClient(app)
        bob_client = TestClient(app)
        _login(alice_client, "alice", "userpass")
        _login(bob_client, "bob", "userpass")

        task_response = alice_client.post("/tasks", json={
            "title": "Alice task",
            "ownerEmployeeId": "bob",
            "createSession": True,
            "assignments": [{"agent": "claude"}],
        })
        assert task_response.status_code == 201
        task = task_response.json()
        assert task["ownerEmployeeId"] == "alice"
        session_id = task["linkedSessionIds"][0]
        session = alice_client.get(f"/sessions/{session_id}").json()
        assert session["ownerEmployeeId"] == "alice"

        assert bob_client.get("/tasks").json()["tasks"] == []
        assert bob_client.get("/sessions").json()["sessions"] == []
        assert bob_client.get(f"/tasks/{task['id']}").status_code == 403
        assert bob_client.patch(f"/tasks/{task['id']}", json={"status": "done"}).status_code == 403
        assert bob_client.post(f"/tasks/{task['id']}/assign", json={"agent": "codex"}).status_code == 403
        assert bob_client.post(f"/tasks/{task['id']}/pickup", json={"agent": "claude"}).status_code == 403
        assert bob_client.get(f"/tasks/{task['id']}/events").status_code == 403
        assert bob_client.get(f"/sessions/{session_id}").status_code == 403
        assert bob_client.post(f"/sessions/{session_id}/assignments", json={"assignments": [{"agent": "pi"}]}).status_code == 403
        assert bob_client.post(f"/sessions/{session_id}/decisions", json={"kind": "approve"}).status_code == 403
        assert bob_client.post(f"/sessions/{session_id}/handoffs", json={"targetAgent": "codex"}).status_code == 403
        assert bob_client.get(f"/sessions/{session_id}/events").status_code == 403

        artifact_id = session["artifacts"][0]["id"]
        assert bob_client.get(f"/sessions/{session_id}/artifacts/{artifact_id}").status_code == 403

        bob_task_response = admin_client.post("/tasks", json={
            "title": "Bob task",
            "ownerEmployeeId": "bob",
        })
        assert bob_task_response.status_code == 201
        bob_task = bob_task_response.json()
        assert alice_client.post("/sessions", json={
            "taskGoal": "Try linking Bob's task",
            "taskId": bob_task["id"],
        }).status_code == 403


def test_admin_can_create_resources_for_specific_employee(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login(client, "admin", "secret123")

        response = client.post("/tasks", json={
            "title": "Bob task",
            "ownerEmployeeId": "bob",
            "createSession": True,
        })

        assert response.status_code == 201
        task = response.json()
        assert task["ownerEmployeeId"] == "bob"

        response = client.post("/sessions", json={
            "taskGoal": "Admin-linked session",
            "taskId": task["id"],
        })
        assert response.status_code == 201
        assert response.json()["ownerEmployeeId"] == "bob"


def test_invalid_session_cookie_is_rejected(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        bootstrap_client = TestClient(create_app(root))
        _bootstrap_admin(bootstrap_client)

        client = TestClient(create_app(root))
        client.cookies.set("relay_session", "not-a-real-session")
        response = client.get("/auth/me")

        assert response.status_code == 401
        assert response.json()["detail"] == "Session expired or invalid."


def test_expired_session_is_rejected_and_removed(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)

        sessions_path = Path(root) / "auth" / "sessions.json"
        sessions = json.loads(sessions_path.read_text(encoding="utf-8"))
        sessions[0]["expiresAt"] = "2000-01-01T00:00:00.000Z"
        sessions_path.write_text(json.dumps(sessions), encoding="utf-8")

        response = client.get("/auth/me")

        assert response.status_code == 401
        assert response.json()["detail"] == "Session expired or invalid."
        assert json.loads(sessions_path.read_text(encoding="utf-8")) == []


def test_session_for_deleted_user_is_rejected(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        users_path = Path(root) / "auth" / "users.json"
        users_path.write_text("[]\n", encoding="utf-8")

        response = client.get("/auth/me")

        assert response.status_code == 401
        assert response.json()["detail"] == "User not found."


def test_auth_responses_do_not_expose_secret_fields(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        response = client.post("/auth/bootstrap", json={
            "token": "admin_token",
            "username": "admin",
            "password": "secret123",
        })
        assert response.status_code == 200
        _assert_no_secret_fields(response.json())

        response = client.post("/auth/login", json={
            "username": "admin",
            "password": "secret123",
        })
        assert response.status_code == 200
        _assert_no_secret_fields(response.json())

        response = client.get("/auth/me")
        assert response.status_code == 200
        _assert_no_secret_fields(response.json())

        response = client.post("/cp/users", json={
            "username": "alice",
            "password": "userpass",
            "role": "user",
        })
        assert response.status_code == 201
        _assert_no_secret_fields(response.json())

        response = client.get("/cp/users")
        assert response.status_code == 200
        _assert_no_secret_fields(response.json())


def test_control_panel_node_list_exposes_node_token_for_admins(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login(client, "admin", "secret123")

        create = client.post("/cp/daemon-nodes", json={
            "employeeId": "alice",
            "workspacePath": "/workspace/alice",
        })
        assert create.status_code == 201
        created_node_token = create.json()["nodeToken"]
        assert created_node_token.startswith("tok_")

        response = client.get("/cp/daemon-nodes")
        assert response.status_code == 200
        nodes = response.json()["nodes"]
        assert len(nodes) == 1
        assert nodes[0].get("nodeToken") == created_node_token
        # Other secrets must still be hidden from the control-panel list.
        assert "token" not in nodes[0]
        assert "tokenHash" not in nodes[0]
        assert "uiTokenHash" not in nodes[0]
        assert "nodeTokenHash" not in nodes[0]


def test_authenticated_user_can_list_own_sandbox_and_daemon_node_without_token(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login(client, "admin", "secret123")

        response = client.post("/cp/daemon-nodes", json={
            "employeeId": "alice",
            "workspacePath": "/workspace/alice",
        })
        assert response.status_code == 201
        response = client.post("/cp/daemon-nodes", json={
            "employeeId": "bob",
            "workspacePath": "/workspace/bob",
        })
        assert response.status_code == 201

        response = client.get("/sandboxes")
        assert response.status_code == 200
        assert {sandbox["employeeId"] for sandbox in response.json()["sandboxes"]} == {"alice", "bob"}
        _assert_no_secret_fields(response.json())

        response = client.get("/daemon-nodes")
        assert response.status_code == 200
        assert {node["employeeId"] for node in response.json()["nodes"]} == {"alice", "bob"}
        _assert_no_secret_fields(response.json())


def test_unauthenticated_user_can_list_all_sandboxes_and_daemon_nodes(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        admin_client = TestClient(create_app(root))
        _bootstrap_admin(admin_client)
        _login(admin_client, "admin", "secret123")

        response = admin_client.post("/cp/daemon-nodes", json={
            "employeeId": "alice",
            "workspacePath": "/workspace/alice",
        })
        assert response.status_code == 201
        response = admin_client.post("/cp/daemon-nodes", json={
            "employeeId": "bob",
            "workspacePath": "/workspace/bob",
        })
        assert response.status_code == 201

        # Use a fresh client with no session cookie.
        client = TestClient(create_app(root))

        response = client.get("/sandboxes")
        assert response.status_code == 200
        assert {sandbox["employeeId"] for sandbox in response.json()["sandboxes"]} == {"alice", "bob"}
        _assert_no_secret_fields(response.json())

        response = client.get("/daemon-nodes")
        assert response.status_code == 200
        assert {node["employeeId"] for node in response.json()["nodes"]} == {"alice", "bob"}
        _assert_no_secret_fields(response.json())

        # A stale/invalid bearer token should fall back to the public list, not 401.
        response = client.get("/sandboxes", headers={"Authorization": "Bearer invalid-token"})
        assert response.status_code == 200
        assert {sandbox["employeeId"] for sandbox in response.json()["sandboxes"]} == {"alice", "bob"}

        response = client.get("/daemon-nodes", headers={"Authorization": "Bearer invalid-token"})
        assert response.status_code == 200
        assert {node["employeeId"] for node in response.json()["nodes"]} == {"alice", "bob"}


def test_app_can_use_database_backed_auth_store(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    monkeypatch.setenv("RELAY_AUTH_STORE", "database")
    with TemporaryDirectory() as root:
        database_url = f"sqlite:///{root}/auth.db"
        monkeypatch.setenv("RELAY_DATABASE_URL", database_url)
        DatabaseUserAuthStore(database_url, create_schema=True)

        client = TestClient(create_app(root))
        response = client.post("/auth/bootstrap", json={
            "token": "admin_token",
            "username": "admin",
            "password": "secret123",
        })
        assert response.status_code == 200

        response = client.get("/auth/me")
        assert response.status_code == 200
        assert response.json()["user"]["role"] == "admin"

        second_client = TestClient(create_app(root))
        response = second_client.post("/auth/login", json={
            "username": "admin",
            "password": "secret123",
        })
        assert response.status_code == 200

        response = second_client.get("/cp/users")
        assert response.status_code == 200

        response = second_client.post("/cp/departments", json={
            "departmentId": "engineering",
            "name": "Engineering",
        })
        assert response.status_code == 201
        assert response.json()["department"]["id"] == "engineering"

        response = second_client.get("/cp/departments")
        assert response.status_code == 200
        assert response.json()["departments"][0]["name"] == "Engineering"

        response = second_client.post("/cp/users", json={
            "username": "eng-user",
            "password": "secret123",
            "role": "user",
            "employeeId": "eng-user",
            "departmentId": "engineering",
            "departmentName": "Engineering",
        })
        assert response.status_code == 201

        response = second_client.get("/cp/employees")
        assert response.status_code == 200
        assert response.json()["employees"][0]["id"] == "admin"
        employees_by_id = {employee["id"]: employee for employee in response.json()["employees"]}
        assert employees_by_id["eng-user"]["departmentId"] == "engineering"
        assert employees_by_id["eng-user"]["departmentName"] == "Engineering"

        response = second_client.post("/cp/daemon-nodes", json={
            "employeeId": "alice",
            "workspacePath": "/workspace/alice",
        })
        assert response.status_code == 201

        response = second_client.get("/cp/employees")
        assert response.status_code == 200
        employee_ids = {employee["id"] for employee in response.json()["employees"]}
        assert {"admin", "alice"}.issubset(employee_ids)


def test_relay_storage_postgres_switches_backend_stores_to_database(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    monkeypatch.setenv("RELAY_STORAGE", "postgres")
    monkeypatch.delenv("RELAY_AUTH_STORE", raising=False)
    monkeypatch.delenv("RELAY_DAEMON_STORE", raising=False)
    with TemporaryDirectory() as root:
        database_url = f"sqlite:///{root}/relay.db"
        monkeypatch.setenv("RELAY_DATABASE_URL", database_url)
        DatabaseSessionStore(database_url, root, create_schema=True)
        DatabaseTaskStore(database_url, create_schema=True)
        DatabaseDaemonStore(database_url, create_schema=True)
        DatabaseUserAuthStore(database_url, create_schema=True)

        app = create_app(root)
        assert isinstance(app.state.session_store, DatabaseSessionStore)
        assert isinstance(app.state.task_store, DatabaseTaskStore)
        assert isinstance(app.state.registry.daemon_store, DatabaseDaemonStore)
        assert isinstance(app.state.auth_store, DatabaseUserAuthStore)

        client = TestClient(app)
        _bootstrap_admin(client)
        response = client.post("/tasks", json={
            "title": "Persist task in DB",
            "description": "Create a DB-backed session too.",
            "createSession": True,
            "workspacePath": "/workspace",
        })
        assert response.status_code == 201
        task = response.json()
        assert task["linkedSessionIds"]

        assert app.state.task_store.get_task(task["id"])["id"] == task["id"]
        assert app.state.session_store.get_session(task["linkedSessionIds"][0])["taskGoal"].startswith("Persist task in DB")

        response = client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_unassigned",
            "token": "node_token",
            "workspacePath": "/workspace/unassigned",
            "protocolVersion": 1,
            "supportedAgents": ["claude"],
            "status": "ready",
        })
        assert response.status_code == 200
        assert "employeeId" not in app.state.registry.daemon_store.get_node("sbx_unassigned")

        response = client.post("/cp/employees", json={
            "employeeId": "db-user",
            "username": "db-user",
            "password": "secret123",
            "nodeId": "sbx_unassigned",
        })
        assert response.status_code == 201
        assert app.state.registry.daemon_store.get_node("sbx_unassigned")["employeeId"] == "db-user"
