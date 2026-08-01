from __future__ import annotations

import asyncio
import base64
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Barrier, Event
from uuid import UUID

import pytest
from relay.daemon_registry import (
    DaemonNodeRegistry,
    ServerDaemonNodeBackend,
    daemon_active_run,
    effective_role_for_assignment,
    sandbox_ui_token_matches,
    workspace_paths_match,
)
from relay.persistence.agent_placement_store import LocalAgentPlacementStore
from relay.persistence.agent_store import LocalAgentStore
from relay.persistence.daemon_store import DatabaseDaemonStore, LocalDaemonStore
from relay.persistence.session_store import LocalSessionStore
from relay.persistence.store_common import _read_jsonl, new_database_id
from relay.sessions import SessionController
from sqlalchemy import event, select


def database_daemon_store(root: str) -> DatabaseDaemonStore:
    return DatabaseDaemonStore(f"sqlite:///{root}/daemon.db", create_schema=True)


DAEMON_STORE_FACTORIES = [LocalDaemonStore, database_daemon_store]


def stored_daemon_event_types(store: object) -> list[str]:
    events_dir = getattr(store, "events_dir", None)
    if events_dir is not None:
        events_path = events_dir / "events.jsonl"
        if not events_path.exists():
            return []
        return [event["type"] for event in _read_jsonl(events_path)]
    with store.engine.begin() as conn:
        return list(conn.scalars(select(store.events.c.type)))


@pytest.mark.parametrize("daemon_store_factory", DAEMON_STORE_FACTORIES)
def test_daemon_store_notifies_when_command_becomes_visible(
    daemon_store_factory,
) -> None:
    with TemporaryDirectory() as root:
        store = daemon_store_factory(root)
        notified: list[str] = []
        store.set_command_listener(notified.append)
        store.register_node(store_node_payload())

        store.enqueue_command("sbx_alice", run_start_command("cmd_one", "run_one"))

        assert notified == ["sbx_alice"]


@pytest.mark.parametrize("daemon_store_factory", DAEMON_STORE_FACTORIES)
def test_provisioned_daemon_nodes_use_uuid_ids(daemon_store_factory) -> None:
    with TemporaryDirectory() as root:
        registry = DaemonNodeRegistry(
            LocalSessionStore(root), daemon_store_factory(root)
        )

        node, _, _ = registry.provision_pending(
            "alice", "/Users/alice/project", "boxlite", "employee-device"
        )

        assert str(UUID(node["id"])) == node["id"]


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


@pytest.mark.parametrize("daemon_store_factory", DAEMON_STORE_FACTORIES)
def test_daemon_store_retains_managed_runtime_identity_after_delete(
    daemon_store_factory,
) -> None:
    with TemporaryDirectory() as root:
        store = daemon_store_factory(root)
        assert store.historical_managed_runtime_ids("computer_one") == set()
        store.register_node(
            {
                **store_node_payload(),
                "id": "runtime_old",
                "managedNodeId": "computer_one",
            }
        )

        store.delete_node("runtime_old")

        assert store.historical_managed_runtime_ids("computer_one") == {"runtime_old"}
        assert store.historical_managed_node_id("runtime_old") == "computer_one"
        assert store.historical_managed_node_ids(
            {"runtime_old", "runtime_missing"}
        ) == {"runtime_old": "computer_one"}


@pytest.mark.parametrize("daemon_store_factory", DAEMON_STORE_FACTORIES)
def test_pending_employee_device_enrollment_rotates_token_after_restart(
    daemon_store_factory,
) -> None:
    with TemporaryDirectory() as root:
        first = DaemonNodeRegistry(LocalSessionStore(root), daemon_store_factory(root))
        node, _, first_token = first.provision_pending(
            "alice", "/Users/alice/project", "boxlite", "employee-device"
        )

        restarted = DaemonNodeRegistry(
            LocalSessionStore(root), daemon_store_factory(root)
        )
        retried, _, replacement_token = restarted.provision_pending(
            "alice", "/Users/alice/project", "boxlite", "employee-device"
        )

        assert retried["id"] == node["id"]
        assert replacement_token
        assert replacement_token != first_token
        registration = {
            "sandboxId": node["id"],
            "employeeId": "alice",
            "workspacePath": "/Users/alice/project",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "status": "ready",
        }
        with pytest.raises(PermissionError):
            restarted.register({**registration, "token": first_token})
        assert (
            restarted.register({**registration, "token": replacement_token})["status"]
            == "ready"
        )


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


def test_command_poll_cannot_observe_run_before_request_links_command() -> None:
    class PausingDaemonStore(DatabaseDaemonStore):
        def __init__(self, database_url: str):
            super().__init__(database_url, create_schema=True)
            self.enqueued = Event()
            self.release_enqueue = Event()

        def publish_command(self, command_id: str) -> dict[str, object]:
            self.enqueued.set()
            assert self.release_enqueue.wait(timeout=1)
            return super().publish_command(command_id)

    with TemporaryDirectory() as root:
        database_url = f"sqlite:///{root}/daemon.db"
        daemon_store = PausingDaemonStore(database_url)
        registry = DaemonNodeRegistry(LocalSessionStore(root), daemon_store)
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
        second_registry = DaemonNodeRegistry(
            LocalSessionStore(root), DatabaseDaemonStore(database_url)
        )

        with ThreadPoolExecutor(max_workers=2) as executor:
            run_future = executor.submit(
                lambda: asyncio.run(
                    ServerDaemonNodeBackend(registry).run(
                        "sbx_alice",
                        {
                            "taskGoal": "dispatch atomically",
                            "assignments": [{"agent": "codex", "mode": "action"}],
                        },
                    )
                )
            )
            assert daemon_store.enqueued.wait(timeout=1)
            poll_future = executor.submit(
                second_registry.take_commands, "sbx_alice", "node_token"
            )
            [command] = poll_future.result(timeout=1)
            assert (
                second_registry.daemon_store.run_request_for_command(command["id"])
                is not None
            )
            assert any(
                run["id"] == command["runId"]
                for run in second_registry.store.get_session(command["sessionId"])[
                    "agentRuns"
                ]
            )

            daemon_store.release_enqueue.set()
            run_future.result(timeout=1)


def test_dispatch_claim_prevents_reaper_from_creating_second_command() -> None:
    class PausingClaimStore(DatabaseDaemonStore):
        def __init__(self, database_url: str):
            super().__init__(database_url, create_schema=True)
            self.claimed = Event()
            self.release_claim = Event()

        def claim_run_request_dispatch(
            self, request_id: str, claim_id: str, lease_seconds: float
        ) -> dict[str, object] | None:
            request = super().claim_run_request_dispatch(
                request_id, claim_id, lease_seconds
            )
            if request:
                self.claimed.set()
                assert self.release_claim.wait(timeout=1)
            return request

    with TemporaryDirectory() as root:
        database_url = f"sqlite:///{root}/daemon.db"
        daemon_store = PausingClaimStore(database_url)
        registry = DaemonNodeRegistry(LocalSessionStore(root), daemon_store)
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
        second = DaemonNodeRegistry(
            LocalSessionStore(root), DatabaseDaemonStore(database_url)
        )

        with ThreadPoolExecutor(max_workers=2) as executor:
            run_future = executor.submit(
                lambda: asyncio.run(
                    ServerDaemonNodeBackend(registry).run(
                        "sbx_alice",
                        {
                            "taskGoal": "dispatch once",
                            "assignments": [{"agent": "codex", "mode": "action"}],
                        },
                    )
                )
            )
            assert daemon_store.claimed.wait(timeout=1)
            second.reap_stale_runs()
            assert second.take_commands("sbx_alice", "node_token") == []
            daemon_store.release_claim.set()
            run_future.result(timeout=1)

        [command] = second.take_commands("sbx_alice", "node_token")
        assert command["taskGoal"] == "dispatch once"
        assert second.take_commands("sbx_alice", "node_token") == []


def test_staged_command_is_published_after_dispatcher_crash() -> None:
    class FailingPublishStore(DatabaseDaemonStore):
        def __init__(self, database_url: str):
            super().__init__(database_url, create_schema=True)
            self.fail_once = True

        def publish_command(self, command_id: str) -> dict[str, object]:
            if self.fail_once:
                self.fail_once = False
                raise RuntimeError("dispatcher crashed before publish")
            return super().publish_command(command_id)

    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            database_url = f"sqlite:///{root}/daemon.db"
            session_store = LocalSessionStore(root)
            registry = DaemonNodeRegistry(
                session_store, FailingPublishStore(database_url)
            )
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
            with pytest.raises(RuntimeError, match="before publish"):
                await ServerDaemonNodeBackend(registry).run(
                    "sbx_alice",
                    {
                        "taskGoal": "recover dispatch",
                        "assignments": [{"agent": "codex", "mode": "action"}],
                    },
                )

            restarted = DaemonNodeRegistry(
                LocalSessionStore(root), DatabaseDaemonStore(database_url)
            )
            [command] = restarted.take_commands("sbx_alice", "node_token")
            assert command["taskGoal"] == "recover dispatch"
            assert (
                restarted.daemon_store.run_request_for_command(command["id"])
                is not None
            )

    asyncio.run(run_flow())


def test_staged_command_is_relinked_after_dispatcher_crash_before_link() -> None:
    class FailingLinkStore(DatabaseDaemonStore):
        def __init__(self, database_url: str):
            super().__init__(database_url, create_schema=True)
            self.fail_once = True

        def update_run_request_if_claimed(
            self,
            request_id: str,
            claim_key: str,
            claim_id: str,
            patch: dict[str, object],
        ) -> dict[str, object] | None:
            if self.fail_once and patch.get("currentCommandId"):
                self.fail_once = False
                raise RuntimeError("dispatcher crashed before link")
            return super().update_run_request_if_claimed(
                request_id, claim_key, claim_id, patch
            )

    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            database_url = f"sqlite:///{root}/daemon.db"
            session_store = LocalSessionStore(root)
            registry = DaemonNodeRegistry(session_store, FailingLinkStore(database_url))
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
            with pytest.raises(RuntimeError, match="before link"):
                await ServerDaemonNodeBackend(registry).run(
                    "sbx_alice",
                    {
                        "taskGoal": "recover orphaned stage",
                        "assignments": [{"agent": "codex", "mode": "action"}],
                    },
                )

            restarted_store = DatabaseDaemonStore(database_url)
            [request] = restarted_store.list_active_run_requests("sbx_alice")
            staged = restarted_store.pending_command_for_run_request(request["id"])
            assert staged is not None

            restarted = DaemonNodeRegistry(LocalSessionStore(root), restarted_store)
            [command] = restarted.take_commands("sbx_alice", "node_token")
            assert command["id"] == staged["id"]
            assert (
                restarted_store.pending_command_for_run_request(request["id"]) is None
            )
            assert len(restarted_store.list_active_runs("sbx_alice")) == 1

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
            ) -> dict[str, int]:
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


def test_daemon_collaboration_retry_after_registry_restart_is_deduplicated() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            registry = DaemonNodeRegistry(session_store, LocalDaemonStore(root))
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
            session = await ServerDaemonNodeBackend(registry).run(
                "sbx_alice",
                {
                    "taskGoal": "coordinate agents",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [command] = registry.take_commands("sbx_alice", "node_token")
            collaboration = {
                "type": "run.collaboration",
                "commandId": command["id"],
                "sessionId": command["sessionId"],
                "runId": command["runId"],
                "agent": "codex",
                "mode": "action",
                "sequence": 0,
                "collaboration": {"tool": "spawnAgent", "status": "completed"},
            }
            registry.handle_event("sbx_alice", collaboration, "node_token")

            restarted = DaemonNodeRegistry(
                LocalSessionStore(root), LocalDaemonStore(root)
            )
            restarted.handle_event("sbx_alice", collaboration, "node_token")

            events = [
                event
                for event in session_store.get_session(session["id"])["events"]
                if event["type"] == "agent.collaboration"
            ]
            assert len(events) == 1

    asyncio.run(run_flow())


def test_daemon_fallback_output_buffer_is_bounded(monkeypatch) -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            registry = DaemonNodeRegistry(
                LocalSessionStore(root), LocalDaemonStore(root)
            )
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
            await ServerDaemonNodeBackend(registry).run(
                "sbx_alice",
                {
                    "taskGoal": "stream a lot",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [command] = registry.take_commands("sbx_alice", "node_token")
            for sequence, text in enumerate(("1234", "5678")):
                registry.handle_event(
                    "sbx_alice",
                    {
                        "type": "run.output",
                        "commandId": command["id"],
                        "sessionId": command["sessionId"],
                        "runId": command["runId"],
                        "agent": "codex",
                        "stream": "stdout",
                        "text": text,
                        "sequence": sequence,
                    },
                    "node_token",
                )

            assert registry.output_for_run(command["runId"]) == "45678"
            assert registry.output_sizes[command["runId"]] == 5

    monkeypatch.setattr("relay.daemon_registry.registry.RUN_OUTPUT_BUFFER_MAX_CHARS", 5)
    asyncio.run(run_flow())


def test_daemon_output_retry_survives_event_log_write_failure(monkeypatch) -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            registry = DaemonNodeRegistry(session_store, LocalDaemonStore(root))
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
            session = await ServerDaemonNodeBackend(registry).run(
                "sbx_alice",
                {
                    "taskGoal": "persist output",
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
                "text": "durable",
                "sequence": 0,
            }
            original_append = session_store.append_event
            failed_once = False

            def append_with_one_failure(
                session_id: str, event: dict[str, object]
            ) -> dict[str, object]:
                nonlocal failed_once
                if event.get("type") == "agent.output" and not failed_once:
                    failed_once = True
                    raise RuntimeError("disk unavailable")
                return original_append(session_id, event)

            monkeypatch.setattr(session_store, "append_event", append_with_one_failure)
            with pytest.raises(RuntimeError, match="disk unavailable"):
                registry.handle_event("sbx_alice", output, "node_token")
            registry.handle_event("sbx_alice", output, "node_token")

            events = [
                event
                for event in session_store.get_session(session["id"])["events"]
                if event["type"] == "agent.output"
            ]
            assert [event["text"] for event in events] == ["durable"]

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
            assert files[0]["path"].startswith(
                "/remote/daemon/workspace/agents/agent-YWdlbnRfcmVzZWFyY2g/"
            )
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


def test_generated_file_replay_fills_in_partially_indexed_report() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/remote/workspace",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "capabilities": ["generated-files"],
                    "status": "ready",
                },
                "ui_token",
            )
            session = await ServerDaemonNodeBackend(registry).run(
                "sbx_alice",
                {
                    "taskGoal": "index both files",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [command] = registry.take_commands("sbx_alice", "node_token")
            [request] = daemon_store.list_active_run_requests("sbx_alice")
            first_path = "reports/first.pdf"
            session_store.index_workspace_artifact(
                session["id"],
                {
                    "id": "art_existing",
                    "kind": "workspace_file",
                    "title": "first.pdf",
                    "path": f"/remote/workspace/{first_path}",
                    "createdAt": "2026-07-13T00:00:00.000Z",
                    "agentRunId": command["runId"],
                    "bytes": 5,
                    "contentType": "application/pdf",
                    "workspaceRelativePath": first_path,
                },
                b"first",
            )
            event = {
                "runId": command["runId"],
                "generatedFiles": [
                    {
                        "relativePath": first_path,
                        "title": "first.pdf",
                        "bytes": 5,
                        "contentType": "application/pdf",
                    },
                    {
                        "relativePath": "reports/second.pdf",
                        "title": "second.pdf",
                        "bytes": 6,
                        "contentType": "application/pdf",
                    },
                ],
            }

            registry._record_generated_workspace_artifacts(
                registry.get("sbx_alice"),
                request,
                event,
                None,
                request["assignments"][0],
            )

            artifacts = session_store.get_session(session["id"])["artifacts"]
            assert [item["workspaceRelativePath"] for item in artifacts] == [
                first_path,
                "reports/second.pdf",
            ]

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


def test_active_run_survives_heartbeat_seen_by_another_backend_replica() -> None:
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
                    "taskGoal": "survive backend load balancing",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [command] = first.take_commands(
                "sbx_alice",
                "node_token",
                renew_known_active=False,
            )

            first.sandboxes["sbx_alice"]["lastSeenAt"] = "2020-01-01T00:00:00.000Z"
            second.renew_active_command_leases(
                "sbx_alice",
                "node_token",
                [(command["id"], command["leaseId"])],
                lease_seconds=10,
            )

            [request] = first.daemon_store.list_active_run_requests()
            assert request["nodeId"] == "sbx_alice"
            assert second.sandboxes["sbx_alice"]["lastSeenAt"] != (
                "2020-01-01T00:00:00.000Z"
            )
            assert first.daemon_store.get_node("sbx_alice")["lastSeenAt"] != (
                "2020-01-01T00:00:00.000Z"
            )

            first.reap_stale_runs()

            active = session_store.get_session(session["id"])
            assert active.get("finalOutcome") != (
                "Daemon node heartbeat expired while run was active."
            )
            assert active["status"] == "running"

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
            request = daemon_store.run_request_for_command(first_command["id"])
            assert request is not None
            daemon_store.update_run_request(
                request["id"],
                {
                    "state": {
                        **request["state"],
                        "future_transient_field": "must not cross run boundaries",
                    }
                },
            )
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
            assert "future_transient_field" not in state
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


def test_active_session_run_request_is_global_after_cross_node_handoff() -> None:
    with TemporaryDirectory() as root:
        session_store = LocalSessionStore(root)
        daemon_store = LocalDaemonStore(root)
        registry = DaemonNodeRegistry(session_store, daemon_store)
        session = session_store.create_session(
            {
                "workspacePath": "/workspace/shared",
                "ownerEmployeeId": "alice",
                "taskGoal": "plan and build",
                "participants": ["human", "claude", "codex"],
            }
        )
        active = daemon_store.create_run_request(
            {
                "nodeId": "node_a",
                "sessionId": session["id"],
                "taskGoal": session["taskGoal"],
                "assignments": [{"agent": "claude", "mode": "ask"}],
                "state": {},
            }
        )
        daemon_store.update_run_request(active["id"], {"nodeId": "node_b"})

        with pytest.raises(ValueError, match="already has an active daemon run"):
            registry.start_run_request(
                "node_a",
                session["id"],
                session["taskGoal"],
                [{"agent": "claude", "mode": "ask"}],
                {},
            )


@pytest.mark.parametrize("store_factory", DAEMON_STORE_FACTORIES)
def test_active_session_run_request_claim_is_atomic_across_store_instances(
    store_factory,
) -> None:
    with TemporaryDirectory() as root:
        stores = (store_factory(root), store_factory(root))
        stores[0].register_node(store_node_payload())
        barrier = Barrier(2)

        def create(store) -> str:
            barrier.wait()
            return store.create_run_request(
                {
                    "nodeId": "sbx_alice",
                    "sessionId": "ses_shared",
                    "taskGoal": "do one thing",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                    "state": {},
                }
            )["id"]

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(create, store) for store in stores]

        assert sum(future.exception() is None for future in futures) == 1
        failure = next(
            future.exception() for future in futures if future.exception() is not None
        )
        assert isinstance(failure, ValueError)
        assert "already has an active daemon run" in str(failure)


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


def test_terminal_event_wins_over_stale_reaper_on_another_registry(monkeypatch) -> None:
    class PausingTerminalStore(DatabaseDaemonStore):
        def __init__(self, database_url: str):
            super().__init__(database_url, create_schema=True)
            self.terminal_marked = Event()
            self.release_terminal = Event()

        def mark_command_cancelled(
            self, node_id: str, event: dict[str, object]
        ) -> bool:
            accepted = super().mark_command_cancelled(node_id, event)
            self.terminal_marked.set()
            assert self.release_terminal.wait(timeout=1)
            return accepted

    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            database_url = f"sqlite:///{root}/daemon.db"
            session_store = LocalSessionStore(root)
            terminal_store = PausingTerminalStore(database_url)
            registry = DaemonNodeRegistry(session_store, terminal_store)
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
            session = await ServerDaemonNodeBackend(registry).run(
                "sbx_alice",
                {
                    "taskGoal": "cancel safely",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [command] = registry.take_commands("sbx_alice", "node_token")
            [request] = terminal_store.list_active_run_requests("sbx_alice")
            terminal_store.update_run_request(
                request["id"], {"currentStartedAt": "2020-01-01T00:00:00.000Z"}
            )
            second = DaemonNodeRegistry(
                LocalSessionStore(root), DatabaseDaemonStore(database_url)
            )
            monkeypatch.setattr(
                "relay.daemon_registry.registry.DAEMON_RUN_TIMEOUT_MS", 1
            )
            event = {
                "type": "run.cancelled",
                "commandId": command["id"],
                "sessionId": command["sessionId"],
                "runId": command["runId"],
                "agent": "codex",
                "mode": "action",
                "reason": "user requested",
            }

            with ThreadPoolExecutor(max_workers=1) as executor:
                terminal_future = executor.submit(
                    registry.handle_event, "sbx_alice", event, "node_token"
                )
                assert terminal_store.terminal_marked.wait(timeout=1)
                second.reap_stale_runs()
                terminal_store.release_terminal.set()
                terminal_future.result(timeout=1)

            completed = session_store.get_session(session["id"])
            assert completed["status"] == "cancelled"
            assert (
                len(
                    [
                        item
                        for item in completed["events"]
                        if item["type"] == "agent.completed"
                    ]
                )
                == 1
            )

    asyncio.run(run_flow())


def test_terminal_event_retry_recovers_after_handler_crash() -> None:
    async def run_flow() -> None:
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
            session = await ServerDaemonNodeBackend(registry).run(
                "sbx_alice",
                {
                    "taskGoal": "recover terminal",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [command] = registry.take_commands("sbx_alice", "node_token")
            event = {
                "type": "run.cancelled",
                "commandId": command["id"],
                "sessionId": command["sessionId"],
                "runId": command["runId"],
                "agent": "codex",
                "mode": "action",
                "reason": "user requested",
            }
            assert daemon_store.mark_command_cancelled("sbx_alice", event)

            restarted = DaemonNodeRegistry(
                LocalSessionStore(root), LocalDaemonStore(root)
            )
            restarted.handle_event("sbx_alice", event, "node_token")

            recovered = session_store.get_session(session["id"])
            assert recovered["status"] == "cancelled"
            assert daemon_store.list_active_run_requests("sbx_alice") == []

    asyncio.run(run_flow())


def test_terminal_event_retry_fails_orphaned_run_when_session_was_deleted() -> None:
    async def run_flow() -> None:
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
            session = await ServerDaemonNodeBackend(registry).run(
                "sbx_alice",
                {
                    "taskGoal": "finish after deletion",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [command] = registry.take_commands("sbx_alice", "node_token")
            event = {
                "type": "run.completed",
                "commandId": command["id"],
                "sessionId": command["sessionId"],
                "runId": command["runId"],
                "agent": "codex",
                "mode": "action",
                "exitCode": 1,
                "agentLog": "agent failed",
            }
            assert daemon_store.mark_command_completed("sbx_alice", event)
            claimed = daemon_store.claim_terminal_run_request(
                command["id"], event, "claim_crashed", 60
            )
            assert claimed and claimed["status"] == "finalizing"
            claimed = daemon_store.update_run_request(
                claimed["id"],
                {
                    "state": {
                        **claimed["state"],
                        "_relay_terminal_claim_expires_at": "2020-01-01T00:00:00.000Z",
                    }
                },
            )
            session_store.delete_session(session["id"])

            registry.reap_stale_runs()

            assert daemon_store.list_active_run_requests("sbx_alice") == []
            recovered = daemon_store.get_run_request(claimed["id"])
            assert recovered and recovered["status"] == "failed"
            assert recovered["error"] == (
                f"Session {session['id']} disappeared before run finalization."
            )

    asyncio.run(run_flow())


def test_terminal_event_replay_is_claimed_by_only_one_backend_replica() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            database_url = f"sqlite:///{root}/daemon.db"
            session_store = LocalSessionStore(root)
            daemon_store = DatabaseDaemonStore(database_url, create_schema=True)
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
            session = await ServerDaemonNodeBackend(registry).run(
                "sbx_alice",
                {
                    "taskGoal": "finalize once",
                    "assignments": [{"agent": "codex", "mode": "action"}],
                },
            )
            [command] = registry.take_commands("sbx_alice", "node_token")
            event = {
                "type": "run.completed",
                "commandId": command["id"],
                "sessionId": command["sessionId"],
                "runId": command["runId"],
                "agent": "codex",
                "mode": "action",
                "exitCode": 0,
                "agentLog": "done",
            }
            assert daemon_store.mark_command_completed("sbx_alice", event)
            replicas = [
                DaemonNodeRegistry(
                    LocalSessionStore(root), DatabaseDaemonStore(database_url)
                )
                for _ in range(2)
            ]

            with ThreadPoolExecutor(max_workers=2) as executor:
                list(
                    executor.map(
                        lambda replica: replica.handle_event(
                            "sbx_alice", event, "node_token"
                        ),
                        replicas,
                    )
                )

            completed = session_store.get_session(session["id"])
            assert completed["status"] == "completed"
            assert (
                len(
                    [
                        item
                        for item in completed["events"]
                        if item["type"] == "agent.completed"
                    ]
                )
                == 1
            )

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
            registry.handle_event(
                "sbx_alice",
                {
                    "type": "run.output",
                    "commandId": command["id"],
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": "codex",
                    "stream": "stdout",
                    "text": "still working",
                    "sequence": 0,
                },
                "node_token",
            )
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
            assert command["runId"] not in registry.outputs
            assert command["runId"] not in registry.output_sequences
            assert command["runId"] not in registry.output_sequences_hydrated

    monkeypatch.setattr("relay.daemon_registry.registry.DAEMON_RUN_TIMEOUT_MS", 60_000)
    asyncio.run(run_flow())


def test_workspace_path_comparison_does_not_follow_symlinks() -> None:
    with TemporaryDirectory() as root:
        target = Path(root) / "target"
        target.mkdir()
        alias = Path(root) / "alias"
        alias.symlink_to(target, target_is_directory=True)

        assert not workspace_paths_match(str(alias), str(target))


def test_logical_assignment_validation_fails_closed_without_stores() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            registry = DaemonNodeRegistry(
                LocalSessionStore(root), LocalDaemonStore(root)
            )
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

            with pytest.raises(ValueError, match="require agent and placement stores"):
                await ServerDaemonNodeBackend(registry).run(
                    "sbx_alice",
                    {
                        "taskGoal": "must validate",
                        "agentFirst": True,
                        "assignments": [
                            {
                                "agent": "codex",
                                "mode": "action",
                                "agentId": "agent_1",
                                "placementId": "placement_1",
                                "daemonNodeId": "sbx_alice",
                            }
                        ],
                    },
                )

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


def test_new_daemon_records_store_only_split_credential_hashes() -> None:
    with TemporaryDirectory() as root:
        registry = DaemonNodeRegistry(LocalSessionStore(root), LocalDaemonStore(root))
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

        node = registry.get("sbx_alice") or {}
        assert node["uiTokenHash"].startswith("sha256:")
        assert node["nodeTokenHash"].startswith("sha256:")
        assert "token" not in node
        assert "tokenHash" not in node
        assert "nodeToken" not in node


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


@pytest.mark.parametrize("store_factory", DAEMON_STORE_FACTORIES)
def test_registry_restart_keeps_agents_ready_when_live_daemon_resumes_polling(
    store_factory,
) -> None:
    with TemporaryDirectory() as root:
        registry = DaemonNodeRegistry(LocalSessionStore(root), store_factory(root))
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

        restarted = DaemonNodeRegistry(LocalSessionStore(root), store_factory(root))
        restarted.renew_active_command_leases("sbx_alice", "node_token", [])
        node = restarted.monitor_nodes()[0]

        assert node["online"] is True
        assert node["agents"]["codex"] == "ready"


@pytest.mark.parametrize("store_factory", DAEMON_STORE_FACTORIES)
def test_registry_restart_does_not_revive_retired_daemon_on_poll(
    store_factory,
) -> None:
    with TemporaryDirectory() as root:
        registry = DaemonNodeRegistry(LocalSessionStore(root), store_factory(root))
        registry.register(
            {
                "sandboxId": "sbx_retired",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            },
            "ui_token",
        )
        registry.fence_managed_node("sbx_retired")

        restarted = DaemonNodeRegistry(LocalSessionStore(root), store_factory(root))
        restarted.renew_active_command_leases("sbx_retired", "node_token", [])
        node = restarted.monitor_nodes()[0]

        assert node["status"] == "stopped"
        assert node["online"] is False
        assert node["agents"]["codex"] == "unknown"


@pytest.mark.parametrize("store_factory", DAEMON_STORE_FACTORIES)
def test_registry_persists_computer_display_name(store_factory) -> None:
    with TemporaryDirectory() as root:
        registry = DaemonNodeRegistry(LocalSessionStore(root), store_factory(root))
        registry.register(
            {
                "sandboxId": "sbx_alice",
                "employeeId": "alice",
                "token": "node_token",
                "workspaceId": "mch_alice",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            },
            "ui_token",
        )

        registry.set_display_name("sbx_alice", "Office Mac")

        restarted = DaemonNodeRegistry(LocalSessionStore(root), store_factory(root))
        assert restarted.get("sbx_alice")["displayName"] == "Office Mac"


@pytest.mark.parametrize(
    "store_factory",
    [
        LocalDaemonStore,
        lambda root: DatabaseDaemonStore(
            f"sqlite:///{root}/daemon.db", create_schema=True
        ),
    ],
)
def test_daemon_store_persists_sandbox_mode_and_node_location(store_factory) -> None:
    with TemporaryDirectory() as root:
        store = store_factory(root)
        store.register_node(
            {
                "id": "sbx_alice",
                "employeeId": "alice",
                "workspacePath": "/workspace/alice",
                "sandboxMode": "boxlite",
                "nodeLocation": "employee-device",
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
        assert node["nodeLocation"] == "employee-device"


@pytest.mark.parametrize("store_factory", DAEMON_STORE_FACTORIES)
def test_daemon_store_persists_canonical_workspace_id(store_factory) -> None:
    with TemporaryDirectory() as root:
        store = store_factory(root)
        store.register_node(store_node_payload())

        [node] = store.list_nodes()
        assert node["workspaceId"] == "repo:relay"


def test_multi_node_workflow_is_rejected_even_with_shared_workspace_id() -> None:
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

            with pytest.raises(
                ValueError,
                match="collaboration requires every agent to run on the same node",
            ):
                await backend.run(
                    "node_a",
                    {
                        "taskGoal": "research then implement",
                        "agentFirst": True,
                        "actorEmployeeId": "alice",
                        "assignments": [
                            {
                                "agent": "claude",
                                "mode": "ask",
                                "daemonNodeId": "node_a",
                            },
                            {
                                "agent": "codex",
                                "mode": "action",
                                "daemonNodeId": "node_b",
                            },
                        ],
                    },
                )

            assert registry.take_commands("node_a", "token_node_a") == []
            assert registry.take_commands("node_b", "token_node_b") == []

    asyncio.run(run_flow())


def test_same_node_workflow_revalidates_placement_before_next_enqueue() -> None:
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
                "node_a",
                {"workspacePolicy": {"kind": "shared-path"}},
            )
            registry.register(
                {
                    "sandboxId": "node_a",
                    "employeeId": "alice",
                    "token": "token_node_a",
                    "workspacePath": "/work/node_a",
                    "workspaceId": "repo:relay",
                    "protocolVersion": 1,
                    "supportedAgents": ["claude", "codex"],
                    "status": "ready",
                },
                "ui_node_a",
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
                            "daemonNodeId": "node_a",
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

            assert registry.take_commands("node_a", "token_node_a") == []
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
                "id": "00000000-0000-4000-8000-000000000001",
                "type": "run.start",
                "sessionId": "ses_1",
                "runId": "00000000-0000-4000-8000-000000000002",
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
        assert [command["id"] for command in claimed] == [
            "00000000-0000-4000-8000-000000000001"
        ]
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
                "currentCommandId": "00000000-0000-4000-8000-000000000003",
                "currentRunId": "00000000-0000-4000-8000-000000000004",
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
        assert store.run_request_for_command("00000000-0000-4000-8000-000000000003")[
            "state"
        ]["_relay_artifact_snapshot"]


@pytest.mark.parametrize("store_factory", DAEMON_STORE_FACTORIES)
def test_active_runs_carry_logical_agent_and_placement(store_factory) -> None:
    with TemporaryDirectory() as root:
        store = store_factory(root)
        store.register_node(store_node_payload())
        store.enqueue_command(
            "sbx_alice",
            {
                **run_start_command(
                    "00000000-0000-4000-8000-000000000005",
                    "00000000-0000-4000-8000-000000000006",
                ),
                "logicalAgentId": "agent_builder",
                "placementId": "placement_1",
            },
        )

        run = store.list_active_runs("sbx_alice")[0]
        assert run["logicalAgentId"] == "agent_builder"
        assert run["placementId"] == "placement_1"

        projected = daemon_active_run(run)
        assert projected["logicalAgentId"] == "agent_builder"
        assert projected["placementId"] == "placement_1"


@pytest.mark.parametrize("store_factory", DAEMON_STORE_FACTORIES)
def test_daemon_store_prunes_terminal_records_but_keeps_active_records(
    store_factory,
) -> None:
    with TemporaryDirectory() as root:
        store = store_factory(root)
        store.register_node(store_node_payload())
        for index in range(3):
            command = run_start_command(
                f"00000000-0000-4000-8000-00000000001{index}",
                f"00000000-0000-4000-8000-00000000002{index}",
            )
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
        active = run_start_command(
            "00000000-0000-4000-8000-000000000030",
            "00000000-0000-4000-8000-000000000031",
        )
        store.enqueue_command("sbx_alice", active)

        pruned_by_cap = store.prune_terminal_records(
            retention_seconds=365 * 24 * 60 * 60, per_node_limit=1
        )
        assert pruned_by_cap["commands"] == 2
        assert pruned_by_cap["runs"] == 2
        assert store.queued_command_count("sbx_alice") == 1
        assert [run["runId"] for run in store.list_active_runs("sbx_alice")] == [
            "00000000-0000-4000-8000-000000000031"
        ]

        pruned_by_age = store.prune_terminal_records(
            retention_seconds=0, per_node_limit=100
        )
        assert pruned_by_age["commands"] == 1
        assert pruned_by_age["runs"] == 1
        [command] = store.take_queued_commands("sbx_alice")
        assert command["id"] == "00000000-0000-4000-8000-000000000030"


@pytest.mark.parametrize("store_factory", DAEMON_STORE_FACTORIES)
def test_daemon_store_does_not_log_node_heartbeats(store_factory) -> None:
    """Heartbeats are already materialized on the node row; logging them as
    events costs one insert per daemon poll and nothing ever reads them."""
    with TemporaryDirectory() as root:
        store = store_factory(root)
        store.register_node(store_node_payload())

        for _ in range(5):
            updated = store.mark_node_seen("sbx_alice")

        assert updated["lastSeenAt"]
        assert store.get_node("sbx_alice")["lastSeenAt"] == updated["lastSeenAt"]
        assert "daemon.node.seen" not in stored_daemon_event_types(store)


@pytest.mark.parametrize("store_factory", DAEMON_STORE_FACTORIES)
def test_daemon_store_prunes_command_events_but_keeps_node_lifecycle(
    store_factory,
) -> None:
    with TemporaryDirectory() as root:
        store = store_factory(root)
        store.register_node(store_node_payload())
        command = run_start_command("cmd_done", "run_done")
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
        store.unassign_node_employee("sbx_alice")

        before = stored_daemon_event_types(store)
        assert any(event.startswith("daemon.command.") for event in before)

        pruned = store.prune_terminal_records(retention_seconds=0, per_node_limit=0)

        assert pruned["events"] > 0
        after = stored_daemon_event_types(store)
        assert not any(event.startswith("daemon.command.") for event in after)
        assert "daemon.node.registered" in after
        assert "daemon.node.unassigned" in after


def test_daemon_poll_heartbeats_are_throttled_before_reaching_the_store() -> None:
    """An idle long poll touches the registry several times per second; only a
    bounded fraction of those may reach the durable node row."""

    class CountingLocalDaemonStore(LocalDaemonStore):
        def __init__(self, root: str):
            super().__init__(root)
            self.mark_seen_calls = 0

        def mark_node_seen(self, node_id, patch=None):
            self.mark_seen_calls += 1
            return super().mark_node_seen(node_id, patch)

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
        daemon_store.mark_seen_calls = 0

        for _ in range(20):
            registry.available_command_count("sbx_alice", "node_token")

        assert daemon_store.mark_seen_calls == 1
        # This replica's own liveness view stays fresh on every poll.
        assert registry.sandboxes["sbx_alice"]["lastSeenAt"]

        # A status transition must persist immediately, throttle or not.
        registry.sandboxes["sbx_alice"] = {
            **registry.sandboxes["sbx_alice"],
            "status": "stopped",
        }
        registry.available_command_count("sbx_alice", "node_token")
        assert daemon_store.mark_seen_calls == 2
        assert registry.sandboxes["sbx_alice"]["status"] == "ready"


@pytest.mark.parametrize("node_location", ["employee-device", "managed"])
def test_explicit_heartbeat_renews_local_and_managed_node_leases(
    node_location: str,
) -> None:
    with TemporaryDirectory() as root:
        daemon_store = LocalDaemonStore(root)
        registry = DaemonNodeRegistry(
            LocalSessionStore(root), daemon_store, liveness_timeout_ms=15_000
        )
        registry.register(
            {
                "sandboxId": f"node_{node_location}",
                "employeeId": "alice",
                "token": "node_token",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            },
            authorized_node_location="employee-device",
        )
        node_id = f"node_{node_location}"
        registry.sandboxes[node_id] = {
            **registry.sandboxes[node_id],
            "nodeLocation": node_location,
            **(
                {"managedNodeId": "computer_alice"}
                if node_location == "managed"
                else {}
            ),
            "status": "stopped",
            "lastSeenAt": "2020-01-01T00:00:00.000Z",
        }

        heartbeat = registry.heartbeat(node_id, "node_token")

        assert heartbeat["intervalMs"] == 5_000
        assert heartbeat["timeoutMs"] == 15_000
        assert heartbeat["observedAt"] != "2020-01-01T00:00:00.000Z"
        assert registry.get(node_id)["status"] == "ready"
        assert registry.get(node_id)["nodeLocation"] == node_location


def test_retired_node_cannot_renew_explicit_heartbeat() -> None:
    with TemporaryDirectory() as root:
        registry = DaemonNodeRegistry(LocalSessionStore(root), LocalDaemonStore(root))
        registry.register(
            {
                "sandboxId": "node_retired",
                "employeeId": "alice",
                "token": "node_token",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            }
        )
        registry.sandboxes["node_retired"]["retiredAt"] = "2026-07-30T00:00:00.000Z"

        with pytest.raises(PermissionError, match="Retired daemon node"):
            registry.heartbeat("node_retired", "node_token")


def test_durable_heartbeat_is_visible_to_another_registry_replica() -> None:
    with TemporaryDirectory() as root:
        daemon_store = LocalDaemonStore(root)
        first = DaemonNodeRegistry(LocalSessionStore(root), daemon_store)
        first.register(
            {
                "sandboxId": "node_shared",
                "employeeId": "alice",
                "token": "node_token",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            }
        )
        second = DaemonNodeRegistry(LocalSessionStore(root), daemon_store)
        second.sandboxes["node_shared"] = {
            **second.sandboxes["node_shared"],
            "status": "stopped",
            "lastSeenAt": "2020-01-01T00:00:00.000Z",
        }

        first.heartbeat("node_shared", "node_token")
        [observed] = second.monitor_nodes()

        assert observed["online"] is True
        assert observed["stale"] is False
        assert observed["status"] == "ready"


def test_explicit_heartbeat_renews_active_command_leases() -> None:
    class LeaseTrackingStore(LocalDaemonStore):
        def __init__(self, root: str):
            super().__init__(root)
            self.renewals: list[tuple[str, list[tuple[str, str | None]], float]] = []

        def renew_command_leases(self, node_id, leases, *, lease_seconds):
            self.renewals.append((node_id, leases, lease_seconds))
            return super().renew_command_leases(
                node_id, leases, lease_seconds=lease_seconds
            )

    with TemporaryDirectory() as root:
        daemon_store = LeaseTrackingStore(root)
        registry = DaemonNodeRegistry(LocalSessionStore(root), daemon_store)
        registry.register(
            {
                "sandboxId": "node_busy",
                "employeeId": "alice",
                "token": "node_token",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "busy",
            }
        )

        registry.heartbeat("node_busy", "node_token", [("command_one", "lease_one")])

        assert daemon_store.renewals == [
            ("node_busy", [("command_one", "lease_one")], 60.0)
        ]


def test_node_monitoring_and_selection_use_grouped_store_queries() -> None:
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

        daemon_store.active_run_calls = []
        assert len(registry.list_ready()) == 2
        assert daemon_store.active_run_calls == [None]

        daemon_store.active_run_calls = []
        assert registry.find_by_employee("alice")["id"] == "sbx_alice"
        assert daemon_store.active_run_calls == [None]


def test_backend_dispatch_loads_active_runs_once_for_all_assignments() -> None:
    class CountingLocalDaemonStore(LocalDaemonStore):
        def __init__(self, root: str):
            super().__init__(root)
            self.active_run_calls: list[str | None] = []

        def list_active_runs(
            self, node_id: str | None = None
        ) -> list[dict[str, object]]:
            self.active_run_calls.append(node_id)
            return super().list_active_runs(node_id)

    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            daemon_store = CountingLocalDaemonStore(root)
            registry = DaemonNodeRegistry(LocalSessionStore(root), daemon_store)
            registry.register(
                {
                    "sandboxId": "sbx_alice",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["claude", "codex", "pi"],
                    "status": "ready",
                },
                "ui_token",
            )
            daemon_store.active_run_calls = []

            await ServerDaemonNodeBackend(registry).run(
                "sbx_alice",
                {
                    "taskGoal": "dispatch a pipeline",
                    "assignments": [
                        {"agent": "claude", "mode": "action"},
                        {"agent": "codex", "mode": "review"},
                        {"agent": "pi", "mode": "action"},
                    ],
                },
            )

            assert daemon_store.active_run_calls == [None]

    asyncio.run(run_flow())


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
                "id": "00000000-0000-4000-8000-000000000040",
                "type": "run.start",
                "sessionId": "ses_1",
                "runId": "00000000-0000-4000-8000-000000000041",
                "agent": "codex",
                "mode": "action",
                "taskGoal": "fix auth",
            },
        )

        [first] = store.take_queued_commands("sbx_alice", lease_seconds=0.05)
        assert first["id"] == "00000000-0000-4000-8000-000000000040"
        assert first["status"] == "dispatched"
        assert first["attempt"] == 1
        assert first["leaseId"].startswith("lease_")
        assert first["leaseExpiresAt"]
        assert store.take_queued_commands("sbx_alice") == []

        time.sleep(0.08)

        [second] = store.take_queued_commands("sbx_alice", lease_seconds=0.05)
        assert second["id"] == "00000000-0000-4000-8000-000000000040"
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
                "id": "00000000-0000-4000-8000-000000000050",
                "type": "run.cancel",
                "commandId": "00000000-0000-4000-8000-000000000051",
                "sessionId": "ses_1",
                "runId": "00000000-0000-4000-8000-000000000052",
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
        store.mark_cancel_commands_completed(
            "sbx_alice", "00000000-0000-4000-8000-000000000051"
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
                "id": "00000000-0000-4000-8000-000000000060",
                "type": "run.start",
                "sessionId": "ses_1",
                "runId": "00000000-0000-4000-8000-000000000061",
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
                "id": "00000000-0000-4000-8000-000000000070",
                "type": "run.start",
                "sessionId": "ses_1",
                "runId": "00000000-0000-4000-8000-000000000071",
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


def test_effective_agent_roles_use_only_explicit_or_configured_roles() -> None:
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
    assert effective_role_for_assignment(node, {"agent": "codex"}, "review") == "tester"
    assert effective_role_for_assignment({}, {"agent": "pi"}, "action") is None


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


@pytest.mark.parametrize("store_factory", DAEMON_STORE_FACTORIES)
def test_reregistering_a_computer_retires_the_previous_daemon_incarnation(
    store_factory,
) -> None:
    """A Computer is (employeeId, workspaceId), not a daemon process id.

    A daemon that restarts with a fresh sandboxId used to leave its previous row
    behind as a live node, which is how stale duplicates -- and duplicate
    compatibility agents -- accumulated.
    """
    with TemporaryDirectory() as root:
        registry = DaemonNodeRegistry(LocalSessionStore(root), store_factory(root))
        for sandbox_id in ("sbx_first", "sbx_second"):
            registry.register(
                {
                    "sandboxId": sandbox_id,
                    "employeeId": "alice",
                    "token": f"token_{sandbox_id}",
                    "workspaceId": "mch_alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                f"ui_{sandbox_id}",
            )

        first = registry.get("sbx_first")
        second = registry.get("sbx_second")
        assert first["retiredAt"]
        assert first["status"] == "stopped"
        assert not second.get("retiredAt")
        assert second["status"] == "ready"


@pytest.mark.parametrize("store_factory", DAEMON_STORE_FACTORIES)
def test_reregistering_a_computer_keeps_other_computers_live(store_factory) -> None:
    with TemporaryDirectory() as root:
        registry = DaemonNodeRegistry(LocalSessionStore(root), store_factory(root))
        for sandbox_id, workspace_id, employee in (
            ("sbx_laptop", "mch_laptop", "alice"),
            ("sbx_desktop", "mch_desktop", "alice"),
            ("sbx_bob", "mch_laptop", "bob"),
        ):
            registry.register(
                {
                    "sandboxId": sandbox_id,
                    "employeeId": employee,
                    "token": f"token_{sandbox_id}",
                    "workspaceId": workspace_id,
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                f"ui_{sandbox_id}",
            )

        # Different workspace, and same workspace under a different employee,
        # are different Computers.
        assert not registry.get("sbx_laptop").get("retiredAt")
        assert not registry.get("sbx_desktop").get("retiredAt")
        assert not registry.get("sbx_bob").get("retiredAt")


@pytest.mark.parametrize("store_factory", DAEMON_STORE_FACTORIES)
def test_reregistering_the_same_daemon_does_not_retire_itself(store_factory) -> None:
    with TemporaryDirectory() as root:
        registry = DaemonNodeRegistry(LocalSessionStore(root), store_factory(root))
        payload = {
            "sandboxId": "sbx_alice",
            "employeeId": "alice",
            "token": "node_token",
            "workspaceId": "mch_alice",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "status": "ready",
        }
        registry.register(dict(payload), "ui_token")
        registry.register(dict(payload), "ui_token")

        node = registry.get("sbx_alice")
        assert not node.get("retiredAt")
        assert node["status"] == "ready"


def test_idempotent_run_request_id_is_a_uuid() -> None:
    """``daemon_run_requests.id`` is a native uuid column, so this must be one.

    A non-uuid id is rejected with InvalidTextRepresentation on every lookup
    and insert, so the dispatch fails and no thread is ever created. Asserted
    on the value itself: a store round-trip would only prove whatever the
    store under test happens to accept.
    """
    from relay.daemon_registry.node_backend import _idempotent_run_request_id

    derived = _idempotent_run_request_id("claim_ms64xmg1_j1r8cs")

    assert str(UUID(derived)) == derived
    assert derived == _idempotent_run_request_id("claim_ms64xmg1_j1r8cs")
    assert derived != _idempotent_run_request_id("claim_other")


def test_node_agent_maps_round_trip_through_the_child_table() -> None:
    """The five per-agent maps are stored as daemon_node_agents rows but must
    come back on the node dict exactly as they went in, including staying absent
    when empty."""
    with TemporaryDirectory() as root:
        store = database_daemon_store(root)
        store.register_node(
            {
                "id": "sbx_alice",
                "employeeId": "alice",
                "status": "ready",
                "agents": {"claude": "ready", "codex": "missing"},
                "agentDetails": {"claude": {"adapter": "cli"}},
                "disabledAgents": ["codex"],
                "agentRoleDefaults": {"claude": "planner"},
                "agentRoleOverrides": {"codex": "reviewer"},
                "createdAt": "2026-07-30T00:00:00.000Z",
                "updatedAt": "2026-07-30T00:00:00.000Z",
            }
        )

        node = store.get_node("sbx_alice")

        assert node["agents"] == {"claude": "ready", "codex": "missing"}
        assert node["agentDetails"] == {"claude": {"adapter": "cli"}}
        assert node["disabledAgents"] == ["codex"]
        assert node["agentRoleDefaults"] == {"claude": "planner"}
        assert node["agentRoleOverrides"] == {"codex": "reviewer"}
        assert store.list_nodes() == [node]


def test_node_agent_maps_stay_absent_when_empty() -> None:
    with TemporaryDirectory() as root:
        store = database_daemon_store(root)
        store.register_node(
            {
                "id": "sbx_bare",
                "status": "ready",
                "agents": {"claude": "ready"},
                "createdAt": "2026-07-30T00:00:00.000Z",
                "updatedAt": "2026-07-30T00:00:00.000Z",
            }
        )

        node = store.get_node("sbx_bare")

        assert node["agents"] == {"claude": "ready"}
        for key in (
            "agentDetails",
            "disabledAgents",
            "agentRoleDefaults",
            "agentRoleOverrides",
        ):
            assert key not in node


def test_rewriting_a_node_drops_agents_no_longer_reported() -> None:
    with TemporaryDirectory() as root:
        store = database_daemon_store(root)
        base = {
            "id": "sbx_alice",
            "status": "ready",
            "createdAt": "2026-07-30T00:00:00.000Z",
            "updatedAt": "2026-07-30T00:00:00.000Z",
        }
        store.register_node({**base, "agents": {"claude": "ready", "codex": "ready"}})
        store.register_node({**base, "agents": {"claude": "ready"}})

        assert store.get_node("sbx_alice")["agents"] == {"claude": "ready"}


def test_deleting_a_node_removes_its_agent_rows() -> None:
    with TemporaryDirectory() as root:
        store = database_daemon_store(root)
        store.register_node(
            {
                "id": "sbx_alice",
                "status": "ready",
                "agents": {"claude": "ready"},
                "createdAt": "2026-07-30T00:00:00.000Z",
                "updatedAt": "2026-07-30T00:00:00.000Z",
            }
        )

        store.delete_node("sbx_alice")

        with store.engine.begin() as conn:
            remaining = conn.execute(select(store.node_agents)).mappings().all()
        assert remaining == []


def node_agent_write_counter(store) -> list[str]:
    """Record every INSERT/DELETE aimed at daemon_node_agents."""
    writes: list[str] = []

    @event.listens_for(store.engine, "before_cursor_execute")
    def _record(conn, cursor, statement, parameters, context, executemany):
        collapsed = " ".join(statement.split()).upper()
        if "DAEMON_NODE_AGENTS" in collapsed and collapsed.startswith(
            ("INSERT", "DELETE")
        ):
            writes.append(collapsed.split()[0])

    return writes


def test_heartbeats_do_not_rewrite_unchanged_agent_rows() -> None:
    """`mark_node_seen` runs several times per second per node. It must not churn
    the child table when the node reports the same agents as last time."""
    with TemporaryDirectory() as root:
        store = database_daemon_store(root)
        store.register_node(
            {
                "id": "sbx_alice",
                "status": "ready",
                "agents": {"claude": "ready", "codex": "ready"},
                "agentDetails": {"claude": {"adapter": "cli"}},
                "createdAt": "2026-07-30T00:00:00.000Z",
                "updatedAt": "2026-07-30T00:00:00.000Z",
            }
        )

        writes = node_agent_write_counter(store)
        for _ in range(5):
            store.mark_node_seen("sbx_alice", {"status": "ready"})

        assert writes == []
        assert store.get_node("sbx_alice")["agents"] == {
            "claude": "ready",
            "codex": "ready",
        }


def test_heartbeat_that_changes_agents_does_rewrite() -> None:
    with TemporaryDirectory() as root:
        store = database_daemon_store(root)
        store.register_node(
            {
                "id": "sbx_alice",
                "status": "ready",
                "agents": {"claude": "ready"},
                "createdAt": "2026-07-30T00:00:00.000Z",
                "updatedAt": "2026-07-30T00:00:00.000Z",
            }
        )

        writes = node_agent_write_counter(store)
        store.mark_node_seen("sbx_alice", {"agents": {"claude": "missing"}})

        assert writes == ["DELETE", "INSERT"]
        assert store.get_node("sbx_alice")["agents"] == {"claude": "missing"}


def test_repeat_registrations_do_not_grow_the_event_log() -> None:
    """Daemons re-register on a heartbeat (every 5 minutes by default), and node
    events are deliberately never pruned. Appending one per heartbeat grows
    daemon_events without bound and adds nothing: the only consumer,
    `_managed_runtime_identity_map`, folds them into a dict where repeats of an
    unchanged payload are discarded."""
    with TemporaryDirectory() as root:
        store = database_daemon_store(root)
        payload = {
            "id": "sbx_alice",
            "employeeId": "alice",
            "status": "ready",
            "agents": {"claude": "ready"},
            "nodeTokenHash": "sha256:hash",
            "createdAt": "2026-07-30T00:00:00.000Z",
            "updatedAt": "2026-07-30T00:00:00.000Z",
        }
        for beat in range(5):
            store.register_node(
                {**payload, "lastSeenAt": f"2026-07-30T00:0{beat}:00.000Z"}
            )

        events = stored_daemon_event_types(store)

        assert events.count("daemon.node.registered") == 1


def test_a_materially_changed_registration_is_still_recorded() -> None:
    with TemporaryDirectory() as root:
        store = database_daemon_store(root)
        payload = {
            "id": "sbx_alice",
            "status": "ready",
            "agents": {"claude": "ready"},
            "createdAt": "2026-07-30T00:00:00.000Z",
            "updatedAt": "2026-07-30T00:00:00.000Z",
        }
        store.register_node(dict(payload))
        store.register_node(
            {**payload, "agents": {"claude": "ready", "codex": "ready"}}
        )
        store.register_node({**payload, "employeeId": "alice"})

        events = stored_daemon_event_types(store)

        assert events.count("daemon.node.registered") == 3


def test_managed_runtime_identity_survives_deduplicated_registrations() -> None:
    """The event log is the only record of a node incarnation once `delete_node`
    hard-deletes the row, so deduplicating must not lose the managed linkage."""
    with TemporaryDirectory() as root:
        store = database_daemon_store(root)
        payload = {
            "id": "runtime_alice",
            "managedNodeId": "computer_alice",
            "status": "ready",
            "agents": {"claude": "ready"},
            "createdAt": "2026-07-30T00:00:00.000Z",
            "updatedAt": "2026-07-30T00:00:00.000Z",
        }
        for _ in range(4):
            store.register_node(dict(payload))
        store.delete_node("runtime_alice")

        assert store.historical_managed_node_id("runtime_alice") == "computer_alice"


def test_dead_heartbeat_events_are_prunable() -> None:
    """`daemon.node.seen` was emitted per heartbeat by a since-removed path and
    nothing reads it, but it fell outside the prunable prefix, so it accumulated
    permanently. It must age out on the retention cutoff."""
    with TemporaryDirectory() as root:
        store = database_daemon_store(root)
        store.register_node(
            {
                "id": "sbx_alice",
                "status": "ready",
                "agents": {"claude": "ready"},
                "createdAt": "2026-07-30T00:00:00.000Z",
                "updatedAt": "2026-07-30T00:00:00.000Z",
            }
        )
        store.append_daemon_event(
            {
                "id": new_database_id(),
                "type": "daemon.node.seen",
                "nodeId": "sbx_alice",
                "timestamp": "2026-07-30T00:00:00.000Z",
            }
        )

        store.prune_terminal_records(retention_seconds=0, per_node_limit=0)

        remaining = stored_daemon_event_types(store)
        assert "daemon.node.seen" not in remaining
        # The registration record is what survives a hard node delete, so it stays.
        assert "daemon.node.registered" in remaining
