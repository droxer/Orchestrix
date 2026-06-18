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
        "taskGoal": "demo",
        "assignments": [{"agent": "claude", "mode": "implement"}],
        "workspacePath": "/workspace",
    })
    assert response.status_code == 201
    return response.json()["id"]


def test_dashboard_sessions_returns_shape(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)
        _create_session(client)

        response = client.get("/cp/dashboard/sessions")
        assert response.status_code == 200
        body = response.json()
        assert body["total"] >= 1
        assert isinstance(body["dailyCounts"], list)
        assert len(body["dailyCounts"]) == 14
        assert all({"date", "count", "completed", "failed"} <= set(row) for row in body["dailyCounts"])
        assert isinstance(body["topEmployees"], list)
        assert isinstance(body["statusCounts"], dict)


def test_dashboard_activity_returns_recent_items(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)
        _create_session(client)

        response = client.get("/cp/dashboard/activity?limit=5")
        assert response.status_code == 200
        body = response.json()
        assert isinstance(body["items"], list)
        assert len(body["items"]) >= 1
        first = body["items"][0]
        assert {"kind", "timestamp", "message"} <= set(first)
