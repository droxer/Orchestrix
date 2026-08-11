from __future__ import annotations

from datetime import datetime, timedelta, timezone
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient
from relay.app import create_app
from relay.persistence.stores import relay_event


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
        "taskGoal": "demo",
        "assignments": [{"agent": "claude"}],
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

        response = client.get("/api/v1/admin/dashboard/sessions")
        assert response.status_code == 200
        body = response.json()
        assert body["total"] >= 1
        assert isinstance(body["dailyCounts"], list)
        assert len(body["dailyCounts"]) == 14
        assert all({"date", "count", "completed", "failed"} <= set(row) for row in body["dailyCounts"])
        assert isinstance(body["topEmployees"], list)
        assert isinstance(body["statusCounts"], dict)


def test_database_dashboard_avoids_full_session_and_token_history_reads(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        _create_session(client)

        def unexpected_full_read():
            raise AssertionError("dashboard must not materialize full history")

        monkeypatch.setattr(app.state.session_store, "list_sessions", unexpected_full_read)
        monkeypatch.setattr(app.state.session_store, "list_token_usage", unexpected_full_read)

        assert client.get("/api/v1/admin/dashboard/sessions").status_code == 200
        assert client.get("/api/v1/admin/dashboard/tokens").status_code == 200


def test_control_plane_metrics_reports_notification_health(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)

        response = client.get("/api/v1/admin/control-plane/metrics")

        assert response.status_code == 200
        assert response.json() == {
            "notifications": {
                "published": 0,
                "waits": 0,
                "woken": 0,
                    "timedOut": 0,
                    "activeWaiters": 0,
                    "activeKeys": 0,
                },
            "notificationBridge": {"enabled": False, "connected": False},
        }


def test_api_responses_expose_server_timing(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))

        response = client.get("/api")

        assert response.status_code == 200
        metric, value = response.headers["server-timing"].split(";dur=")
        assert metric == "app"
        assert float(value) >= 0


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
            }))
        app.state.session_store.append_event(session_id, relay_event("agent.completed", session_id, {
            "runId": "run_1",
            "agent": "codex",
            "status": "completed",
            "exitCode": 0,
            "tokenUsage": {"input": 10, "output": 5, "cache": 2, "total": 17, "source": "codex"},
        }))

        response = client.get("/api/v1/admin/dashboard/tokens")
        assert response.status_code == 200
        body = response.json()
        assert body["available"] is True
        assert body["totalInput"] == 10
        assert body["totalOutput"] == 5
        assert body["totalCache"] == 2
        assert body["total"] == 17
        assert body["unsupportedAgents"] == ["kimi"]
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

        response = client.get("/api/v1/admin/dashboard/tokens")
        assert response.status_code == 200
        body = response.json()
        assert body["totalInput"] == 10
        assert body["totalOutput"] == 5
        assert body["totalCache"] == 2
        assert body["total"] == 17
        assert {item["sessionId"] for item in body["recentSessions"]} == {current_session_id, old_session_id}


def test_dashboard_tokens_do_not_redate_old_usage_after_unrelated_session_activity(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        session_id = _create_session(client)
        old_timestamp = (datetime.now(timezone.utc) - timedelta(days=20)).isoformat()
        started = relay_event("agent.started", session_id, {
            "runId": "run_old",
            "agent": "codex",
            "role": "fixer",
            })
        completed = relay_event("agent.completed", session_id, {
            "runId": "run_old",
            "agent": "codex",
            "status": "completed",
            "exitCode": 0,
            "tokenUsage": {"input": 100, "output": 50, "cache": 25, "total": 175, "source": "codex"},
        })
        started["timestamp"] = old_timestamp
        completed["timestamp"] = old_timestamp
        app.state.session_store.append_event(session_id, started)
        app.state.session_store.append_event(session_id, completed)
        app.state.session_store.append_event(session_id, relay_event("human.decision", session_id, {
            "decision": {"id": "dec_recent", "kind": "approve", "createdAt": datetime.now(timezone.utc).isoformat()},
        }))

        response = client.get("/api/v1/admin/dashboard/tokens")

        assert response.status_code == 200
        body = response.json()
        assert body["available"] is False
        assert body["total"] == 0
        assert all(day["total"] == 0 for day in body["daily"])


def test_dashboard_tokens_aggregate_runs_without_double_counting_sessions(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        session_id = _create_session(client)
        for index, usage in enumerate((
            {"input": 10, "output": 5, "cache": 2, "total": 17, "source": "codex"},
            {"input": 20, "output": 7, "cache": 3, "total": 30, "source": "codex"},
        ), start=1):
            run_id = f"run_{index}"
            app.state.session_store.append_event(session_id, relay_event("agent.started", session_id, {
                "runId": run_id,
                "agent": "codex",
                "role": "fixer",
                }))
            app.state.session_store.append_event(session_id, relay_event("agent.completed", session_id, {
                "runId": run_id,
                "agent": "codex",
                "status": "completed",
                "exitCode": 0,
                "tokenUsage": usage,
            }))

        response = client.get("/api/v1/admin/dashboard/tokens")

        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 47
        assert body["byEmployee"][0]["sessionCount"] == 1
        assert len(body["recentSessions"]) == 1
        assert body["recentSessions"][0]["sessionId"] == session_id
        assert body["recentSessions"][0]["total"] == 47
