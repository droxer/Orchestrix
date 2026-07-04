from __future__ import annotations

import asyncio
import base64
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from relay.daemon_registry import DaemonNodeRegistry, ServerDaemonNodeBackend, effective_role_for_assignment, sandbox_ui_token_matches
from relay.persistence.stores import DatabaseDaemonStore, LocalDaemonStore, LocalSessionStore


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
                "agentLog": "looks fine",
            }, "node_token")

            session = session_store.get_session(session["id"])
            assert session["status"] == "completed"
            assert "reviewVerdict" not in session
            assert registry.monitor_nodes()[0]["queuedCommandCount"] == 0

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
            registry.register({
                "sandboxId": "sbx_alice",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": str(workspace),
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            }, "ui_token")

            session = await backend.run("sbx_alice", {
                "taskGoal": "generate a deck",
                "assignments": [{"agent": "codex", "mode": "action"}],
            })
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

            registry.handle_event("sbx_alice", {
                "type": "run.completed",
                "commandId": command["id"],
                "sessionId": command["sessionId"],
                "runId": command["runId"],
                "agent": "codex",
                "mode": "action",
                "exitCode": 0,
                "agentLog": "created quarterly-review.pptx",
            }, "node_token")

            updated = session_store.get_session(session["id"])
            [artifact] = [item for item in updated["artifacts"] if item["kind"] == "workspace_file"]
            assert artifact["title"] == "quarterly-review.pptx"
            assert artifact["path"] == str(generated.resolve())
            assert artifact["workspaceRelativePath"] == "quarterly-review.pptx"
            assert artifact["agentRunId"] == command["runId"]
            assert artifact["id"] in updated["agentRuns"][0]["artifactIds"]
            # A snapshot copy is kept so the artifact survives workspace changes.
            assert session_store.read_artifact_content(session["id"], artifact["id"]) == b"pptx bytes"

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
            registry.register({
                "sandboxId": "sbx_alice",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": str(workspace),
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            }, "ui_token")

            session = await backend.run("sbx_alice", {
                "taskGoal": "generate a markdown report",
                "assignments": [{"agent": "codex", "mode": "action"}],
            })
            [command] = registry.take_commands("sbx_alice", "node_token")
            generated = output / "summary.md"
            generated.write_text("# Summary\n", encoding="utf-8")
            (workspace / "notes.md").write_text("normal docs edit\n", encoding="utf-8")

            registry.handle_event("sbx_alice", {
                "type": "run.completed",
                "commandId": command["id"],
                "sessionId": command["sessionId"],
                "runId": command["runId"],
                "agent": "codex",
                "mode": "action",
                "exitCode": 0,
                "agentLog": "created output/summary.md",
            }, "node_token")

            updated = session_store.get_session(session["id"])
            files = [item for item in updated["artifacts"] if item["kind"] == "workspace_file"]
            assert [artifact["workspaceRelativePath"] for artifact in files] == ["output/summary.md"]
            assert session_store.read_artifact_content(session["id"], files[0]["id"]) == b"# Summary\n"

    asyncio.run(run_flow())


def test_daemon_reported_generated_files_index_without_shared_filesystem() -> None:
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
                # This path does not exist on the backend host: the daemon
                # report alone must be enough to index and serve the artifact.
                "workspacePath": "/remote/daemon/workspace",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "capabilities": ["generated-files", "bogus-capability"],
                "status": "ready",
            }, "ui_token")
            assert registry.get("sbx_alice")["capabilities"] == ["generated-files"]

            session = await backend.run("sbx_alice", {
                "taskGoal": "generate a report",
                "assignments": [{"agent": "codex", "mode": "action"}],
            })
            [command] = registry.take_commands("sbx_alice", "node_token")
            registry.handle_event("sbx_alice", {
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
                        "relativePath": "reports/q2.pdf",
                        "title": "q2.pdf",
                        "bytes": 9,
                        "contentType": "application/pdf",
                        "contentBase64": base64.b64encode(b"pdf bytes").decode("ascii"),
                    },
                    {
                        "relativePath": "output/summary.md",
                        "title": "summary.md",
                        "bytes": 10,
                        "contentType": "text/markdown",
                        "contentBase64": base64.b64encode(b"# Summary\n").decode("ascii"),
                    },
                    {"relativePath": "../escape.pdf", "title": "escape.pdf", "bytes": 3},
                    {"relativePath": "secrets/server.key", "title": "cover.pdf", "bytes": 3},
                    {"relativePath": "notes.md", "title": "notes.md", "bytes": 3},
                ],
            }, "node_token")

            updated = session_store.get_session(session["id"])
            files = [item for item in updated["artifacts"] if item["kind"] == "workspace_file"]
            assert [artifact["workspaceRelativePath"] for artifact in files] == ["reports/q2.pdf", "output/summary.md"]
            assert all(artifact["agentRunId"] == command["runId"] for artifact in files)
            assert files[0]["bytes"] == 9
            assert session_store.read_artifact_content(session["id"], files[0]["id"]) == b"pdf bytes"
            assert session_store.read_artifact_content(session["id"], files[1]["id"]) == b"# Summary\n"

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
            registry.register({
                "sandboxId": "sbx_alice",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": str(workspace),
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            }, "ui_token")

            report = workspace / "report.pdf"
            session = await backend.run("sbx_alice", {
                "taskGoal": "generate a report",
                "assignments": [{"agent": "codex", "mode": "action"}],
            })
            [first_command] = registry.take_commands("sbx_alice", "node_token")
            report.write_bytes(b"v1")
            registry.handle_event("sbx_alice", {
                "type": "run.completed",
                "commandId": first_command["id"],
                "sessionId": first_command["sessionId"],
                "runId": first_command["runId"],
                "agent": "codex",
                "mode": "action",
                "exitCode": 0,
                "agentLog": "created report.pdf",
            }, "node_token")

            await backend.run("sbx_alice", {
                "taskGoal": "refresh the report",
                "sessionId": session["id"],
                "assignments": [{"agent": "codex", "mode": "action"}],
            })
            [second_command] = registry.take_commands("sbx_alice", "node_token")
            report.write_bytes(b"v2 with more bytes")
            registry.handle_event("sbx_alice", {
                "type": "run.completed",
                "commandId": second_command["id"],
                "sessionId": second_command["sessionId"],
                "runId": second_command["runId"],
                "agent": "codex",
                "mode": "action",
                "exitCode": 0,
                "agentLog": "refreshed report.pdf",
            }, "node_token")

            updated = session_store.get_session(session["id"])
            workspace_files = [item for item in updated["artifacts"] if item["kind"] == "workspace_file"]
            assert len(workspace_files) == 2
            assert {item["agentRunId"] for item in workspace_files} == {first_command["runId"], second_command["runId"]}
            latest = max(workspace_files, key=lambda item: item["createdAt"])
            assert session_store.read_artifact_content(session["id"], latest["id"]) == b"v2 with more bytes"

    asyncio.run(run_flow())


def test_daemon_capacity_allows_concurrent_ask_runs_only() -> None:
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
                "maxConcurrentRuns": 2,
                "runCapacityByMode": {"ask": 2, "review": 1, "action": 1},
                "status": "ready",
            }, "ui_token")

            first = await backend.run("sbx_alice", {
                "taskGoal": "explain auth",
                "assignments": [{"agent": "codex", "mode": "ask"}],
            })
            second = await backend.run("sbx_alice", {
                "taskGoal": "explain billing",
                "assignments": [{"agent": "codex", "mode": "ask"}],
            })
            assert first["id"] != second["id"]
            commands = registry.take_commands("sbx_alice", "node_token")
            assert [command["mode"] for command in commands] == ["ask", "ask"]
            assert len(registry.monitor_nodes()[0]["activeRuns"]) == 2

            with pytest.raises(ValueError, match="no available execution slot"):
                await backend.run("sbx_alice", {
                    "taskGoal": "edit files",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                })

    asyncio.run(run_flow())


def test_legacy_daemon_capacity_remains_single_slot() -> None:
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

            await backend.run("sbx_alice", {
                "taskGoal": "explain auth",
                "assignments": [{"agent": "codex", "mode": "ask"}],
            })
            with pytest.raises(ValueError, match="no available execution slot"):
                await backend.run("sbx_alice", {
                    "taskGoal": "explain billing",
                    "assignments": [{"agent": "codex", "mode": "ask"}],
                })

    asyncio.run(run_flow())


def test_daemon_rejects_event_agent_metadata_mismatch() -> None:
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
                "supportedAgents": ["codex", "claude"],
                "status": "ready",
            }, "ui_token")

            session = await backend.run("sbx_alice", {
                "taskGoal": "review auth",
                "assignments": [{"agent": "codex", "mode": "action"}],
            })
            [command] = registry.take_commands("sbx_alice", "node_token")

            with pytest.raises(PermissionError, match="metadata"):
                registry.handle_event("sbx_alice", {
                    "type": "run.completed",
                    "commandId": command["id"],
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": "claude",
                    "mode": "action",
                    "exitCode": 0,
                    "agentLog": "wrong agent",
                }, "node_token")

            assert session_store.get_session(session["id"])["artifacts"] == []

    asyncio.run(run_flow())


def test_daemon_rejects_event_lease_mismatch() -> None:
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
                "taskGoal": "review auth",
                "assignments": [{"agent": "codex", "mode": "action"}],
            })
            [command] = registry.take_commands("sbx_alice", "node_token")
            assert command["leaseId"].startswith("lease_")

            with pytest.raises(PermissionError, match="lease"):
                registry.handle_event("sbx_alice", {
                    "type": "run.completed",
                    "commandId": command["id"],
                    "leaseId": "lease_stale",
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": "codex",
                    "mode": "action",
                    "exitCode": 0,
                    "agentLog": "stale completion",
                }, "node_token")

            registry.handle_event("sbx_alice", {
                "type": "run.completed",
                "commandId": command["id"],
                "leaseId": command["leaseId"],
                "sessionId": command["sessionId"],
                "runId": command["runId"],
                "agent": "codex",
                "mode": "action",
                "exitCode": 0,
                "agentLog": "current completion",
            }, "node_token")

            assert session_store.get_session(session["id"])["status"] == "completed"

    asyncio.run(run_flow())


def test_daemon_failed_event_preserves_agent_log_without_artifact() -> None:
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

            raw_log = "  useful output\n\n"
            session = await backend.run("sbx_alice", {
                "taskGoal": "implement auth",
                "assignments": [{"agent": "codex", "mode": "action"}],
            })
            [command] = registry.take_commands("sbx_alice", "node_token")
            registry.handle_event("sbx_alice", {
                "type": "run.failed",
                "commandId": command["id"],
                "sessionId": command["sessionId"],
                "runId": command["runId"],
                "agent": "codex",
                "mode": "action",
                "error": "stream post failed",
                "agentLog": raw_log,
                "exitCode": 1,
            }, "node_token")

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
            registry.register({
                "sandboxId": "sbx_alice",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["claude", "codex"],
                "status": "ready",
            }, "ui_token")

            session = await backend.run("sbx_alice", {
                "taskGoal": "first question",
                "assignments": [{"agent": "claude", "mode": "action"}],
            })
            [first_command] = registry.take_commands("sbx_alice", "node_token")
            assert "prior_conversation" not in first_command["state"]
            registry.handle_event("sbx_alice", {
                "type": "run.completed",
                "commandId": first_command["id"],
                "sessionId": first_command["sessionId"],
                "runId": first_command["runId"],
                "agent": "claude",
                "mode": "action",
                "exitCode": 0,
                "agentLog": "● first answer",
            }, "node_token")

            await backend.run("sbx_alice", {
                "taskGoal": "follow up",
                "sessionId": session["id"],
                "assignments": [{"agent": "codex", "mode": "action"}],
            })
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
            registry.register({
                "sandboxId": "sbx_alice",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["claude", "codex"],
                "status": "ready",
            }, "ui_token")

            await backend.run("sbx_alice", {
                "taskGoal": "ship it",
                "assignments": [
                    {"agent": "claude", "mode": "action"},
                    {"agent": "codex", "mode": "action"},
                    {"agent": "claude", "mode": "action"},
                ],
            })
            [first_command] = registry.take_commands("sbx_alice", "node_token")
            registry.handle_event("sbx_alice", {
                "type": "run.completed",
                "commandId": first_command["id"],
                "sessionId": first_command["sessionId"],
                "runId": first_command["runId"],
                "agent": "claude",
                "mode": "action",
                "exitCode": 0,
                "agentLog": "● implementation note",
            }, "node_token")
            [second_command] = registry.take_commands("sbx_alice", "node_token")

            state = second_command["state"]
            assert "prior_conversation" not in state
            assert state["prior_agent_bridge"] == "[Previous from @claude]\nimplementation note"
            registry.handle_event("sbx_alice", {
                "type": "run.completed",
                "commandId": second_command["id"],
                "sessionId": second_command["sessionId"],
                "runId": second_command["runId"],
                "agent": "codex",
                "mode": "action",
                "exitCode": 0,
                "agentLog": "● review note",
            }, "node_token")
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
            registry.register({
                "sandboxId": "sbx_alice",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            }, "ui_token")
            session = session_store.create_session({
                "workspacePath": "/workspace/alice",
                "ownerEmployeeId": "alice",
                "taskGoal": "fix auth",
                "participants": ["human", "codex"],
            })

            updated = await backend.run("sbx_alice", {
                "taskGoal": "fix auth",
                "sessionId": session["id"],
                "assignments": [{"agent": "codex", "mode": "action"}],
                "decision": {"kind": "rerun", "targetAgent": "codex"},
            })

            assert updated["id"] == session["id"]
            assert updated["decisions"][0]["kind"] == "rerun"
            assert updated["decisions"][0]["targetAgent"] == "codex"
            [command] = registry.take_commands("sbx_alice", "node_token")
            assert command["sessionId"] == session["id"]

    asyncio.run(run_flow())


def test_daemon_run_does_not_record_decision_when_validation_fails() -> None:
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
            session = session_store.create_session({
                "workspacePath": "/workspace/alice",
                "ownerEmployeeId": "alice",
                "taskGoal": "fix auth",
                "participants": ["human", "kimi"],
            })

            with pytest.raises(ValueError, match="does not have ready agent"):
                await backend.run("sbx_alice", {
                    "taskGoal": "fix auth",
                    "sessionId": session["id"],
                    "assignments": [{"agent": "kimi", "mode": "action"}],
                    "decision": {"kind": "handoff", "targetAgent": "kimi"},
                })

            assert session_store.get_session(session["id"])["decisions"] == []

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
                "assignments": [{"agent": "codex", "mode": "action"}],
            })
            [command] = registry.take_commands("sbx_alice", "node_token")

            restarted = DaemonNodeRegistry(session_store, LocalDaemonStore(root))
            restarted.handle_event("sbx_alice", {
                "type": "run.completed",
                "commandId": command["id"],
                "sessionId": command["sessionId"],
                "runId": command["runId"],
                "agent": "codex",
                "mode": "action",
                "exitCode": 0,
                "agentLog": "done",
            }, "node_token")

            assert session_store.get_session(session["id"])["status"] == "completed"

    asyncio.run(run_flow())


def test_daemon_output_retry_after_registry_restart_is_deduplicated() -> None:
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
                "assignments": [{"agent": "codex", "mode": "action"}],
            })
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
                event for event in session_store.get_session(session["id"])["events"]
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
                "assignments": [{"agent": "claude", "mode": "action"}],
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
                "mode": "action",
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
                "assignments": [{"agent": "codex", "mode": "action"}],
            })
            [command] = registry.take_commands("sbx_alice", "node_token")
            [request] = daemon_store.list_active_run_requests("sbx_alice")
            daemon_store.update_run_request(request["id"], {"currentStartedAt": "2020-01-01T00:00:00.000Z"})

            monkeypatch.setattr("relay.daemon_registry.registry.DAEMON_RUN_TIMEOUT_MS", 1)
            registry.reap_stale_runs()

            failed = session_store.get_session(session["id"])
            assert failed["status"] == "failed"
            assert "timed out" in failed["finalOutcome"]
            assert daemon_store.list_active_run_requests("sbx_alice") == []
            assert command["id"] not in registry.active_commands

    monkeypatch.setattr("relay.daemon_registry.registry.DAEMON_RUN_TIMEOUT_MS", 60_000)
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
            "mode": "action",
            "taskGoal": "fix auth",
        })

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: store.take_queued_commands("sbx_alice"), range(2)))

        claimed = [command for commands in results for command in commands]
        assert [command["id"] for command in claimed] == ["cmd_once"]
        assert store.queued_command_count("sbx_alice") == 0


def test_database_daemon_store_preserves_artifact_snapshot_state() -> None:
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
        request = store.create_run_request({
            "nodeId": "sbx_alice",
            "sessionId": "ses_1",
            "taskGoal": "generate deck",
            "assignments": [{"agent": "codex", "mode": "action"}],
            "state": {"task_goal": "generate deck"},
        })

        updated = store.update_run_request(request["id"], {
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
        })

        assert updated["state"]["_relay_artifact_snapshot"]["/workspace/alice/existing.pptx"]["bytes"] == 10
        assert store.run_request_for_command("cmd_1")["state"]["_relay_artifact_snapshot"]


@pytest.mark.parametrize("store_factory", [LocalDaemonStore, lambda root: DatabaseDaemonStore(f"sqlite:///{root}/daemon.db", create_schema=True)])
def test_daemon_store_reclaims_expired_command_leases(store_factory) -> None:
    with TemporaryDirectory() as root:
        store = store_factory(root)
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
            "id": "cmd_retry",
            "type": "run.start",
            "sessionId": "ses_1",
            "runId": "run_1",
            "agent": "codex",
            "mode": "action",
            "taskGoal": "fix auth",
        })

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


@pytest.mark.parametrize("store_factory", [LocalDaemonStore, lambda root: DatabaseDaemonStore(f"sqlite:///{root}/daemon.db", create_schema=True)])
def test_daemon_store_renews_active_command_leases(store_factory) -> None:
    with TemporaryDirectory() as root:
        store = store_factory(root)
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
            "id": "cmd_long",
            "type": "run.start",
            "sessionId": "ses_1",
            "runId": "run_1",
            "agent": "codex",
            "mode": "action",
            "taskGoal": "fix auth",
        })

        [first] = store.take_queued_commands("sbx_alice", lease_seconds=0.05)
        time.sleep(0.08)
        store.renew_command_leases("sbx_alice", [first["id"]], lease_seconds=10)

        assert store.take_queued_commands("sbx_alice") == []


@pytest.mark.parametrize("store_factory", [LocalDaemonStore, lambda root: DatabaseDaemonStore(f"sqlite:///{root}/daemon.db", create_schema=True)])
def test_daemon_store_persists_agent_role_maps(store_factory) -> None:
    with TemporaryDirectory() as root:
        store = store_factory(root)
        store.register_node({
            "id": "sbx_alice",
            "employeeId": "alice",
            "workspacePath": "/workspace/alice",
            "status": "ready",
            "agents": {"codex": "ready"},
            "token": None,
            "createdAt": "2026-06-13T00:00:00.000Z",
            "updatedAt": "2026-06-13T00:00:00.000Z",
        })

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
                    "assignments": [{"agent": "claude", "mode": "action"}],
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
                    "assignments": [{"agent": "codex", "mode": "action"}],
                }))
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
            registry.set_agent_role_defaults("sbx_alice", {"claude": "planner", "codex": "fixer"})
            registry.set_agent_role_overrides("sbx_alice", {"claude": "tester"})
            assert registry.get("sbx_alice")["agentRoleDefaults"] == {"claude": "planner", "codex": "fixer"}
            assert registry.get("sbx_alice")["agentRoleOverrides"] == {"claude": "tester"}

            with pytest.raises(ValueError, match="disabled agent\\(s\\): codex"):
                await backend.run("sbx_alice", {
                    "taskGoal": "review auth",
                    "assignments": [{"agent": "codex", "mode": "review"}],
                })

            session = await backend.run("sbx_alice", {
                "taskGoal": "implement auth",
                "assignments": [{"agent": "claude", "mode": "action"}],
            })
            assert session["status"] == "running"

            registry2 = DaemonNodeRegistry(LocalSessionStore(root), LocalDaemonStore(root))
            assert registry2.get("sbx_alice")["disabledAgents"] == ["codex"]
            assert registry2.get("sbx_alice")["agentRoleDefaults"] == {"claude": "planner", "codex": "fixer"}
            assert registry2.get("sbx_alice")["agentRoleOverrides"] == {"claude": "tester"}

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
    assert effective_role_for_assignment(node, {"agent": "codex", "role": "reviewer"}, "action") == "reviewer"
    assert effective_role_for_assignment(node, {"agent": "codex"}, "review") == "reviewer"
    assert effective_role_for_assignment({}, {"agent": "pi"}, "action") == "tester"


def test_daemon_run_records_effective_agent_role_override() -> None:
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
            registry.set_agent_role_defaults("sbx_alice", {"codex": "planner"})
            registry.set_agent_role_overrides("sbx_alice", {"codex": "fixer"})

            session = await backend.run("sbx_alice", {
                "taskGoal": "implement auth",
                "assignments": [{"agent": "codex", "mode": "action"}],
            })

            stored = session_store.get_session(session["id"])
            assert stored["agentRuns"][0]["role"] == "fixer"

    asyncio.run(run_flow())


def test_register_sanitizes_and_exposes_agent_inventory() -> None:
    with TemporaryDirectory() as root:
        session_store = LocalSessionStore(root)
        daemon_store = LocalDaemonStore(root)
        registry = DaemonNodeRegistry(session_store, daemon_store)
        registry.register({
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
                        {"name": "brainstorming", "namespace": "superpowers", "description": "Ideas."},
                        {"name": "", "description": "dropped: no name"},
                        "not-a-dict",
                    ],
                    "mcpServers": [
                        {"name": "codegraph", "transport": "stdio", "command": "codegraph"},
                        {"name": "remote", "transport": "bogus"},
                    ],
                },
                "bogus-agent": {"skills": [{"name": "x"}]},
                "codex": {"skills": [], "mcpServers": []},
            },
        }, "ui_token")

        node = next(n for n in registry.control_panel_nodes() if n["id"] == "sbx_inv")
        inventory = node["agentInventory"]
        assert set(inventory.keys()) == {"claude"}  # empty + unknown agents dropped
        assert inventory["claude"]["skills"] == [
            {"name": "brainstorming", "namespace": "superpowers", "description": "Ideas."},
        ]
        assert inventory["claude"]["mcpServers"] == [
            {"name": "codegraph", "transport": "stdio", "command": "codegraph"},
            {"name": "remote", "transport": "stdio"},  # unknown transport coerced
        ]


def test_register_without_inventory_omits_field() -> None:
    with TemporaryDirectory() as root:
        registry = DaemonNodeRegistry(LocalSessionStore(root), LocalDaemonStore(root))
        registry.register({
            "sandboxId": "sbx_none",
            "token": "node_token",
            "protocolVersion": 1,
            "supportedAgents": ["claude"],
            "status": "ready",
        }, "ui_token")
        node = next(n for n in registry.control_panel_nodes() if n["id"] == "sbx_none")
        assert "agentInventory" not in node
