from __future__ import annotations

from relay.sessions import compute_prior_handoff_note


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
