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
        "assignments": [{"agent": "claude", "mode": "action"}],
        "workspacePath": "/workspace",
    })
    assert response.status_code == 201
    return response.json()["id"]


def test_rename_endpoint_sets_title(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)
        session_id = _create_session(client)

        # Fresh session has no title; label falls back to taskGoal.
        snapshot = client.get(f"/sessions/{session_id}").json()
        assert snapshot.get("title") is None

        response = client.post(f"/sessions/{session_id}/title", json={"title": "Auth bug"})
        assert response.status_code == 200
        assert response.json()["title"] == "Auth bug"

        # Title persists through replay (read back from a fresh materialization).
        reread = client.get(f"/sessions/{session_id}").json()
        assert reread["title"] == "Auth bug"


def test_rename_rejects_empty_title(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)
        session_id = _create_session(client)

        response = client.post(f"/sessions/{session_id}/title", json={"title": "   "})
        assert response.status_code == 400


def test_rename_requires_known_session(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)

        response = client.post("/sessions/sess_unknown/title", json={"title": "x"})
        assert response.status_code == 404
