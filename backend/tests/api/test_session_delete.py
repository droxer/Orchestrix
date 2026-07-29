from __future__ import annotations

from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient
from relay.app import create_app
from relay.sessions.controller import SessionController


def _bootstrap(client: TestClient) -> None:
    response = client.post("/api/v1/auth/bootstrap", json={
        "token": "admin_token",
        "username": "admin",
        "password": "secret123",
    })
    assert response.status_code == 200
    response = client.post("/api/v1/auth/login", json={"username": "admin", "password": "secret123"})
    assert response.status_code == 200


def _create_session(client: TestClient) -> str:
    response = client.post("/api/v1/threads", json={
        "taskGoal": "demo task",
        "assignments": [{"agent": "claude", "mode": "action"}],
        "workspacePath": "/workspace",
    })
    assert response.status_code == 201
    return response.json()["id"]


def test_delete_endpoint_removes_session(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)
        session_id = _create_session(client)

        response = client.delete(f"/api/v1/threads/{session_id}")
        assert response.status_code == 204

        assert client.get(f"/api/v1/threads/{session_id}").status_code == 404
        remaining = client.get("/api/v1/threads").json()
        sessions = remaining["sessions"] if isinstance(remaining, dict) else remaining
        assert all(item["id"] != session_id for item in sessions)


def test_delete_requires_known_session(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)

        response = client.delete("/api/v1/threads/sess_unknown")
        assert response.status_code == 404


def test_delete_rejects_session_with_active_daemon_run_request(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        session_id = _create_session(client)
        app.state.registry.daemon_store.create_run_request(
            {
                "nodeId": "sbx_alice",
                "sessionId": session_id,
                "taskGoal": "still finalizing",
                "assignments": [],
                "state": {},
            }
        )
        SessionController(app.state.registry.store).cancel_session(
            session_id, "stop requested"
        )

        response = client.delete(f"/api/v1/threads/{session_id}")

        assert response.status_code == 409
        assert response.json()["detail"] == "Session has a run in flight."
        assert client.get(f"/api/v1/threads/{session_id}").status_code == 200


def test_delete_removes_cancelled_session_with_orphaned_agent_run(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        session_id = _create_session(client)
        SessionController(app.state.registry.store).record_agent_started(
            session_id,
            {"runId": "run_orphaned", "agent": "claude", "mode": "action"},
        )
        cancelled = client.post(
            f"/api/v1/threads/{session_id}/cancellations",
            json={"reason": "stop clicked"},
        )
        assert cancelled.status_code == 202
        assert cancelled.json()["status"] == "cancelled"

        response = client.delete(f"/api/v1/threads/{session_id}")

        assert response.status_code == 204
        assert client.get(f"/api/v1/threads/{session_id}").status_code == 404


def test_delete_rejects_daemon_node_token(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        session_id = _create_session(client)
        app.state.registry.register(
            {
                "sandboxId": "sbx_alice",
                "employeeId": "alice",
                "token": "node_token",
                "protocolVersion": 1,
                "supportedAgents": ["claude"],
                "status": "ready",
            }
        )

        # A node token authenticates a daemon runtime, not a person; it must
        # not be able to permanently delete threads.
        anonymous = TestClient(app)
        response = anonymous.delete(
            f"/api/v1/threads/{session_id}",
            headers={"Authorization": "Bearer node_token"},
        )

        assert response.status_code == 401
        assert client.get(f"/api/v1/threads/{session_id}").status_code == 200


def test_delete_clears_chat_conversation_binding(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        session_id = _create_session(client)
        conversation = {"provider": "telegram", "conversationId": "conv_1"}
        app.state.chat_store.set_conversation_session(conversation, session_id, "admin")
        assert (
            app.state.chat_store.get_conversation_session(conversation)["sessionId"]
            == session_id
        )

        response = client.delete(f"/api/v1/threads/{session_id}")

        assert response.status_code == 204
        assert app.state.chat_store.get_conversation_session(conversation) is None
