from __future__ import annotations

import asyncio
import base64
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from relay.daemon_registry import (
    DaemonNodeRegistry,
    ServerDaemonNodeBackend,
    effective_role_for_assignment,
    sandbox_ui_token_matches,
)
from relay.persistence.agent_placement_store import LocalAgentPlacementStore
from relay.persistence.agent_store import LocalAgentStore
from relay.persistence.stores import (
    DatabaseDaemonStore,
    LocalDaemonStore,
    LocalSessionStore,
)
from relay.sessions import SessionController


def database_daemon_store(root: str) -> DatabaseDaemonStore:
    return DatabaseDaemonStore(f"sqlite:///{root}/daemon.db", create_schema=True)


DAEMON_STORE_FACTORIES = [LocalDaemonStore, database_daemon_store]


def store_node_payload() -> dict[str, object]:
    return {
        "id": "sbx_alice",
        "employeeId": "alice",
        "workspacePath": "/workspace/alice",
        "workspaceId": "repo:relay",
        "status": "ready",
        "agents": {"codex": "ready"},
        "token": None,
        "nodeToken": "tok_secret",
        "nodeTokenHash": "sha256:hash",
        "createdAt": "2026-06-13T00:00:00.000Z",
        "updatedAt": "2026-06-13T00:00:00.000Z",
    }


def run_start_command(command_id: str, run_id: str) -> dict[str, str]:
    return {
        "id": command_id,
        "type": "run.start",
        "sessionId": f"ses_{run_id}",
        "runId": run_id,
        "agent": "codex",
        "mode": "action",
        "taskGoal": "fix auth",
    }


def test_explicit_sandbox_provision_targets_requested_node() -> None:
    with TemporaryDirectory() as root:
        session_store = LocalSessionStore(root)
        daemon_store = LocalDaemonStore(root)
        registry = DaemonNodeRegistry(session_store, daemon_store)
        backend = ServerDaemonNodeBackend(registry)
        registry.register(
            {
                "sandboxId": "sbx_bob",
                "employeeId": "bob",
                "token": "node_token",
                "workspacePath": "/workspace/bob",
                "protocolVersion": 1,
                "supportedAgents": ["claude"],
                "status": "ready",
            },
            "old_ui_token",
        )

        sandbox = backend.provision(
            {
                "employeeId": "admin",
                "sandboxId": "sbx_bob",
                "workspacePath": "/workspace/admin",
                "token": "new_ui_token",
                "nodeToken": "node_token",
            }
        )

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
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )

            run_task = asyncio.create_task(
                backend.run(
                    "sbx_alice",
                    {
                        "taskGoal": "review auth",
                        "assignments": [{"agent": "codex", "mode": "review"}],
                    },
                )
            )
            await asyncio.sleep(0)
            session = await run_task
            assert session["status"] == "running"
            [command] = registry.take_commands("sbx_alice", "node_token")
            registry.handle_event(
                "sbx_alice",
                {
                    "type": "run.output",
                    "commandId": command["id"],
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": "codex",
                    "stream": "stdout",
                    "text": "approved",
                    "sequence": 0,
                },
                "node_token",
            )
            registry.handle_event(
                "sbx_alice",
                {
                    "type": "run.completed",
                    "commandId": command["id"],
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": "codex",
                    "mode": "review",
                    "exitCode": 0,
                    "agentLog": "looks fine",
                },
                "node_token",
            )

            session = session_store.get_session(session["id"])
            assert session["status"] == "completed"
            assert "reviewVerdict" not in session
            assert registry.monitor_nodes()[0]["queuedCommandCount"] == 0

    asyncio.run(run_flow())


def test_daemon_output_dedupe_hydrates_existing_sequences_once_after_restart(
    monkeypatch,
) -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )

            session = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "review auth",
                    "assignments": [{"agent": "codex", "mode": "review"}],
                },
            )
            [command] = registry.take_commands("sbx_alice", "node_token")
            registry.handle_event(
                "sbx_alice",
                {
                    "type": "run.output",
                    "commandId": command["id"],
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": "codex",
                    "stream": "stdout",
                    "text": "first",
                    "sequence": 0,
                },
                "node_token",
            )
            registry.handle_event(
                "sbx_alice",
                {
                    "type": "run.output",
                    "commandId": command["id"],
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": "codex",
                    "stream": "stderr",
                    "text": "stderr-first",
                    "sequence": 0,
                },
                "node_token",
            )

            restarted = DaemonNodeRegistry(
                LocalSessionStore(root), LocalDaemonStore(root)
            )
            scan_count = 0
            original = restarted._session_output_sequences

            def counted_session_output_sequences(
                session_id: str, run_id: str
            ) -> set[tuple[str, int]]:
                nonlocal scan_count
                scan_count += 1
                return original(session_id, run_id)

            monkeypatch.setattr(
                restarted, "_session_output_sequences", counted_session_output_sequences
            )
            restarted.handle_event(
                "sbx_alice",
                {
                    "type": "run.output",
                    "commandId": command["id"],
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": "codex",
                    "stream": "stdout",
                    "text": "duplicate",
                    "sequence": 0,
                },
                "node_token",
            )
            restarted.handle_event(
                "sbx_alice",
                {
                    "type": "run.output",
                    "commandId": command["id"],
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": "codex",
                    "stream": "stdout",
                    "text": "second",
                    "sequence": 1,
                },
                "node_token",
            )
            restarted.handle_event(
                "sbx_alice",
                {
                    "type": "run.output",
                    "commandId": command["id"],
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": "codex",
                    "stream": "stdout",
                    "text": "second duplicate",
                    "sequence": 1,
                },
                "node_token",
            )

            outputs = [
                event["text"]
                for event in session_store.get_session(session["id"])["events"]
                if event.get("type") == "agent.output"
            ]
            assert outputs == ["first", "stderr-first", "second"]
            assert scan_count == 1

    asyncio.run(run_flow())


def test_daemon_completion_indexes_generated_pptx_artifact() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            workspace = Path(root) / "workspace"
            workspace.mkdir()
            stale = workspace / "old-deck.pptx"
            stale.write_bytes(b"old")
            stale_time = time.time() - 3600
            os.utime(stale, (stale_time, stale_time))
            existing = workspace / "existing-deck.pptx"
            existing.write_bytes(b"already here")

            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": str(workspace),
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )

            session = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "generate a deck",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [command] = registry.take_commands("sbx_alice", "node_token")
            generated = workspace / "quarterly-review.pptx"
            generated.write_bytes(b"pptx bytes")
            outside = Path(root) / "outside.pptx"
            outside.write_bytes(b"outside")
            linked = workspace / "linked-outside.pptx"
            try:
                linked.symlink_to(outside)
            except OSError as exc:
                pytest.skip(f"symlinks unavailable: {exc}")

            registry.handle_event(
                "sbx_alice",
                {
                    "type": "run.completed",
                    "commandId": command["id"],
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": "codex",
                    "mode": "action",
                    "exitCode": 0,
                    "agentLog": "created quarterly-review.pptx",
                },
                "node_token",
            )

            updated = session_store.get_session(session["id"])
            [artifact] = [
                item
                for item in updated["artifacts"]
                if item["kind"] == "workspace_file"
            ]
            assert artifact["title"] == "quarterly-review.pptx"
            assert artifact["path"] == str(generated.resolve())
            assert artifact["workspaceRelativePath"] == "quarterly-review.pptx"
            assert artifact["agentRunId"] == command["runId"]
            assert artifact["id"] in updated["agentRuns"][0]["artifactIds"]
            # A snapshot copy is kept so the artifact survives workspace changes.
            assert (
                session_store.read_artifact_content(session["id"], artifact["id"])
                == b"pptx bytes"
            )

    asyncio.run(run_flow())


def test_daemon_completion_indexes_text_files_under_output_folder() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            workspace = Path(root) / "workspace"
            workspace.mkdir()
            output = workspace / "output"
            output.mkdir()

            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": str(workspace),
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )

            session = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "generate a markdown report",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [command] = registry.take_commands("sbx_alice", "node_token")
            generated = output / "summary.md"
            generated.write_text("# Summary\n", encoding="utf-8")
            (workspace / "notes.md").write_text("normal docs edit\n", encoding="utf-8")

            registry.handle_event(
                "sbx_alice",
                {
                    "type": "run.completed",
                    "commandId": command["id"],
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": "codex",
                    "mode": "action",
                    "exitCode": 0,
                    "agentLog": "created output/summary.md",
                },
                "node_token",
            )

            updated = session_store.get_session(session["id"])
            files = [
                item
                for item in updated["artifacts"]
                if item["kind"] == "workspace_file"
            ]
            assert [artifact["workspaceRelativePath"] for artifact in files] == [
                "output/summary.md"
            ]
            assert (
                session_store.read_artifact_content(session["id"], files[0]["id"])
                == b"# Summary\n"
            )

    asyncio.run(run_flow())


def test_daemon_reported_generated_files_index_without_shared_filesystem() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    # This path does not exist on the backend host: the daemon
                    # report alone must be enough to index and serve the artifact.
                    "workspacePath": "/remote/daemon/workspace",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "capabilities": ["generated-files", "bogus-capability"],
                    "status": "ready",
                },
                "ui_token",
            )
            assert registry.get("sbx_alice")["capabilities"] == ["generated-files"]

            session = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "generate a report",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [command] = registry.take_commands("sbx_alice", "node_token")
            registry.handle_event(
                "sbx_alice",
                {
                    "type": "run.completed",
                    "commandId": command["id"],
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": "codex",
                    "mode": "action",
                    "exitCode": 0,
                    "agentLog": "created report.pdf",
                    "generatedFiles": [
                        {
                            "relativePath": "agents/agent-YWdlbnRfcmVzZWFyY2g/reports/q2.pdf",
                            "title": "q2.pdf",
                            "bytes": 9,
                            "contentType": "application/pdf",
                            "contentBase64": base64.b64encode(b"pdf bytes").decode(
                                "ascii"
                            ),
                        },
                        {
                            "relativePath": "agents/agent-YWdlbnRfcmVzZWFyY2g/output/summary.md",
                            "title": "summary.md",
                            "bytes": 10,
                            "contentType": "text/markdown",
                            "contentBase64": base64.b64encode(b"# Summary\n").decode(
                                "ascii"
                            ),
                        },
                        {
                            "relativePath": "../escape.pdf",
                            "title": "escape.pdf",
                            "bytes": 3,
                        },
                        {
                            "relativePath": "secrets/server.key",
                            "title": "cover.pdf",
                            "bytes": 3,
                        },
                        {"relativePath": "notes.md", "title": "notes.md", "bytes": 3},
                    ],
                },
                "node_token",
            )

            updated = session_store.get_session(session["id"])
            files = [
                item
                for item in updated["artifacts"]
                if item["kind"] == "workspace_file"
            ]
            assert [artifact["workspaceRelativePath"] for artifact in files] == [
                "agents/agent-YWdlbnRfcmVzZWFyY2g/reports/q2.pdf",
                "agents/agent-YWdlbnRfcmVzZWFyY2g/output/summary.md",
            ]
            assert files[0]["path"].startswith("/remote/daemon/workspace/agents/agent-YWdlbnRfcmVzZWFyY2g/")
            assert all(artifact["agentRunId"] == command["runId"] for artifact in files)
            assert files[0]["bytes"] == 9
            assert (
                session_store.read_artifact_content(session["id"], files[0]["id"])
                == b"pdf bytes"
            )
            assert (
                session_store.read_artifact_content(session["id"], files[1]["id"])
                == b"# Summary\n"
            )

    asyncio.run(run_flow())


def test_regenerated_workspace_file_gets_artifact_per_producing_run() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            workspace = Path(root) / "workspace"
            workspace.mkdir()
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": str(workspace),
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )

            report = workspace / "report.pdf"
            session = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "generate a report",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [first_command] = registry.take_commands("sbx_alice", "node_token")
            report.write_bytes(b"v1")
            registry.handle_event(
                "sbx_alice",
                {
                    "type": "run.completed",
                    "commandId": first_command["id"],
                    "sessionId": first_command["sessionId"],
                    "runId": first_command["runId"],
                    "agent": "codex",
                    "mode": "action",
                    "exitCode": 0,
                    "agentLog": "created report.pdf",
                },
                "node_token",
            )

            await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "refresh the report",
                    "sessionId": session["id"],
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [second_command] = registry.take_commands("sbx_alice", "node_token")
            report.write_bytes(b"v2 with more bytes")
            registry.handle_event(
                "sbx_alice",
                {
                    "type": "run.completed",
                    "commandId": second_command["id"],
                    "sessionId": second_command["sessionId"],
                    "runId": second_command["runId"],
                    "agent": "codex",
                    "mode": "action",
                    "exitCode": 0,
                    "agentLog": "refreshed report.pdf",
                },
                "node_token",
            )

            updated = session_store.get_session(session["id"])
            workspace_files = [
                item
                for item in updated["artifacts"]
                if item["kind"] == "workspace_file"
            ]
            assert len(workspace_files) == 2
            assert {item["agentRunId"] for item in workspace_files} == {
                first_command["runId"],
                second_command["runId"],
            }
            latest = max(workspace_files, key=lambda item: item["createdAt"])
            assert (
                session_store.read_artifact_content(session["id"], latest["id"])
                == b"v2 with more bytes"
            )

    asyncio.run(run_flow())


def test_daemon_capacity_allows_concurrent_ask_runs_only() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "maxConcurrentRuns": 2,
                    "runCapacityByMode": {"ask": 2, "review": 1, "action": 1},
                    "status": "ready",
                },
                "ui_token",
            )

            first = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "explain auth",
                    "assignments": [{"agent": "codex", "mode": "ask"}],
                },
            )
            second = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "explain billing",
                    "assignments": [{"agent": "codex", "mode": "ask"}],
                },
            )
            assert first["id"] != second["id"]
            commands = registry.take_commands("sbx_alice", "node_token")
            assert [command["mode"] for command in commands] == ["ask", "ask"]
            assert len(registry.monitor_nodes()[0]["activeRuns"]) == 2

            with pytest.raises(ValueError, match="no available execution slot"):
                await backend.run(
                    "sbx_alice",
                    {
                        "taskGoal": "edit files",
                        "assignments": [{"agent": "codex", "mode": "action"}],
                    },
                )

    asyncio.run(run_flow())


def test_legacy_daemon_capacity_remains_single_slot() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )

            await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "explain auth",
                    "assignments": [{"agent": "codex", "mode": "ask"}],
                },
            )
            with pytest.raises(ValueError, match="no available execution slot"):
                await backend.run(
                    "sbx_alice",
                    {
                        "taskGoal": "explain billing",
                        "assignments": [{"agent": "codex", "mode": "ask"}],
                    },
                )

    asyncio.run(run_flow())


def test_daemon_rejects_event_agent_metadata_mismatch() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex", "claude"],
                    "status": "ready",
                },
                "ui_token",
            )

            session = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "review auth",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [command] = registry.take_commands("sbx_alice", "node_token")

            with pytest.raises(PermissionError, match="metadata"):
                registry.handle_event(
                    "sbx_alice",
                    {
                        "type": "run.completed",
                        "commandId": command["id"],
                        "sessionId": command["sessionId"],
                        "runId": command["runId"],
                        "agent": "claude",
                        "mode": "action",
                        "exitCode": 0,
                        "agentLog": "wrong agent",
                    },
                    "node_token",
                )

            assert session_store.get_session(session["id"])["artifacts"] == []

    asyncio.run(run_flow())


def test_daemon_rejects_event_lease_mismatch() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )

            session = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "review auth",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [command] = registry.take_commands("sbx_alice", "node_token")
            assert command["leaseId"].startswith("lease_")

            with pytest.raises(PermissionError, match="lease"):
                registry.handle_event(
                    "sbx_alice",
                    {
                        "type": "run.completed",
                        "commandId": command["id"],
                        "leaseId": "lease_stale",
                        "sessionId": command["sessionId"],
                        "runId": command["runId"],
                        "agent": "codex",
                        "mode": "action",
                        "exitCode": 0,
                        "agentLog": "stale completion",
                    },
                    "node_token",
                )

            registry.handle_event(
                "sbx_alice",
                {
                    "type": "run.completed",
                    "commandId": command["id"],
                    "leaseId": command["leaseId"],
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": "codex",
                    "mode": "action",
                    "exitCode": 0,
                    "agentLog": "current completion",
                },
                "node_token",
            )

            assert session_store.get_session(session["id"])["status"] == "completed"

    asyncio.run(run_flow())


def test_daemon_poll_renews_known_active_command_before_reclaim() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )

            session = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "review auth",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [command] = registry.take_commands(
                "sbx_alice", "node_token", lease_seconds=0.05
            )

            time.sleep(0.08)

            assert (
                registry.take_commands("sbx_alice", "node_token", lease_seconds=0.05)
                == []
            )
            registry.handle_event(
                "sbx_alice",
                {
                    "type": "run.output",
                    "commandId": command["id"],
                    "leaseId": command["leaseId"],
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": "codex",
                    "stream": "stdout",
                    "text": "final response",
                    "sequence": 0,
                },
                "node_token",
            )
            registry.handle_event(
                "sbx_alice",
                {
                    "type": "run.completed",
                    "commandId": command["id"],
                    "leaseId": command["leaseId"],
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": "codex",
                    "mode": "action",
                    "exitCode": 0,
                    "agentLog": "final response",
                },
                "node_token",
            )

            completed = session_store.get_session(session["id"])
            assert completed["status"] == "completed"
            assert completed["agentRuns"][0]["agentLog"] == "final response"

    asyncio.run(run_flow())


def test_daemon_heartbeat_renews_command_dispatched_by_another_backend_replica() -> (
    None
):
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            database_url = f"sqlite:///{root}/daemon.db"
            session_store = LocalSessionStore(root)
            first_store = DatabaseDaemonStore(database_url, create_schema=True)
            first = DaemonNodeRegistry(session_store, first_store)
            first.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )
            second = DaemonNodeRegistry(
                session_store,
                DatabaseDaemonStore(database_url),
            )

            backend = ServerDaemonNodeBackend(first)
            await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "survive backend load balancing",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [command] = first.take_commands(
                "sbx_alice",
                "node_token",
                lease_seconds=0.05,
                renew_known_active=False,
            )

            second.renew_active_command_leases(
                "sbx_alice",
                "node_token",
                [(command["id"], command["leaseId"])],
                lease_seconds=10,
            )
            time.sleep(0.08)

            assert (
                second.take_commands(
                    "sbx_alice",
                    "node_token",
                    lease_seconds=0.05,
                    renew_known_active=False,
                )
                == []
            )

    asyncio.run(run_flow())


def test_daemon_cancel_finds_run_dispatched_by_another_backend_replica() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            database_url = f"sqlite:///{root}/daemon.db"
            session_store = LocalSessionStore(root)
            first = DaemonNodeRegistry(
                session_store,
                DatabaseDaemonStore(database_url, create_schema=True),
            )
            first.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )
            second = DaemonNodeRegistry(
                session_store,
                DatabaseDaemonStore(database_url),
            )
            second.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )

            session = await ServerDaemonNodeBackend(first).run(
                "sbx_alice",
                {
                    "taskGoal": "cancel across backend replicas",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [start] = first.take_commands(
                "sbx_alice",
                "node_token",
                lease_seconds=10,
                renew_known_active=False,
            )

            cancelled = ServerDaemonNodeBackend(second).cancel_run(
                "sbx_alice",
                session["id"],
                "stop requested",
            )

            assert cancelled["id"] == session["id"]
            [cancel] = second.take_commands(
                "sbx_alice",
                "node_token",
                lease_seconds=10,
                renew_known_active=False,
            )
            assert cancel["type"] == "run.cancel"
            assert cancel["commandId"] == start["id"]

    asyncio.run(run_flow())


def test_daemon_events_are_accepted_by_a_replica_that_did_not_dispatch_the_command() -> (
    None
):
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            database_url = f"sqlite:///{root}/daemon.db"
            session_store = LocalSessionStore(root)
            first = DaemonNodeRegistry(
                session_store,
                DatabaseDaemonStore(database_url, create_schema=True),
            )
            first.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )
            second = DaemonNodeRegistry(
                session_store,
                DatabaseDaemonStore(database_url),
            )

            session = await ServerDaemonNodeBackend(first).run(
                "sbx_alice",
                {
                    "taskGoal": "survive event load balancing",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [command] = first.take_commands(
                "sbx_alice",
                "node_token",
                lease_seconds=0.05,
                renew_known_active=False,
            )

            second.handle_event(
                "sbx_alice",
                {
                    "type": "run.output",
                    "commandId": command["id"],
                    "leaseId": command["leaseId"],
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": "codex",
                    "stream": "stdout",
                    "text": "cross-replica output",
                    "sequence": 0,
                },
                "node_token",
            )
            time.sleep(0.08)
            [redelivered] = first.take_commands(
                "sbx_alice",
                "node_token",
                lease_seconds=10,
                renew_known_active=False,
            )
            with pytest.raises(PermissionError, match="lease does not match"):
                second.handle_event(
                    "sbx_alice",
                    {
                        "type": "run.output",
                        "commandId": command["id"],
                        "leaseId": command["leaseId"],
                        "sessionId": command["sessionId"],
                        "runId": command["runId"],
                        "agent": "codex",
                        "stream": "stdout",
                        "text": "stale output",
                        "sequence": 1,
                    },
                    "node_token",
                )
            second.handle_event(
                "sbx_alice",
                {
                    "type": "run.output",
                    "commandId": redelivered["id"],
                    "leaseId": redelivered["leaseId"],
                    "sessionId": redelivered["sessionId"],
                    "runId": redelivered["runId"],
                    "agent": "codex",
                    "stream": "stdout",
                    "text": "current output",
                    "sequence": 1,
                },
                "node_token",
            )
            second.handle_event(
                "sbx_alice",
                {
                    "type": "run.completed",
                    "commandId": redelivered["id"],
                    "leaseId": redelivered["leaseId"],
                    "sessionId": redelivered["sessionId"],
                    "runId": redelivered["runId"],
                    "agent": "codex",
                    "mode": "action",
                    "exitCode": 0,
                },
                "node_token",
            )

            stored = session_store.get_session(session["id"])
            assert [
                event["text"]
                for event in stored["events"]
                if event.get("type") == "agent.output"
            ] == ["cross-replica output", "current output"]
            assert stored["status"] == "completed"

    asyncio.run(run_flow())


def test_daemon_failed_event_preserves_agent_log_without_artifact() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )

            raw_log = "  useful output\n\n"
            session = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "implement auth",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [command] = registry.take_commands("sbx_alice", "node_token")
            registry.handle_event(
                "sbx_alice",
                {
                    "type": "run.failed",
                    "commandId": command["id"],
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": "codex",
                    "mode": "action",
                    "error": "stream post failed",
                    "agentLog": raw_log,
                    "exitCode": 1,
                },
                "node_token",
            )

            updated = session_store.get_session(session["id"])
            assert updated["status"] == "failed"
            assert updated["agentRuns"][0]["artifactIds"] == []
            assert updated["agentRuns"][0]["agentLog"] == raw_log
            assert updated["artifacts"] == []

    asyncio.run(run_flow())


def test_daemon_follow_up_run_gets_prior_conversation_state() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["claude", "codex"],
                    "status": "ready",
                },
                "ui_token",
            )

            session = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "first question",
                    "assignments": [{"agent": "claude", "mode": "action"}],
                },
            )
            [first_command] = registry.take_commands("sbx_alice", "node_token")
            assert "prior_conversation" not in first_command["state"]
            registry.handle_event(
                "sbx_alice",
                {
                    "type": "run.completed",
                    "commandId": first_command["id"],
                    "sessionId": first_command["sessionId"],
                    "runId": first_command["runId"],
                    "agent": "claude",
                    "mode": "action",
                    "exitCode": 0,
                    "agentLog": "● first answer",
                },
                "node_token",
            )

            await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "follow up",
                    "sessionId": session["id"],
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [follow_up_command] = registry.take_commands("sbx_alice", "node_token")

            state = follow_up_command["state"]
            assert state["prior_conversation"] == (
                "[Conversation so far]\n\n"
                "[User]\nfirst question\n\n"
                "[Assistant @claude]\nfirst answer"
            )
            assert "prior_agent_bridge" not in state

    asyncio.run(run_flow())


def test_daemon_multi_agent_same_turn_shares_full_handoff_context() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["claude", "codex"],
                    "status": "ready",
                },
                "ui_token",
            )

            await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "ship it",
                    "assignments": [
                        {"agent": "claude", "mode": "action"},
                        {"agent": "codex", "mode": "action"},
                        {"agent": "claude", "mode": "action"},
                    ],
                },
            )
            [first_command] = registry.take_commands("sbx_alice", "node_token")
            registry.handle_event(
                "sbx_alice",
                {
                    "type": "run.completed",
                    "commandId": first_command["id"],
                    "sessionId": first_command["sessionId"],
                    "runId": first_command["runId"],
                    "agent": "claude",
                    "mode": "action",
                    "exitCode": 0,
                    "agentLog": "● implementation note",
                },
                "node_token",
            )
            [second_command] = registry.take_commands("sbx_alice", "node_token")

            state = second_command["state"]
            assert "prior_conversation" not in state
            assert (
                state["prior_agent_bridge"]
                == "[Previous from @claude]\nimplementation note"
            )
            registry.handle_event(
                "sbx_alice",
                {
                    "type": "run.completed",
                    "commandId": second_command["id"],
                    "sessionId": second_command["sessionId"],
                    "runId": second_command["runId"],
                    "agent": "codex",
                    "mode": "action",
                    "exitCode": 0,
                    "agentLog": "● review note",
                },
                "node_token",
            )
            [third_command] = registry.take_commands("sbx_alice", "node_token")

            state = third_command["state"]
            assert "prior_conversation" not in state
            assert state["prior_agent_bridge"] == (
                "[Previous from @claude]\nimplementation note\n\n"
                "[Previous from @codex]\nreview note"
            )

    asyncio.run(run_flow())


def test_daemon_run_records_decision_metadata_after_validation() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )
            session = session_store.create_session(
                {
                    "workspacePath": "/workspace/alice",
                    "ownerEmployeeId": "alice",
                    "taskGoal": "fix auth",
                    "participants": ["human", "codex"],
                }
            )

            updated = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "fix auth",
                    "sessionId": session["id"],
                    "assignments": [{"agent": "codex", "mode": "action"}],
                    "decision": {"kind": "rerun", "targetAgent": "codex"},
                },
            )

            assert updated["id"] == session["id"]
            assert updated["decisions"][0]["kind"] == "rerun"
            assert updated["decisions"][0]["targetAgent"] == "codex"
            [command] = registry.take_commands("sbx_alice", "node_token")
            assert command["sessionId"] == session["id"]

    asyncio.run(run_flow())


def test_daemon_handoff_decision_injects_note_without_duplicate_user_turn() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )
            session = session_store.create_session(
                {
                    "workspacePath": "/workspace/alice",
                    "ownerEmployeeId": "alice",
                    "taskGoal": "fix auth",
                    "participants": ["human", "claude"],
                }
            )

            await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "fix auth\n\nHandoff note:\nverify the fix",
                    "sessionId": session["id"],
                    "assignments": [{"agent": "codex", "mode": "action"}],
                    "decision": {
                        "kind": "handoff",
                        "targetAgent": "codex",
                        "note": "verify the fix",
                    },
                },
            )

            [command] = registry.take_commands("sbx_alice", "node_token")
            assert command["taskGoal"] == "fix auth"
            assert command["state"]["task_goal"] == "fix auth"
            assert (
                command["state"]["prior_handoff_note"]
                == "[Handoff note]\nverify the fix"
            )
            updated = session_store.get_session(session["id"])
            assert [event["type"] for event in updated["events"]].count(
                "user.message"
            ) == 0

    asyncio.run(run_flow())


def test_daemon_prerecorded_handoff_decision_skips_duplicate_user_turn() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )
            session = session_store.create_session(
                {
                    "workspacePath": "/workspace/alice",
                    "ownerEmployeeId": "alice",
                    "taskGoal": "fix auth",
                    "participants": ["human", "claude"],
                }
            )
            SessionController(session_store, owner_employee_id="alice").handoff_session(
                session["id"],
                "codex",
                [{"agent": "codex", "mode": "action"}],
                "verify the fix",
            )

            await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "fix auth",
                    "sessionId": session["id"],
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )

            [command] = registry.take_commands("sbx_alice", "node_token")
            assert (
                command["state"]["prior_handoff_note"]
                == "[Handoff note]\nverify the fix"
            )
            updated = session_store.get_session(session["id"])
            assert [event["type"] for event in updated["events"]].count(
                "user.message"
            ) == 0

    asyncio.run(run_flow())


def test_daemon_run_does_not_record_decision_when_validation_fails() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )
            session = session_store.create_session(
                {
                    "workspacePath": "/workspace/alice",
                    "ownerEmployeeId": "alice",
                    "taskGoal": "fix auth",
                    "participants": ["human", "kimi"],
                }
            )

            with pytest.raises(ValueError, match="does not have ready agent"):
                await backend.run(
                    "sbx_alice",
                    {
                        "taskGoal": "fix auth",
                        "sessionId": session["id"],
                        "assignments": [{"agent": "kimi", "mode": "action"}],
                        "decision": {"kind": "handoff", "targetAgent": "kimi"},
                    },
                )

            assert session_store.get_session(session["id"])["decisions"] == []

    asyncio.run(run_flow())


def test_daemon_terminal_event_after_registry_restart_finalizes_session() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )

            session = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "implement auth",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [command] = registry.take_commands("sbx_alice", "node_token")

            restarted = DaemonNodeRegistry(session_store, LocalDaemonStore(root))
            restarted.handle_event(
                "sbx_alice",
                {
                    "type": "run.completed",
                    "commandId": command["id"],
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": "codex",
                    "mode": "action",
                    "exitCode": 0,
                    "agentLog": "done",
                },
                "node_token",
            )

            assert session_store.get_session(session["id"])["status"] == "completed"

    asyncio.run(run_flow())


def test_daemon_output_retry_after_registry_restart_is_deduplicated() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )

            session = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "implement auth",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [command] = registry.take_commands("sbx_alice", "node_token")
            output = {
                "type": "run.output",
                "commandId": command["id"],
                "sessionId": command["sessionId"],
                "runId": command["runId"],
                "agent": "codex",
                "stream": "stdout",
                "text": "progress\n",
                "sequence": 0,
            }
            registry.handle_event("sbx_alice", output, "node_token")

            restarted = DaemonNodeRegistry(session_store, LocalDaemonStore(root))
            restarted.handle_event("sbx_alice", output, "node_token")

            events = [
                event
                for event in session_store.get_session(session["id"])["events"]
                if event["type"] == "agent.output"
            ]
            assert len(events) == 1
            assert events[0]["sequence"] == 0
            assert events[0]["text"] == "progress\n"

    asyncio.run(run_flow())


def test_daemon_cancel_event_clears_active_run_request() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["claude"],
                    "status": "ready",
                },
                "ui_token",
            )

            session = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "stop this",
                    "assignments": [{"agent": "claude", "mode": "action"}],
                },
            )
            [command] = registry.take_commands("sbx_alice", "node_token")
            registry.cancel_active_run("sbx_alice", session["id"], "no longer needed")
            [cancel] = registry.take_commands("sbx_alice", "node_token")
            assert cancel["type"] == "run.cancel"
            registry.handle_event(
                "sbx_alice",
                {
                    "type": "run.cancelled",
                    "commandId": command["id"],
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": "claude",
                    "mode": "action",
                    "reason": "no longer needed",
                },
                "node_token",
            )

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
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )

            session = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "hang",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [command] = registry.take_commands("sbx_alice", "node_token")
            [request] = daemon_store.list_active_run_requests("sbx_alice")
            daemon_store.update_run_request(
                request["id"], {"currentStartedAt": "2020-01-01T00:00:00.000Z"}
            )

            monkeypatch.setattr(
                "relay.daemon_registry.registry.DAEMON_RUN_TIMEOUT_MS", 1
            )
            registry.reap_stale_runs()

            failed = session_store.get_session(session["id"])
            assert failed["status"] == "failed"
            assert "timed out" in failed["finalOutcome"]
            assert daemon_store.list_active_run_requests("sbx_alice") == []
            assert command["id"] not in registry.active_commands

    monkeypatch.setattr("relay.daemon_registry.registry.DAEMON_RUN_TIMEOUT_MS", 60_000)
    asyncio.run(run_flow())


def test_daemon_registration_rejects_wrong_node_token() -> None:
    with TemporaryDirectory() as root:
        session_store = LocalSessionStore(root)
        daemon_store = LocalDaemonStore(root)
        registry = DaemonNodeRegistry(session_store, daemon_store)
        registry.register(
            {
                "sandboxId": "sbx_alice",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            },
            "ui_token",
        )

        with pytest.raises(PermissionError, match="token does not match"):
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "wrong_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )


def test_local_daemon_store_redacts_plaintext_node_token() -> None:
    with TemporaryDirectory() as root:
        store = LocalDaemonStore(root)
        store.register_node(
            {
                **store_node_payload(),
                "status": "provisioning",
                "agents": {"codex": "unknown"},
                "lastError": "Waiting for daemon node registration.",
            }
        )

        [node] = store.list_nodes()
        assert node["id"] == "sbx_alice"
        assert node["nodeTokenHash"] == "sha256:hash"
        assert "nodeToken" not in node
        assert node["token"] is None

        persisted = json.loads(
            (Path(root) / "daemon" / "nodes" / "sbx_alice.json").read_text(
                encoding="utf-8"
            )
        )
        assert "nodeToken" not in persisted
        assert persisted["token"] is None


def test_database_daemon_store_redacts_plaintext_node_token() -> None:
    with TemporaryDirectory() as root:
        store = DatabaseDaemonStore(f"sqlite:///{root}/daemon.db", create_schema=True)
        store.register_node(
            {
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
            }
        )

        [node] = store.list_nodes()
        assert node["id"] == "sbx_alice"
        assert node["nodeTokenHash"] == "sha256:hash"
        assert "nodeToken" not in node
        assert node["token"] is None


@pytest.mark.parametrize("store_factory", DAEMON_STORE_FACTORIES)
def test_registry_restart_does_not_recover_plaintext_node_token(store_factory) -> None:
    with TemporaryDirectory() as root:
        session_store = LocalSessionStore(root)
        registry = DaemonNodeRegistry(session_store, store_factory(root))
        _sandbox, _ui_token, node_token = registry.provision_pending(
            "alice", "/workspace/alice"
        )

        assert registry.control_panel_nodes()[0]["nodeToken"] == node_token

        restarted = DaemonNodeRegistry(LocalSessionStore(root), store_factory(root))
        assert "nodeToken" not in restarted.control_panel_nodes()[0]


@pytest.mark.parametrize(
    "store_factory",
    [
        LocalDaemonStore,
        lambda root: DatabaseDaemonStore(
            f"sqlite:///{root}/daemon.db", create_schema=True
        ),
    ],
)
def test_daemon_store_persists_sandbox_mode(store_factory) -> None:
    with TemporaryDirectory() as root:
        store = store_factory(root)
        store.register_node(
            {
                "id": "sbx_alice",
                "employeeId": "alice",
                "workspacePath": "/workspace/alice",
                "sandboxMode": "boxlite",
                "status": "ready",
                "agents": {"codex": "ready"},
                "token": None,
                "nodeTokenHash": "sha256:hash",
                "createdAt": "2026-06-13T00:00:00.000Z",
                "updatedAt": "2026-06-13T00:00:00.000Z",
            }
        )

        [node] = store.list_nodes()
        assert node["sandboxMode"] == "boxlite"


@pytest.mark.parametrize("store_factory", DAEMON_STORE_FACTORIES)
def test_daemon_store_persists_canonical_workspace_id(store_factory) -> None:
    with TemporaryDirectory() as root:
        store = store_factory(root)
        store.register_node(store_node_payload())

        [node] = store.list_nodes()
        assert node["workspaceId"] == "repo:relay"


def test_multi_node_workflow_accepts_shared_workspace_id_with_different_paths() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            registry = DaemonNodeRegistry(
                LocalSessionStore(root), LocalDaemonStore(root)
            )
            backend = ServerDaemonNodeBackend(registry)
            for node_id, executor, workspace_path in (
                ("node_a", "claude", "/mnt/a/relay"),
                ("node_b", "codex", "D:/work/relay"),
            ):
                registry.register(
                    {
                        "sandboxId": node_id,
                        "employeeId": "alice",
                        "token": f"token_{node_id}",
                        "workspacePath": workspace_path,
                        "workspaceId": "repo:relay",
                        "protocolVersion": 1,
                        "supportedAgents": [executor],
                        "status": "ready",
                    },
                    f"ui_{node_id}",
                )

            session = await backend.run(
                "node_a",
                {
                    "taskGoal": "research then implement",
                    "agentFirst": True,
                    "actorEmployeeId": "alice",
                    "assignments": [
                        {"agent": "claude", "mode": "ask", "daemonNodeId": "node_a"},
                        {"agent": "codex", "mode": "action", "daemonNodeId": "node_b"},
                    ],
                },
            )

            [first] = registry.take_commands("node_a", "token_node_a")
            registry.handle_event(
                "node_a",
                {
                    "type": "run.completed",
                    "commandId": first["id"],
                    "sessionId": session["id"],
                    "runId": first["runId"],
                    "agent": "claude",
                    "mode": "ask",
                    "exitCode": 0,
                    "agentLog": "findings",
                },
                "token_node_a",
            )
            [second] = registry.take_commands("node_b", "token_node_b")
            assert second["workspacePath"] == "D:/work/relay"

    asyncio.run(run_flow())


def test_multi_node_workflow_revalidates_placement_before_next_enqueue() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            registry = DaemonNodeRegistry(session_store, LocalDaemonStore(root))
            agents = LocalAgentStore(root)
            placements = LocalAgentPlacementStore(root)
            backend = ServerDaemonNodeBackend(
                registry,
                agent_store=agents,
                agent_placement_store=placements,
            )
            researcher = agents.create_agent(
                "alice", {"displayName": "Researcher", "executorKind": "claude"}
            )
            builder = agents.create_agent(
                "alice", {"displayName": "Builder", "executorKind": "codex"}
            )
            first_placement = placements.create_placement(
                researcher,
                "node_a",
                {"workspacePolicy": {"kind": "shared-path"}},
            )
            second_placement = placements.create_placement(
                builder,
                "node_b",
                {"workspacePolicy": {"kind": "shared-path"}},
            )
            for node_id, executor in (("node_a", "claude"), ("node_b", "codex")):
                registry.register(
                    {
                        "sandboxId": node_id,
                        "employeeId": "alice",
                        "token": f"token_{node_id}",
                        "workspacePath": f"/work/{node_id}",
                        "workspaceId": "repo:relay",
                        "protocolVersion": 1,
                        "supportedAgents": [executor],
                        "status": "ready",
                    },
                    f"ui_{node_id}",
                )

            session = await backend.run(
                "node_a",
                {
                    "taskGoal": "research then implement",
                    "agentFirst": True,
                    "actorEmployeeId": "alice",
                    "assignments": [
                        {
                            "agentId": researcher["id"],
                            "agent": "claude",
                            "agentVersion": researcher["version"],
                            "placementId": first_placement["id"],
                            "daemonNodeId": "node_a",
                            "workspacePolicy": {"kind": "shared-path"},
                            "mode": "ask",
                        },
                        {
                            "agentId": builder["id"],
                            "agent": "codex",
                            "agentVersion": builder["version"],
                            "placementId": second_placement["id"],
                            "daemonNodeId": "node_b",
                            "workspacePolicy": {"kind": "shared-path"},
                            "mode": "action",
                        },
                    ],
                },
            )
            [first] = registry.take_commands("node_a", "token_node_a")
            placements.update_placement(
                second_placement["id"], {"desiredState": "removed"}
            )
            registry.handle_event(
                "node_a",
                {
                    "type": "run.completed",
                    "commandId": first["id"],
                    "sessionId": session["id"],
                    "runId": first["runId"],
                    "agent": "claude",
                    "mode": "ask",
                    "exitCode": 0,
                    "agentLog": "findings",
                },
                "token_node_a",
            )

            assert registry.take_commands("node_b", "token_node_b") == []
            assert session_store.get_session(session["id"])["status"] == "failed"

    asyncio.run(run_flow())


def test_database_daemon_store_claims_queued_commands_once() -> None:
    with TemporaryDirectory() as root:
        store = DatabaseDaemonStore(f"sqlite:///{root}/daemon.db", create_schema=True)
        store.register_node(
            {
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
            }
        )
        store.enqueue_command(
            "sbx_alice",
            {
                "id": "cmd_once",
                "type": "run.start",
                "sessionId": "ses_1",
                "runId": "run_1",
                "agent": "codex",
                "mode": "action",
                "taskGoal": "fix auth",
            },
        )

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(
                pool.map(lambda _: store.take_queued_commands("sbx_alice"), range(2))
            )

        claimed = [command for commands in results for command in commands]
        assert [command["id"] for command in claimed] == ["cmd_once"]
        assert store.queued_command_count("sbx_alice") == 0


def test_database_daemon_store_preserves_artifact_snapshot_state() -> None:
    with TemporaryDirectory() as root:
        store = DatabaseDaemonStore(f"sqlite:///{root}/daemon.db", create_schema=True)
        store.register_node(
            {
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
            }
        )
        request = store.create_run_request(
            {
                "nodeId": "sbx_alice",
                "sessionId": "ses_1",
                "taskGoal": "generate deck",
                "assignments": [{"agent": "codex", "mode": "action"}],
                "state": {"task_goal": "generate deck"},
            }
        )

        updated = store.update_run_request(
            request["id"],
            {
                "currentCommandId": "cmd_1",
                "currentRunId": "run_1",
                "currentAgent": "codex",
                "currentMode": "action",
                "currentStartedAt": "2026-06-30T00:00:00.000Z",
                "state": {
                    "task_goal": "generate deck",
                    "_relay_artifact_snapshot": {
                        "/workspace/alice/existing.pptx": {"mtime": 1.0, "bytes": 10},
                    },
                },
            },
        )

        assert (
            updated["state"]["_relay_artifact_snapshot"][
                "/workspace/alice/existing.pptx"
            ]["bytes"]
            == 10
        )
        assert store.run_request_for_command("cmd_1")["state"][
            "_relay_artifact_snapshot"
        ]


@pytest.mark.parametrize("store_factory", DAEMON_STORE_FACTORIES)
def test_daemon_store_prunes_terminal_records_but_keeps_active_records(
    store_factory,
) -> None:
    with TemporaryDirectory() as root:
        store = store_factory(root)
        store.register_node(store_node_payload())
        for index in range(3):
            command = run_start_command(f"cmd_done_{index}", f"run_done_{index}")
            store.enqueue_command("sbx_alice", command)
            store.mark_command_completed(
                "sbx_alice",
                {
                    "type": "run.completed",
                    "commandId": command["id"],
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": "codex",
                    "mode": "action",
                    "exitCode": 0,
                },
            )
        active = run_start_command("cmd_active", "run_active")
        store.enqueue_command("sbx_alice", active)

        pruned_by_cap = store.prune_terminal_records(
            retention_seconds=365 * 24 * 60 * 60, per_node_limit=1
        )
        assert pruned_by_cap == {"commands": 2, "runs": 2}
        assert store.queued_command_count("sbx_alice") == 1
        assert [run["runId"] for run in store.list_active_runs("sbx_alice")] == [
            "run_active"
        ]

        pruned_by_age = store.prune_terminal_records(
            retention_seconds=0, per_node_limit=100
        )
        assert pruned_by_age == {"commands": 1, "runs": 1}
        [command] = store.take_queued_commands("sbx_alice")
        assert command["id"] == "cmd_active"


def test_monitor_nodes_uses_grouped_store_queries() -> None:
    class CountingLocalDaemonStore(LocalDaemonStore):
        def __init__(self, root: str):
            super().__init__(root)
            self.active_run_calls: list[str | None] = []
            self.queued_count_calls = 0
            self.queued_counts_calls = 0

        def list_active_runs(
            self, node_id: str | None = None
        ) -> list[dict[str, object]]:
            self.active_run_calls.append(node_id)
            return super().list_active_runs(node_id)

        def queued_command_count(self, node_id: str) -> int:
            self.queued_count_calls += 1
            return super().queued_command_count(node_id)

        def queued_command_counts(self) -> dict[str, int]:
            self.queued_counts_calls += 1
            return super().queued_command_counts()

    with TemporaryDirectory() as root:
        session_store = LocalSessionStore(root)
        daemon_store = CountingLocalDaemonStore(root)
        registry = DaemonNodeRegistry(session_store, daemon_store)
        registry.register(
            {
                "sandboxId": "sbx_alice",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            },
            "ui_token",
        )
        registry.register(
            {
                "sandboxId": "sbx_bob",
                "employeeId": "bob",
                "token": "node_token_bob",
                "workspacePath": "/workspace/bob",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            },
            "ui_token_bob",
        )
        daemon_store.active_run_calls = []
        daemon_store.queued_count_calls = 0
        daemon_store.queued_counts_calls = 0

        assert len(registry.monitor_nodes()) == 2

        assert daemon_store.active_run_calls == [None]
        assert daemon_store.queued_count_calls == 0
        assert daemon_store.queued_counts_calls == 1


@pytest.mark.parametrize(
    "store_factory",
    [
        LocalDaemonStore,
        lambda root: DatabaseDaemonStore(
            f"sqlite:///{root}/daemon.db", create_schema=True
        ),
    ],
)
def test_daemon_store_reclaims_expired_command_leases(store_factory) -> None:
    with TemporaryDirectory() as root:
        store = store_factory(root)
        store.register_node(
            {
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
            }
        )
        store.enqueue_command(
            "sbx_alice",
            {
                "id": "cmd_retry",
                "type": "run.start",
                "sessionId": "ses_1",
                "runId": "run_1",
                "agent": "codex",
                "mode": "action",
                "taskGoal": "fix auth",
            },
        )

        [first] = store.take_queued_commands("sbx_alice", lease_seconds=0.05)
        assert first["id"] == "cmd_retry"
        assert first["status"] == "dispatched"
        assert first["attempt"] == 1
        assert first["leaseId"].startswith("lease_")
        assert first["leaseExpiresAt"]
        assert store.take_queued_commands("sbx_alice") == []

        time.sleep(0.08)

        [second] = store.take_queued_commands("sbx_alice", lease_seconds=0.05)
        assert second["id"] == "cmd_retry"
        assert second["attempt"] == 2
        assert second["leaseId"] != first["leaseId"]


@pytest.mark.parametrize(
    "store_factory",
    [
        LocalDaemonStore,
        lambda root: DatabaseDaemonStore(
            f"sqlite:///{root}/daemon.db", create_schema=True
        ),
    ],
)
def test_daemon_store_retries_cancel_until_target_run_is_terminal(
    store_factory,
) -> None:
    with TemporaryDirectory() as root:
        store = store_factory(root)
        store.register_node(
            {
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
            }
        )
        store.enqueue_command(
            "sbx_alice",
            {
                "id": "cmd_cancel",
                "type": "run.cancel",
                "commandId": "cmd_run",
                "sessionId": "ses_1",
                "runId": "run_1",
                "agent": "codex",
                "mode": "action",
                "reason": "no longer needed",
            },
        )

        [first] = store.take_queued_commands("sbx_alice", lease_seconds=0.05)
        assert first["command"]["type"] == "run.cancel"
        assert first["attempt"] == 1

        time.sleep(0.08)

        [second] = store.take_queued_commands("sbx_alice", lease_seconds=0.05)
        assert second["id"] == first["id"]
        assert second["attempt"] == 2
        store.mark_cancel_commands_completed("sbx_alice", "cmd_run")
        assert store.take_queued_commands("sbx_alice") == []


@pytest.mark.parametrize(
    "store_factory",
    [
        LocalDaemonStore,
        lambda root: DatabaseDaemonStore(
            f"sqlite:///{root}/daemon.db", create_schema=True
        ),
    ],
)
def test_daemon_store_renews_active_command_leases(store_factory) -> None:
    with TemporaryDirectory() as root:
        store = store_factory(root)
        store.register_node(
            {
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
            }
        )
        store.enqueue_command(
            "sbx_alice",
            {
                "id": "cmd_long",
                "type": "run.start",
                "sessionId": "ses_1",
                "runId": "run_1",
                "agent": "codex",
                "mode": "action",
                "taskGoal": "fix auth",
            },
        )

        [first] = store.take_queued_commands("sbx_alice", lease_seconds=0.05)
        time.sleep(0.08)
        store.renew_command_leases(
            "sbx_alice", [(first["id"], first["leaseId"])], lease_seconds=10
        )

        assert store.take_queued_commands("sbx_alice") == []


@pytest.mark.parametrize(
    "store_factory",
    [
        LocalDaemonStore,
        lambda root: DatabaseDaemonStore(
            f"sqlite:///{root}/daemon.db", create_schema=True
        ),
    ],
)
def test_daemon_store_does_not_renew_a_superseded_delivery(store_factory) -> None:
    with TemporaryDirectory() as root:
        store = store_factory(root)
        store.register_node(
            {
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
            }
        )
        store.enqueue_command(
            "sbx_alice",
            {
                "id": "cmd_long",
                "type": "run.start",
                "sessionId": "ses_1",
                "runId": "run_1",
                "agent": "codex",
                "mode": "action",
                "taskGoal": "fix auth",
            },
        )

        [first] = store.take_queued_commands("sbx_alice", lease_seconds=0.05)
        time.sleep(0.08)
        [second] = store.take_queued_commands("sbx_alice", lease_seconds=0.05)
        store.renew_command_leases(
            "sbx_alice", [(first["id"], first["leaseId"])], lease_seconds=10
        )
        time.sleep(0.08)

        [third] = store.take_queued_commands("sbx_alice", lease_seconds=0.05)
        assert third["attempt"] == 3
        assert third["leaseId"] != second["leaseId"]


@pytest.mark.parametrize(
    "store_factory",
    [
        LocalDaemonStore,
        lambda root: DatabaseDaemonStore(
            f"sqlite:///{root}/daemon.db", create_schema=True
        ),
    ],
)
def test_daemon_store_persists_agent_role_maps(store_factory) -> None:
    with TemporaryDirectory() as root:
        store = store_factory(root)
        store.register_node(
            {
                "id": "sbx_alice",
                "employeeId": "alice",
                "workspacePath": "/workspace/alice",
                "status": "ready",
                "agents": {"codex": "ready"},
                "token": None,
                "createdAt": "2026-06-13T00:00:00.000Z",
                "updatedAt": "2026-06-13T00:00:00.000Z",
            }
        )

        store.update_node_agent_role_defaults("sbx_alice", {"codex": "planner"})
        store.update_node_agent_role_overrides("sbx_alice", {"codex": "fixer"})

        assert store.get_node("sbx_alice")["agentRoleDefaults"] == {"codex": "planner"}
        assert store.get_node("sbx_alice")["agentRoleOverrides"] == {"codex": "fixer"}


def test_daemon_run_rejects_ownerless_sessions() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            session = session_store.create_session(
                {
                    "workspacePath": "/workspace/alice",
                    "taskGoal": "legacy ownerless session",
                    "participants": ["human", "claude"],
                }
            )
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["claude"],
                    "status": "ready",
                },
                "ui_token",
            )

            with pytest.raises(PermissionError, match="has no owner"):
                await backend.run(
                    "sbx_alice",
                    {
                        "sessionId": session["id"],
                        "taskGoal": "legacy ownerless session",
                        "assignments": [{"agent": "claude", "mode": "action"}],
                    },
                )

    asyncio.run(run_flow())


def test_daemon_run_dispatch_rejects_concurrent_second_claim() -> None:
    with TemporaryDirectory() as root:
        session_store = LocalSessionStore(root)
        daemon_store = LocalDaemonStore(root)
        registry = DaemonNodeRegistry(session_store, daemon_store)
        backend = ServerDaemonNodeBackend(registry)
        registry.register(
            {
                "sandboxId": "sbx_alice",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            },
            "ui_token",
        )

        def run_once() -> str:
            try:
                asyncio.run(
                    backend.run(
                        "sbx_alice",
                        {
                            "taskGoal": "fix auth",
                            "assignments": [{"agent": "codex", "mode": "action"}],
                        },
                    )
                )
                return "started"
            except ValueError as error:
                return str(error)

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: run_once(), range(2)))

        assert results.count("started") == 1
        assert any("no available execution slot" in result for result in results)


def test_set_disabled_agents_blocks_dispatch_and_survives_restart() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["claude", "codex"],
                    "status": "ready",
                },
                "ui_token",
            )

            registry.set_disabled_agents("sbx_alice", ["codex"])
            assert registry.get("sbx_alice")["disabledAgents"] == ["codex"]
            registry.set_agent_role_defaults(
                "sbx_alice", {"claude": "planner", "codex": "fixer"}
            )
            registry.set_agent_role_overrides("sbx_alice", {"claude": "tester"})
            assert registry.get("sbx_alice")["agentRoleDefaults"] == {
                "claude": "planner",
                "codex": "fixer",
            }
            assert registry.get("sbx_alice")["agentRoleOverrides"] == {
                "claude": "tester"
            }

            with pytest.raises(ValueError, match="disabled agent\\(s\\): codex"):
                await backend.run(
                    "sbx_alice",
                    {
                        "taskGoal": "review auth",
                        "assignments": [{"agent": "codex", "mode": "review"}],
                    },
                )

            session = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "implement auth",
                    "assignments": [{"agent": "claude", "mode": "action"}],
                },
            )
            assert session["status"] == "running"

            registry2 = DaemonNodeRegistry(
                LocalSessionStore(root), LocalDaemonStore(root)
            )
            assert registry2.get("sbx_alice")["disabledAgents"] == ["codex"]
            assert registry2.get("sbx_alice")["agentRoleDefaults"] == {
                "claude": "planner",
                "codex": "fixer",
            }
            assert registry2.get("sbx_alice")["agentRoleOverrides"] == {
                "claude": "tester"
            }

            registry.set_disabled_agents("sbx_alice", [])
            assert "disabledAgents" not in registry.get("sbx_alice")
            registry.set_agent_role_defaults("sbx_alice", {})
            registry.set_agent_role_overrides("sbx_alice", {})
            assert "agentRoleDefaults" not in registry.get("sbx_alice")
            assert "agentRoleOverrides" not in registry.get("sbx_alice")

            with pytest.raises(ValueError, match="Unknown agent"):
                registry.set_disabled_agents("sbx_alice", ["bogus"])
            with pytest.raises(ValueError, match="Unknown agent"):
                registry.set_agent_role_defaults("sbx_alice", {"bogus": "planner"})
            with pytest.raises(ValueError, match="Unknown agent role"):
                registry.set_agent_role_overrides("sbx_alice", {"claude": "bogus"})

    asyncio.run(run_flow())


def test_effective_agent_roles_use_overrides_defaults_and_review_fallback() -> None:
    node = {
        "agentRoleDefaults": {"codex": "planner", "claude": "fixer"},
        "agentRoleOverrides": {"codex": "tester"},
    }
    assert effective_role_for_assignment(node, {"agent": "codex"}, "action") == "tester"
    assert effective_role_for_assignment(node, {"agent": "claude"}, "action") == "fixer"
    assert (
        effective_role_for_assignment(
            node, {"agent": "codex", "role": "reviewer"}, "action"
        )
        == "reviewer"
    )
    assert (
        effective_role_for_assignment(node, {"agent": "codex"}, "review") == "reviewer"
    )
    assert effective_role_for_assignment({}, {"agent": "pi"}, "action") == "tester"


def test_daemon_run_records_effective_agent_role_override() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )
            registry.set_agent_role_defaults("sbx_alice", {"codex": "planner"})
            registry.set_agent_role_overrides("sbx_alice", {"codex": "fixer"})

            session = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "implement auth",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )

            stored = session_store.get_session(session["id"])
            assert stored["agentRuns"][0]["role"] == "fixer"

    asyncio.run(run_flow())


def test_register_sanitizes_and_exposes_agent_inventory() -> None:
    with TemporaryDirectory() as root:
        session_store = LocalSessionStore(root)
        daemon_store = LocalDaemonStore(root)
        registry = DaemonNodeRegistry(session_store, daemon_store)
        registry.register(
            {
                "sandboxId": "sbx_inv",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["claude"],
                "status": "ready",
                "agentInventory": {
                    "claude": {
                        "skills": [
                            {
                                "name": "brainstorming",
                                "namespace": "superpowers",
                                "description": "Ideas.",
                            },
                            {"name": "", "description": "dropped: no name"},
                            "not-a-dict",
                        ],
                        "mcpServers": [
                            {
                                "name": "codegraph",
                                "transport": "stdio",
                                "command": "codegraph",
                            },
                            {"name": "remote", "transport": "bogus"},
                        ],
                    },
                    "bogus-agent": {"skills": [{"name": "x"}]},
                    "codex": {"skills": [], "mcpServers": []},
                },
            },
            "ui_token",
        )

        node = next(n for n in registry.control_panel_nodes() if n["id"] == "sbx_inv")
        inventory = node["agentInventory"]
        assert set(inventory.keys()) == {"claude"}  # empty + unknown agents dropped
        assert inventory["claude"]["skills"] == [
            {
                "name": "brainstorming",
                "namespace": "superpowers",
                "description": "Ideas.",
            },
        ]
        assert inventory["claude"]["mcpServers"] == [
            {"name": "codegraph", "transport": "stdio", "command": "codegraph"},
            {"name": "remote", "transport": "stdio"},  # unknown transport coerced
        ]


def test_register_without_inventory_omits_field() -> None:
    with TemporaryDirectory() as root:
        registry = DaemonNodeRegistry(LocalSessionStore(root), LocalDaemonStore(root))
        registry.register(
            {
                "sandboxId": "sbx_none",
                "token": "node_token",
                "protocolVersion": 1,
                "supportedAgents": ["claude"],
                "status": "ready",
            },
            "ui_token",
        )
        node = next(n for n in registry.control_panel_nodes() if n["id"] == "sbx_none")
        assert "agentInventory" not in node
