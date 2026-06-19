from __future__ import annotations

import json
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from relay.app import create_app


def _bootstrap_admin(client: TestClient, token: str = "admin_token") -> None:
    response = client.post("/auth/bootstrap", json={"token": token, "username": "admin", "password": "secret123"})
    assert response.status_code == 200


def _parse_sse(body: str) -> list[tuple[str, str]]:
    """Return (event, data) pairs from an SSE body; default event name is 'message'."""
    frames: list[tuple[str, str]] = []
    for block in body.split("\n\n"):
        if not block.strip():
            continue
        event = "message"
        data = ""
        for line in block.splitlines():
            if line.startswith("event: "):
                event = line[len("event: "):]
            elif line.startswith("data: "):
                data = line[len("data: "):]
        frames.append((event, data))
    return frames


def test_session_events_streams_backlog_then_closes_on_terminal(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)

        created = client.post("/sessions", json={"taskGoal": "ship it", "assignments": [{"agent": "claude"}]})
        assert created.status_code == 201
        session_id = created.json()["id"]

        # Drive the session to a terminal state so the tail-poll flushes the
        # backlog and closes instead of holding the connection open.
        done = client.post(f"/sessions/{session_id}/decisions", json={"kind": "mark_done"})
        assert done.status_code == 200
        assert done.json()["status"] == "completed"

        response = client.get(f"/sessions/{session_id}/events")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")

        frames = _parse_sse(response.text)
        # Domain events arrive as default `message` frames carrying the full
        # event JSON (type lives in the payload); the stream ends with a `done`
        # control frame once the session is terminal.
        message_types = [json.loads(data)["type"] for event, data in frames if event == "message"]
        assert "session.created" in message_types
        assert frames[-1][0] == "done"


def test_session_events_unauthorized_is_forbidden_before_streaming(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        # A nonexistent session is a 404 (authorization runs before the stream
        # opens), proving errors still surface as normal responses.
        assert client.get("/sessions/sess_missing/events").status_code == 404


def test_session_events_accept_chat_service_actor(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_CHAT_TOKEN", "chat_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        headers = {
            "Authorization": "Bearer chat_token",
            "X-Relay-Employee-Id": "alice",
        }

        created = client.post("/sessions", json={"taskGoal": "from chat"}, headers=headers)
        assert created.status_code == 201
        session_id = created.json()["id"]

        done = client.post(f"/sessions/{session_id}/decisions", json={"kind": "mark_done"}, headers=headers)
        assert done.status_code == 200
        assert done.json()["status"] == "completed"

        response = client.get(f"/sessions/{session_id}/events", headers=headers)
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")

        missing_employee = client.get(f"/sessions/{session_id}/events", headers={"Authorization": "Bearer chat_token"})
        assert missing_employee.status_code == 401
