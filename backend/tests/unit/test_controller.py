from __future__ import annotations

from tempfile import TemporaryDirectory

from relay.controller import SessionController, initial_agent_state
from relay.stores import LocalSessionStore


def test_session_controller_records_review_verdict() -> None:
    with TemporaryDirectory() as root:
        store = LocalSessionStore(root)
        controller = SessionController(store, workspace_path="/workspace")
        session = controller.create_session("review diff")
        state = initial_agent_state("review diff")
        controller.record_agent_started(session["id"], {"runId": "run_1", "agent": "codex", "mode": "review"})
        state = controller.record_agent_completed(session["id"], state, {
            "runId": "run_1",
            "agent": "codex",
            "mode": "review",
            "status": "completed",
            "exitCode": 0,
            "agentLog": "approved",
            "codexVerdict": "approved",
            "codexFeedback": "ok",
        })

        updated = store.get_session(session["id"])
        assert state["codex_verdict"] == "approved"
        assert updated["reviewVerdict"] == "approved"
        assert updated["agentRuns"][0]["artifactIds"]
