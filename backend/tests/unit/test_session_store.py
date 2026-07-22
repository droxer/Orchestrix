from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory

from sqlalchemy import text

from relay.persistence.stores import DatabaseSessionStore, LocalSessionStore, relay_event


def test_session_stores_preserve_team_provenance() -> None:
    with TemporaryDirectory() as root:
        stores = (
            LocalSessionStore(Path(root) / "local"),
            DatabaseSessionStore(
                f"sqlite:///{root}/relay.db", create_schema=True
            ),
        )
        for store in stores:
            created = store.create_session(
                {
                    "workspacePath": "/workspace/alice",
                    "ownerEmployeeId": "alice",
                    "ownerAgentId": "agent_lead",
                    "teamId": "team_delivery",
                    "taskGoal": "ship the release",
                    "participants": ["human", "codex"],
                }
            )

            persisted = store.get_session(created["id"])
            assert persisted["teamId"] == "team_delivery"
            assert persisted["events"][0]["teamId"] == "team_delivery"
            assert store.list_sessions()[0]["teamId"] == "team_delivery"


def test_session_store_persists_events_and_artifacts() -> None:
    with TemporaryDirectory() as root:
        store = LocalSessionStore(root)
        session = store.create_session({
            "workspacePath": "/workspace",
            "taskGoal": "fix auth",
            "participants": ["human", "claude"],
        })
        store.append_event(session["id"], relay_event("human.decision", session["id"], {
            "decision": {"id": "dec_test", "kind": "approve", "createdAt": "2026-06-05T00:00:00.000Z"}
        }))
        artifact = store.write_artifact(session["id"], {"kind": "review", "title": "Agent review", "body": "Looks good.", "extension": "md"})
        updated = store.append_event(session["id"], relay_event("artifact.created", session["id"], {"artifact": artifact}))

        assert updated["events"][0]["type"] == "session.created"
        assert store.get_session(session["id"])["decisions"][0]["kind"] == "approve"
        assert store.read_artifact(session["id"], artifact["id"]) == "Looks good."


def test_session_store_create_artifact_indexes_artifact() -> None:
    with TemporaryDirectory() as root:
        store = LocalSessionStore(root)
        session = store.create_session({
            "workspacePath": "/workspace",
            "taskGoal": "fix auth",
            "participants": ["human", "claude"],
        })
        artifact, updated = store.create_artifact(session["id"], {"kind": "review", "title": "Agent review", "body": "  Looks good.\n\n", "extension": "md"})

        assert updated["artifacts"][0]["id"] == artifact["id"]
        assert store.read_artifact(session["id"], artifact["id"]) == "  Looks good.\n\n"


def test_local_session_store_serializes_concurrent_appends() -> None:
    with TemporaryDirectory() as root:
        store = LocalSessionStore(root)
        session = store.create_session({
            "workspacePath": "/workspace",
            "taskGoal": "collect decisions",
            "participants": ["human"],
        })

        def append(index: int) -> None:
            store.append_event(session["id"], relay_event("human.decision", session["id"], {
                "decision": {"id": f"dec_{index}", "kind": "approve", "createdAt": "2026-06-05T00:00:00.000Z"}
            }))

        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(append, range(25)))

        updated = store.get_session(session["id"])
        assert len(updated["decisions"]) == 25
        assert {decision["id"] for decision in updated["decisions"]} == {f"dec_{index}" for index in range(25)}


def test_session_store_clears_pending_decision_on_terminal_events() -> None:
    with TemporaryDirectory() as root:
        store = LocalSessionStore(root)
        session = store.create_session({
            "workspacePath": "/workspace",
            "taskGoal": "finish review",
            "participants": ["human", "codex"],
        })
        store.append_event(session["id"], relay_event("session.status", session["id"], {
            "status": "waiting_for_human",
            "phase": "feedback",
            "pendingDecision": "feedback",
        }))
        completed = store.append_event(session["id"], relay_event("session.completed", session["id"], {
            "outcome": "done",
        }))

        assert completed["status"] == "completed"
        assert "pendingDecision" not in completed


def test_session_store_clears_pending_decision_on_cancel_decision() -> None:
    with TemporaryDirectory() as root:
        store = LocalSessionStore(root)
        session = store.create_session({
            "workspacePath": "/workspace",
            "taskGoal": "cancel review",
            "participants": ["human", "codex"],
        })
        store.append_event(session["id"], relay_event("session.status", session["id"], {
            "status": "waiting_for_human",
            "phase": "feedback",
            "pendingDecision": "feedback",
        }))
        cancelled = store.append_event(session["id"], relay_event("human.decision", session["id"], {
            "decision": {
                "id": "dec_cancel",
                "kind": "cancel",
                "createdAt": "2026-06-20T00:00:00.000Z",
            }
        }))

        assert cancelled["status"] == "cancelled"
        assert "pendingDecision" not in cancelled


def test_database_session_store_persists_events_and_artifacts() -> None:
    with TemporaryDirectory() as root:
        store = DatabaseSessionStore(f"sqlite:///{root}/relay.db", create_schema=True)
        session = store.create_session({
            "workspacePath": "/workspace",
            "taskGoal": "fix auth",
            "participants": ["human", "claude"],
        })
        store.append_event(session["id"], relay_event("human.decision", session["id"], {
            "decision": {"id": "dec_test", "kind": "approve", "createdAt": "2026-06-05T00:00:00.000Z"}
        }))
        artifact = store.write_artifact(session["id"], {"kind": "review", "title": "Agent review", "body": "Looks good.", "extension": "md"})
        updated = store.append_event(session["id"], relay_event("artifact.created", session["id"], {"artifact": artifact}))
        store.append_event(session["id"], relay_event("agent.started", session["id"], {
            "runId": "run_1",
            "agent": "codex",
            "role": "fixer",
            "mode": "action",
        }))
        store.append_event(session["id"], relay_event("agent.completed", session["id"], {
            "runId": "run_1",
            "agent": "codex",
            "status": "completed",
            "exitCode": 0,
            "tokenUsage": {"input": 4, "output": 5, "cache": 1, "total": 10, "source": "codex"},
        }))

        assert updated["events"][0]["type"] == "session.created"
        assert store.get_session(session["id"])["decisions"][0]["kind"] == "approve"
        assert store.list_sessions()[0]["id"] == session["id"]
        assert store.read_artifact(session["id"], artifact["id"]) == "Looks good."
        assert not (Path(root) / "session-artifacts").exists()
        with store.engine.begin() as conn:
            content = conn.execute(text("select content from session_artifacts where public_id = :artifact_id"), {"artifact_id": artifact["id"]}).scalar_one()
        assert content == "Looks good."
        usage = store.list_token_usage()[0]
        assert usage["taskGoal"] == "fix auth"
        assert usage["total"] == 10
        with store.engine.begin() as conn:
            row = conn.execute(text("select session_public_id, total_tokens from session_token_usage")).mappings().one()
        assert row["session_public_id"] == session["id"]
        assert row["total_tokens"] == 10


def test_database_session_store_create_artifact_indexes_artifact() -> None:
    with TemporaryDirectory() as root:
        store = DatabaseSessionStore(f"sqlite:///{root}/relay.db", create_schema=True)
        session = store.create_session({
            "workspacePath": "/workspace",
            "taskGoal": "fix auth",
            "participants": ["human", "claude"],
        })
        artifact, updated = store.create_artifact(session["id"], {"kind": "review", "title": "Agent review", "body": "  Looks good.\n\n", "extension": "md"})

        assert updated["artifacts"][0]["id"] == artifact["id"]
        assert store.read_artifact(session["id"], artifact["id"]) == "  Looks good.\n\n"
        assert not (Path(root) / "session-artifacts").exists()


def _workspace_file_artifact(session_id: str) -> dict:
    return {
        "id": "art_deck",
        "kind": "workspace_file",
        "title": "deck.pptx",
        "path": f"/workspace/{session_id}/deck.pptx",
        "createdAt": "2026-07-01T00:00:00.000Z",
        "agentRunId": "run_1",
        "bytes": 10,
        "contentType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "workspaceRelativePath": "deck.pptx",
    }


def test_local_session_store_workspace_artifact_snapshot_roundtrip() -> None:
    with TemporaryDirectory() as root:
        store = LocalSessionStore(root)
        session = store.create_session({
            "workspacePath": "/workspace",
            "taskGoal": "build a deck",
            "participants": ["human", "codex"],
        })
        artifact, updated = store.index_workspace_artifact(session["id"], _workspace_file_artifact(session["id"]), b"pptx binary \x00 bytes")

        assert updated["artifacts"][0]["id"] == artifact["id"]
        assert artifact["bytes"] == len(b"pptx binary \x00 bytes")
        assert artifact["snapshotPath"].endswith(".pptx")
        assert store.read_artifact_content(session["id"], artifact["id"]) == b"pptx binary \x00 bytes"

        # Metadata-only indexing (no snapshot) still records the artifact.
        no_content, _updated = store.index_workspace_artifact(session["id"], {**_workspace_file_artifact(session["id"]), "id": "art_big"}, None)
        assert "snapshotPath" not in no_content
        assert store.read_artifact_content(session["id"], no_content["id"]) is None


def test_database_session_store_workspace_artifact_snapshot_roundtrip() -> None:
    with TemporaryDirectory() as root:
        store = DatabaseSessionStore(f"sqlite:///{root}/relay.db", create_schema=True)
        session = store.create_session({
            "workspacePath": "/workspace",
            "taskGoal": "build a deck",
            "participants": ["human", "codex"],
        })
        artifact, updated = store.index_workspace_artifact(session["id"], _workspace_file_artifact(session["id"]), b"pptx binary \x00 bytes")

        assert updated["artifacts"][0]["id"] == artifact["id"]
        assert artifact["bytes"] == len(b"pptx binary \x00 bytes")
        assert store.read_artifact_content(session["id"], artifact["id"]) == b"pptx binary \x00 bytes"
        with store.engine.begin() as conn:
            row = conn.execute(text("select kind, metadata from session_artifacts where public_id = :artifact_id"), {"artifact_id": artifact["id"]}).mappings().one()
        assert row["kind"] == "workspace_file"

        no_content, _updated = store.index_workspace_artifact(session["id"], {**_workspace_file_artifact(session["id"]), "id": "art_big"}, None)
        assert store.read_artifact_content(session["id"], no_content["id"]) is None
