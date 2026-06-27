from __future__ import annotations

from typing import Any

from relay.sessions import compute_conversation_history


class _FakeStore:
    def __init__(self, bodies: dict[str, str]) -> None:
        self._bodies = bodies

    def read_artifact(self, session_id: str, artifact_id: str) -> str:
        return self._bodies[artifact_id]


def _session(
    *,
    task_goal: str = "first question",
    events: list[dict[str, Any]] | None = None,
    runs: list[dict[str, Any]] | None = None,
    artifacts: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "id": "ses_1",
        "createdAt": "2026-06-20T00:00:00.000Z",
        "taskGoal": task_goal,
        "events": events or [],
        "agentRuns": runs or [],
        "artifacts": artifacts or [],
    }


def test_compute_conversation_history_returns_none_for_first_turn() -> None:
    assert compute_conversation_history(_session(), _FakeStore({})) is None


def test_compute_conversation_history_includes_turns_before_latest_user_message() -> None:
    session = _session(
        events=[
            {
                "type": "user.message",
                "timestamp": "2026-06-20T00:02:00.000Z",
                "text": "follow up",
            }
        ],
        runs=[
            {
                "id": "run_1",
                "agent": "claude",
                "status": "completed",
                "startedAt": "2026-06-20T00:00:10.000Z",
                "completedAt": "2026-06-20T00:01:00.000Z",
                "artifactIds": [],
                "agentLog": "● first answer\nwith detail",
            }
        ],
        artifacts=[],
    )

    out = compute_conversation_history(session, _FakeStore({}))

    assert out == (
        "[Conversation so far]\n\n"
        "[User]\nfirst question\n\n"
        "[Assistant @claude]\nfirst answer\nwith detail"
    )


def test_compute_conversation_history_excludes_agent_runs_after_latest_user_message() -> None:
    session = _session(
        events=[
            {
                "type": "user.message",
                "timestamp": "2026-06-20T00:02:00.000Z",
                "text": "follow up",
            }
        ],
        runs=[
            {
                "id": "run_old",
                "agent": "claude",
                "status": "completed",
                "startedAt": "2026-06-20T00:00:10.000Z",
                "completedAt": "2026-06-20T00:01:00.000Z",
                "artifactIds": ["old"],
            },
            {
                "id": "run_current",
                "agent": "pi",
                "status": "completed",
                "startedAt": "2026-06-20T00:02:10.000Z",
                "completedAt": "2026-06-20T00:03:00.000Z",
                "artifactIds": ["current"],
            },
        ],
        artifacts=[
            {"id": "old", "kind": "command_log"},
            {"id": "current", "kind": "command_log"},
        ],
    )

    out = compute_conversation_history(
        session,
        _FakeStore({"old": "● older answer", "current": "● current-turn answer"}),
    )

    assert out is not None
    assert "older answer" in out
    assert "follow up" not in out
    assert "current-turn answer" not in out
