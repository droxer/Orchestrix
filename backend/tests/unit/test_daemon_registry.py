from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from tempfile import TemporaryDirectory

import pytest

from relay.daemon import DaemonNodeRegistry, ServerDaemonNodeBackend, sandbox_ui_token_matches
from relay.stores import DatabaseDaemonStore, LocalDaemonStore, LocalSessionStore


def test_explicit_sandbox_provision_targets_requested_node() -> None:
    with TemporaryDirectory() as root:
        session_store = LocalSessionStore(root)
        daemon_store = LocalDaemonStore(root)
        registry = DaemonNodeRegistry(session_store, daemon_store)
        backend = ServerDaemonNodeBackend(registry)
        registry.register({
            "sandboxId": "sbx_bob",
            "employeeId": "bob",
            "token": "node_token",
            "workspacePath": "/workspace/bob",
            "protocolVersion": 1,
            "supportedAgents": ["claude"],
            "status": "ready",
        }, "old_ui_token")

        sandbox = backend.provision({
            "employeeId": "admin",
            "sandboxId": "sbx_bob",
            "workspacePath": "/workspace/admin",
            "token": "new_ui_token",
            "nodeToken": "node_token",
        })

        assert sandbox["id"] == "sbx_bob"
        assert sandbox["employeeId"] == "bob"
        assert sandbox["status"] == "ready"
        assert sandbox_ui_token_matches(registry.get("sbx_bob") or {}, "new_ui_token")


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
            session = await run_task
            assert session["status"] == "running"
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
                "reviewVerdict": "approved",
                "reviewFeedback": "ok",
            }, "node_token")

            session = session_store.get_session(session["id"])
            assert session["status"] == "completed"
            assert session["reviewVerdict"] == "approved"
            assert registry.monitor_nodes()[0]["queuedCommandCount"] == 0

    asyncio.run(run_flow())


def test_daemon_terminal_event_after_registry_restart_finalizes_session() -> None:
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

            session = await backend.run("sbx_alice", {
                "taskGoal": "implement auth",
                "assignments": [{"agent": "codex", "mode": "implement"}],
            })
            [command] = registry.take_commands("sbx_alice", "node_token")

            restarted = DaemonNodeRegistry(session_store, LocalDaemonStore(root))
            restarted.handle_event("sbx_alice", {
                "type": "run.completed",
                "commandId": command["id"],
                "sessionId": command["sessionId"],
                "runId": command["runId"],
                "agent": "codex",
                "mode": "implement",
                "exitCode": 0,
                "agentLog": "done",
            }, "node_token")

            assert session_store.get_session(session["id"])["status"] == "completed"

    asyncio.run(run_flow())


def test_daemon_cancel_event_clears_active_run_request() -> None:
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
                "supportedAgents": ["claude"],
                "status": "ready",
            }, "ui_token")

            session = await backend.run("sbx_alice", {
                "taskGoal": "stop this",
                "assignments": [{"agent": "claude", "mode": "implement"}],
            })
            [command] = registry.take_commands("sbx_alice", "node_token")
            registry.cancel_active_run("sbx_alice", session["id"], "no longer needed")
            [cancel] = registry.take_commands("sbx_alice", "node_token")
            assert cancel["type"] == "run.cancel"
            registry.handle_event("sbx_alice", {
                "type": "run.cancelled",
                "commandId": command["id"],
                "sessionId": command["sessionId"],
                "runId": command["runId"],
                "agent": "claude",
                "mode": "implement",
                "reason": "no longer needed",
            }, "node_token")

            assert session_store.get_session(session["id"])["status"] == "cancelled"
            assert daemon_store.list_active_run_requests("sbx_alice") == []

    asyncio.run(run_flow())


def test_daemon_run_timeout_marks_session_failed(monkeypatch) -> None:
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

            session = await backend.run("sbx_alice", {
                "taskGoal": "hang",
                "assignments": [{"agent": "codex", "mode": "implement"}],
            })
            [command] = registry.take_commands("sbx_alice", "node_token")
            [request] = daemon_store.list_active_run_requests("sbx_alice")
            daemon_store.update_run_request(request["id"], {"currentStartedAt": "2020-01-01T00:00:00.000Z"})

            monkeypatch.setattr("relay.daemon.DAEMON_RUN_TIMEOUT_MS", 1)
            registry.reap_stale_runs()

            failed = session_store.get_session(session["id"])
            assert failed["status"] == "failed"
            assert "timed out" in failed["finalOutcome"]
            assert daemon_store.list_active_run_requests("sbx_alice") == []
            assert command["id"] not in registry.active_commands

    monkeypatch.setattr("relay.daemon.DAEMON_RUN_TIMEOUT_MS", 60_000)
    asyncio.run(run_flow())


def test_database_daemon_store_redacts_plaintext_node_token() -> None:
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


def test_database_daemon_store_claims_queued_commands_once() -> None:
    with TemporaryDirectory() as root:
        store = DatabaseDaemonStore(f"sqlite:///{root}/daemon.db", create_schema=True)
        store.register_node({
            "id": "sbx_alice",
            "employeeId": "alice",
            "workspacePath": "/workspace/alice",
            "status": "ready",
            "agents": {"codex": "ready"},
            "token": None,
            "nodeToken": "tok_secret",
            "nodeTokenHash": "sha256:hash",
            "createdAt": "2026-06-13T00:00:00.000Z",
            "updatedAt": "2026-06-13T00:00:00.000Z",
        })
        store.enqueue_command("sbx_alice", {
            "id": "cmd_once",
            "type": "run.start",
            "sessionId": "ses_1",
            "runId": "run_1",
            "agent": "codex",
            "mode": "implement",
            "taskGoal": "fix auth",
        })

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: store.take_queued_commands("sbx_alice"), range(2)))

        claimed = [command for commands in results for command in commands]
        assert [command["id"] for command in claimed] == ["cmd_once"]
        assert store.queued_command_count("sbx_alice") == 0


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


def test_daemon_run_dispatch_rejects_concurrent_second_claim() -> None:
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

        def run_once() -> str:
            try:
                asyncio.run(backend.run("sbx_alice", {
                    "taskGoal": "fix auth",
                    "assignments": [{"agent": "codex", "mode": "implement"}],
                }))
                return "started"
            except ValueError as error:
                return str(error)

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: run_once(), range(2)))

        assert results.count("started") == 1
        assert any("not ready" in result for result in results)


def test_set_disabled_agents_blocks_dispatch_and_survives_restart() -> None:
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
                "supportedAgents": ["claude", "codex"],
                "status": "ready",
            }, "ui_token")

            registry.set_disabled_agents("sbx_alice", ["codex"])
            assert registry.get("sbx_alice")["disabledAgents"] == ["codex"]

            with pytest.raises(ValueError, match="disabled agent\\(s\\): codex"):
                await backend.run("sbx_alice", {
                    "taskGoal": "review auth",
                    "assignments": [{"agent": "codex", "mode": "review"}],
                })

            session = await backend.run("sbx_alice", {
                "taskGoal": "implement auth",
                "assignments": [{"agent": "claude", "mode": "implement"}],
            })
            assert session["status"] == "running"

            registry2 = DaemonNodeRegistry(LocalSessionStore(root), LocalDaemonStore(root))
            assert registry2.get("sbx_alice")["disabledAgents"] == ["codex"]

            registry.set_disabled_agents("sbx_alice", [])
            assert "disabledAgents" not in registry.get("sbx_alice")

            with pytest.raises(ValueError, match="Unknown agent"):
                registry.set_disabled_agents("sbx_alice", ["bogus"])

    asyncio.run(run_flow())
