from __future__ import annotations

from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from relay.app import create_app


def _bootstrap(client: TestClient) -> None:
    response = client.post("/auth/bootstrap", json={
        "token": "admin_token",
        "username": "admin",
        "password": "secret123",
    })
    assert response.status_code == 200
    response = client.post("/auth/login", json={"username": "admin", "password": "secret123"})
    assert response.status_code == 200


def _create_session(client: TestClient) -> str:
    response = client.post("/sessions", json={
        "taskGoal": "demo task",
        "assignments": [{"agent": "claude", "mode": "implement"}],
        "workspacePath": "/workspace",
    })
    assert response.status_code == 201
    return response.json()["id"]


def test_archive_endpoint_marks_session_archived(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)
        session_id = _create_session(client)

        # New session is not archived.
        snapshot = client.get(f"/sessions/{session_id}").json()
        assert snapshot.get("archived") is False

        # Archive it.
        response = client.post(f"/sessions/{session_id}/archive")
        assert response.status_code == 200
        assert response.json()["archived"] is True

        # Idempotent.
        again = client.post(f"/sessions/{session_id}/archive")
        assert again.status_code == 200
        assert again.json()["archived"] is True


def test_assign_session_rejects_archived(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)
        session_id = _create_session(client)
        client.post(f"/sessions/{session_id}/archive")

        response = client.post(f"/sessions/{session_id}/assignments", json={
            "assignments": [{"agent": "codex", "mode": "implement"}],
        })
        assert response.status_code == 409
        assert "archived" in response.json()["detail"].lower()


def test_archive_requires_known_session(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)

        response = client.post("/sessions/sess_unknown/archive")
        assert response.status_code == 404
