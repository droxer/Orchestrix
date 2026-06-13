from __future__ import annotations

import asyncio
from tempfile import TemporaryDirectory

import pytest

from relay.daemon import DaemonNodeRegistry, ServerDaemonNodeBackend
from relay.stores import DatabaseDaemonStore, LocalDaemonStore, LocalSessionStore


def test_daemon_registration_poll_and_completion_updates_session() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register({
                "sandboxId": "sbx_alice",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            }, "ui_token")

            run_task = asyncio.create_task(backend.run("sbx_alice", {
                "taskGoal": "review auth",
                "assignments": [{"agent": "codex", "mode": "review"}],
            }))
            await asyncio.sleep(0)
            [command] = registry.take_commands("sbx_alice", "node_token")
            registry.handle_event("sbx_alice", {
                "type": "run.output",
                "commandId": command["id"],
                "sessionId": command["sessionId"],
                "runId": command["runId"],
                "agent": "codex",
                "stream": "stdout",
                "text": "approved",
                "sequence": 0,
            }, "node_token")
            registry.handle_event("sbx_alice", {
                "type": "run.completed",
                "commandId": command["id"],
                "sessionId": command["sessionId"],
                "runId": command["runId"],
                "agent": "codex",
                "mode": "review",
                "exitCode": 0,
                "agentLog": "approved",
                "codexVerdict": "approved",
                "codexFeedback": "ok",
            }, "node_token")

            session = await run_task
            assert session["status"] == "completed"
            assert session["reviewVerdict"] == "approved"
            assert registry.monitor_nodes()[0]["queuedCommandCount"] == 0

    asyncio.run(run_flow())


def test_database_daemon_store_does_not_persist_plaintext_node_tokens() -> None:
    with TemporaryDirectory() as root:
        store = DatabaseDaemonStore(f"sqlite:///{root}/daemon.db", create_schema=True)
        store.register_node({
            "id": "sbx_alice",
            "employeeId": "alice",
            "workspacePath": "/workspace/alice",
            "status": "provisioning",
            "agents": {"codex": "unknown"},
            "token": None,
            "nodeToken": "tok_secret",
            "nodeTokenHash": "sha256:hash",
            "createdAt": "2026-06-13T00:00:00.000Z",
            "updatedAt": "2026-06-13T00:00:00.000Z",
            "lastError": "Waiting for daemon node registration.",
        })

        [node] = store.list_nodes()
        assert node["id"] == "sbx_alice"
        assert node["nodeTokenHash"] == "sha256:hash"
        assert "nodeToken" not in node
        assert node["token"] is None


def test_daemon_run_rejects_ownerless_sessions() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            session = session_store.create_session({
                "workspacePath": "/workspace/alice",
                "taskGoal": "legacy ownerless session",
                "participants": ["human", "claude"],
            })
            registry.register({
                "sandboxId": "sbx_alice",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["claude"],
                "status": "ready",
            }, "ui_token")

            with pytest.raises(PermissionError, match="has no owner"):
                await backend.run("sbx_alice", {
                    "sessionId": session["id"],
                    "taskGoal": "legacy ownerless session",
                    "assignments": [{"agent": "claude", "mode": "implement"}],
                })

    asyncio.run(run_flow())
