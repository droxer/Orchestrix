from __future__ import annotations

from datetime import datetime, timedelta, timezone
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from relay.app import create_app
from relay.persistence.stores import relay_event


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
        "assignments": [{"agent": "claude", "mode": "action"}],
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


def test_dashboard_tokens_returns_reported_usage(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        session_id = _create_session(client)
        app.state.session_store.append_event(session_id, relay_event("agent.started", session_id, {
            "runId": "run_1",
            "agent": "codex",
            "role": "fixer",
            "mode": "action",
        }))
        app.state.session_store.append_event(session_id, relay_event("agent.completed", session_id, {
            "runId": "run_1",
            "agent": "codex",
            "status": "completed",
            "exitCode": 0,
            "tokenUsage": {"input": 10, "output": 5, "cache": 2, "total": 17, "source": "codex"},
        }))

        response = client.get("/cp/dashboard/tokens")
        assert response.status_code == 200
        body = response.json()
        assert body["available"] is True
        assert body["totalInput"] == 10
        assert body["totalOutput"] == 5
        assert body["totalCache"] == 2
        assert body["total"] == 17
        assert len(body["daily"]) == 14
        assert body["recentSessions"][0]["sessionId"] == session_id
        assert body["recentSessions"][0]["taskGoal"] == "demo"


def test_dashboard_tokens_totals_only_cover_last_seven_days(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        current_session_id = _create_session(client)
        old_session_id = _create_session(client)

        app.state.session_store.append_event(current_session_id, relay_event("agent.started", current_session_id, {
            "runId": "run_current",
            "agent": "codex",
            "role": "fixer",
            "mode": "action",
        }))
        app.state.session_store.append_event(current_session_id, relay_event("agent.completed", current_session_id, {
            "runId": "run_current",
            "agent": "codex",
            "status": "completed",
            "exitCode": 0,
            "tokenUsage": {"input": 10, "output": 5, "cache": 2, "total": 17, "source": "codex"},
        }))

        old_started = relay_event("agent.started", old_session_id, {
            "runId": "run_old",
            "agent": "codex",
            "role": "fixer",
            "mode": "action",
        })
        old_completed = relay_event("agent.completed", old_session_id, {
            "runId": "run_old",
            "agent": "codex",
            "status": "completed",
            "exitCode": 0,
            "tokenUsage": {"input": 100, "output": 50, "cache": 25, "total": 175, "source": "codex"},
        })
        old_timestamp = (datetime.now(timezone.utc) - timedelta(days=20)).isoformat()
        old_started["timestamp"] = old_timestamp
        old_completed["timestamp"] = old_timestamp
        app.state.session_store.append_event(old_session_id, old_started)
        app.state.session_store.append_event(old_session_id, old_completed)

        response = client.get("/cp/dashboard/tokens")
        assert response.status_code == 200
        body = response.json()
        assert body["totalInput"] == 10
        assert body["totalOutput"] == 5
        assert body["totalCache"] == 2
        assert body["total"] == 17
        assert {item["sessionId"] for item in body["recentSessions"]} == {current_session_id, old_session_id}
