from __future__ import annotations

from tempfile import TemporaryDirectory

from relay.stores import DatabaseSessionStore, LocalSessionStore, relay_event


def test_session_store_persists_events_and_artifacts() -> None:
    with TemporaryDirectory() as root:
        store = LocalSessionStore(root)
        session = store.create_session({
            "workspacePath": "/workspace",
            "taskGoal": "fix auth",
            "participants": ["human", "claude"],
            "status": "pending_approval",
            "pendingDecision": "start",
        })
        store.append_event(session["id"], relay_event("human.decision", session["id"], {
            "decision": {"id": "dec_test", "kind": "approve", "createdAt": "2026-06-05T00:00:00.000Z"}
        }))
        artifact = store.write_artifact(session["id"], {"kind": "review", "title": "Agent review", "body": "Looks good.", "extension": "md"})
        updated = store.append_event(session["id"], relay_event("artifact.created", session["id"], {"artifact": artifact}))

        assert updated["events"][0]["type"] == "session.created"
        assert store.get_session(session["id"])["decisions"][0]["kind"] == "approve"
        assert store.read_artifact(session["id"], artifact["id"]) == "Looks good."


def test_database_session_store_persists_events_and_artifacts() -> None:
    with TemporaryDirectory() as root:
        store = DatabaseSessionStore(f"sqlite:///{root}/relay.db", root, create_schema=True)
        session = store.create_session({
            "workspacePath": "/workspace",
            "taskGoal": "fix auth",
            "participants": ["human", "claude"],
            "status": "pending_approval",
            "pendingDecision": "start",
        })
        store.append_event(session["id"], relay_event("human.decision", session["id"], {
            "decision": {"id": "dec_test", "kind": "approve", "createdAt": "2026-06-05T00:00:00.000Z"}
        }))
        artifact = store.write_artifact(session["id"], {"kind": "review", "title": "Agent review", "body": "Looks good.", "extension": "md"})
        updated = store.append_event(session["id"], relay_event("artifact.created", session["id"], {"artifact": artifact}))

        assert updated["events"][0]["type"] == "session.created"
        assert store.get_session(session["id"])["decisions"][0]["kind"] == "approve"
        assert store.list_sessions()[0]["id"] == session["id"]
        assert store.read_artifact(session["id"], artifact["id"]) == "Looks good."
