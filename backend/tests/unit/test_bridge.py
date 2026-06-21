from __future__ import annotations

from typing import Any

from relay.bridge import compute_prior_agent_bridge, extract_last_assistant_text


def test_extract_last_assistant_text_empty_returns_none() -> None:
    assert extract_last_assistant_text("") is None
    assert extract_last_assistant_text("   \n\n") is None


def test_extract_last_assistant_text_no_marker_returns_none() -> None:
    assert extract_last_assistant_text("no marker here\njust text") is None


def test_extract_last_assistant_text_returns_last_segment() -> None:
    transcript = "● first turn\nsome body\n● second turn\nthe answer\n⏺ tool noise"
    assert extract_last_assistant_text(transcript) == "second turn\nthe answer"


def test_extract_last_assistant_text_strips_thinking_and_tool_lines() -> None:
    transcript = "○ thinking line\n● real text\nbody\n⏺ tool"
    assert extract_last_assistant_text(transcript) == "real text\nbody"


def test_extract_last_assistant_text_falls_back_when_segments_are_empty() -> None:
    assert extract_last_assistant_text("●   \n   \n") is None


class _FakeStore:
    def __init__(self, bodies: dict[str, str]) -> None:
        self._bodies = bodies

    def read_artifact(self, session_id: str, artifact_id: str) -> str:
        return self._bodies[artifact_id]


def _session(
    runs: list[dict[str, Any]],
    artifacts: list[dict[str, Any]],
) -> dict[str, Any]:
    return {"id": "sess_1", "agentRuns": runs, "artifacts": artifacts}


def test_compute_prior_agent_bridge_returns_none_when_no_intervening_runs() -> None:
    session = _session([{"agent": "claude", "artifactIds": ["a1"]}], [{"id": "a1", "kind": "command_log"}])
    store = _FakeStore({"a1": "● anything\nbody"})
    assert compute_prior_agent_bridge(session, "claude", store) is None


def test_compute_prior_agent_bridge_builds_single_intervening_block() -> None:
    session = _session(
        [
            {"agent": "claude", "artifactIds": ["a1"]},
            {"agent": "codex", "artifactIds": ["a2"]},
        ],
        [
            {"id": "a1", "kind": "command_log"},
            {"id": "a2", "kind": "command_log"},
        ],
    )
    store = _FakeStore({"a1": "● claude work", "a2": "● review note\ndetail"})
    out = compute_prior_agent_bridge(session, "claude", store)
    assert out == "[Previous from @codex]\nreview note\ndetail"


def test_compute_prior_agent_bridge_uses_no_output_when_artifact_missing() -> None:
    session = _session(
        [
            {"agent": "claude", "artifactIds": ["a1"]},
            {"agent": "codex", "artifactIds": ["missing"]},
        ],
        [{"id": "a1", "kind": "command_log"}],
    )
    store = _FakeStore({"a1": "● claude work"})
    out = compute_prior_agent_bridge(session, "claude", store)
    assert out == "[Previous from @codex]\n<no output>"


def test_compute_prior_agent_bridge_skips_runs_before_last_own_run() -> None:
    session = _session(
        [
            {"agent": "codex", "artifactIds": ["old"]},
            {"agent": "claude", "artifactIds": ["mine"]},
            {"agent": "codex", "artifactIds": ["recent"]},
        ],
        [
            {"id": "old", "kind": "command_log"},
            {"id": "mine", "kind": "command_log"},
            {"id": "recent", "kind": "command_log"},
        ],
    )
    store = _FakeStore({"old": "● old work", "mine": "● my work", "recent": "● recent work"})
    out = compute_prior_agent_bridge(session, "claude", store)
    assert "old work" not in out
    assert "[Previous from @codex]\nrecent work" in out


def test_compute_prior_agent_bridge_chronological_multiple_runs() -> None:
    session = _session(
        [
            {"agent": "claude", "artifactIds": ["a"]},
            {"agent": "pi", "artifactIds": ["p"]},
            {"agent": "codex", "artifactIds": ["c"]},
        ],
        [
            {"id": "a", "kind": "command_log"},
            {"id": "p", "kind": "command_log"},
            {"id": "c", "kind": "command_log"},
        ],
    )
    store = _FakeStore({"a": "● a body", "p": "● p body", "c": "● c body"})
    out = compute_prior_agent_bridge(session, "claude", store)
    pi_idx = out.find("[Previous from @pi]")
    cx_idx = out.find("[Previous from @codex]")
    assert pi_idx >= 0 and cx_idx > pi_idx


def test_compute_prior_agent_bridge_only_uses_runs_after_latest_user_message() -> None:
    session = {
        "id": "sess_1",
        "createdAt": "2026-06-20T00:00:00.000Z",
        "taskGoal": "first turn",
        "events": [
            {
                "type": "user.message",
                "timestamp": "2026-06-20T00:02:00.000Z",
                "text": "follow up",
            }
        ],
        "agentRuns": [
            {
                "agent": "claude",
                "status": "completed",
                "completedAt": "2026-06-20T00:01:00.000Z",
                "artifactIds": ["old"],
            },
            {
                "agent": "pi",
                "status": "completed",
                "completedAt": "2026-06-20T00:03:00.000Z",
                "artifactIds": ["recent"],
            },
        ],
        "artifacts": [
            {"id": "old", "kind": "command_log"},
            {"id": "recent", "kind": "command_log"},
        ],
    }
    store = _FakeStore({"old": "● old answer", "recent": "● current-turn note"})

    out = compute_prior_agent_bridge(session, "codex", store)

    assert out == "[Previous from @pi]\ncurrent-turn note"
