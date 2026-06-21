from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from tempfile import TemporaryDirectory

from sqlalchemy import text

from relay.stores import DatabaseSessionStore, LocalSessionStore, relay_event


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


def test_database_session_store_persists_events_and_artifacts() -> None:
    with TemporaryDirectory() as root:
        store = DatabaseSessionStore(f"sqlite:///{root}/relay.db", root, create_schema=True)
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
        usage = store.list_token_usage()[0]
        assert usage["taskGoal"] == "fix auth"
        assert usage["total"] == 10
        with store.engine.begin() as conn:
            row = conn.execute(text("select session_public_id, total_tokens from session_token_usage")).mappings().one()
        assert row["session_public_id"] == session["id"]
        assert row["total_tokens"] == 10
