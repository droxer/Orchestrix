from __future__ import annotations

from pathlib import Path

import pytest

from relay.persistence.session_store import LocalSessionStore
from relay.sessions import compute_prior_handoff_note
from relay.sessions.controller import SessionArchivedError, SessionController


def test_compute_prior_handoff_note_requires_latest_decision_to_be_handoff() -> None:
    session = {
        "id": "ses_1",
        "createdAt": "2026-06-20T00:00:00.000Z",
        "events": [
            {
                "type": "human.decision",
                "timestamp": "2026-06-20T00:01:00.000Z",
                "decision": {
                    "kind": "handoff",
                    "targetAgent": "codex",
                    "note": "verify the fix",
                },
            },
            {
                "type": "human.decision",
                "timestamp": "2026-06-20T00:02:00.000Z",
                "decision": {
                    "kind": "rerun",
                    "targetAgent": "codex",
                },
            },
        ],
    }

    assert compute_prior_handoff_note(session, "codex") is None


def test_compute_prior_handoff_note_returns_latest_handoff_note() -> None:
    session = {
        "id": "ses_1",
        "createdAt": "2026-06-20T00:00:00.000Z",
        "events": [
            {
                "type": "human.decision",
                "timestamp": "2026-06-20T00:01:00.000Z",
                "decision": {
                    "kind": "handoff",
                    "targetAgent": "codex",
                    "note": "  verify the fix  ",
                },
            },
        ],
    }

    assert compute_prior_handoff_note(session, "codex") == "[Handoff note]\nverify the fix"


def test_compute_prior_handoff_note_targets_a_logical_agent() -> None:
    session = {
        "id": "ses_1",
        "createdAt": "2026-06-20T00:00:00.000Z",
        "events": [
            {
                "type": "human.decision",
                "timestamp": "2026-06-20T00:01:00.000Z",
                "decision": {
                    "kind": "handoff",
                    "targetAgent": "codex",
                    "targetAgentId": "agent_reviewer",
                    "note": "verify the fix",
                },
            },
        ],
    }

    assert (
        compute_prior_handoff_note(session, "codex", "agent_reviewer")
        == "[Handoff note]\nverify the fix"
    )
    assert compute_prior_handoff_note(session, "codex", "agent_builder") is None
    assert compute_prior_handoff_note(session, "codex") is None


def test_rejected_handoff_does_not_append_a_decision(tmp_path: Path) -> None:
    store = LocalSessionStore(tmp_path)
    controller = SessionController(store, owner_employee_id="alice")
    session = controller.create_session("Fix auth", ["human", "claude"])
    controller.archive_session(session["id"])

    with pytest.raises(SessionArchivedError):
        controller.handoff_session(
            session["id"],
            "codex",
            [{"agent": "codex"}],
            "verify the fix",
        )

    assert store.get_session(session["id"])["decisions"] == []
