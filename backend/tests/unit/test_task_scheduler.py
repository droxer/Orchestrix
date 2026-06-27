from __future__ import annotations

import asyncio
from datetime import date
from tempfile import TemporaryDirectory

from relay.daemon_registry import DaemonNodeRegistry, ServerDaemonNodeBackend
from relay.persistence.daemon_store import LocalDaemonStore
from relay.persistence.session_store import LocalSessionStore
from relay.persistence.task_store import LocalTaskStore
from relay.tasks import TaskScheduler, next_routine_date


def test_scheduler_dispatches_assigned_task_to_ready_node() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            task_store = LocalTaskStore(root)
            registry = DaemonNodeRegistry(session_store, LocalDaemonStore(root), task_store=task_store)
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
            task = task_store.create_task({
                "title": "Ship scheduled backlog",
                "description": "Run automatically.",
                "assignedAgent": "codex",
                "assigneeEmployeeId": "alice",
                "status": "assigned",
            })
            scheduler = TaskScheduler(task_store=task_store, registry=registry, backend=backend)

            result = await scheduler.tick()

            assert result.dispatched == 1
            updated = task_store.get_task(task["id"])
            assert updated["status"] == "running"
            assert updated["linkedSessionIds"]
            [command] = registry.take_commands("sbx_alice", "node_token")
            assert command["type"] == "run.start"
            assert command["agent"] == "codex"
            assert command["taskGoal"] == "Ship scheduled backlog\n\nRun automatically."

    asyncio.run(run_flow())


def test_scheduler_promotes_due_routine_and_advances_next_run() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            task_store = LocalTaskStore(root)
            registry = DaemonNodeRegistry(session_store, LocalDaemonStore(root), task_store=task_store)
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
            routine = task_store.create_task({
                "title": "Weekly report",
                "description": "Prepare the weekly status.",
                "priority": "high",
                "assignedAgent": "codex",
                "ownerEmployeeId": "alice",
                "assigneeEmployeeId": "alice",
                "isRoutine": True,
                "routineType": "job",
                "routineCadence": "weekly",
                "routineNextRunDate": "2026-06-25",
                "routineEnabled": True,
            })
            scheduler = TaskScheduler(
                task_store=task_store,
                registry=registry,
                backend=backend,
                today=lambda: date(2026, 6, 25),
            )

            result = await scheduler.tick()

            assert result.promoted == 1
            assert result.dispatched == 1
            updated_routine = task_store.get_task(routine["id"])
            assert updated_routine["routineNextRunDate"] == "2026-07-02"
            occurrences = [task for task in task_store.list_tasks() if task["id"] != routine["id"]]
            assert len(occurrences) == 1
            occurrence = occurrences[0]
            assert occurrence["title"] == "Weekly report"
            assert occurrence["priority"] == "high"
            assert occurrence["dueDate"] == "2026-06-25"
            assert occurrence["isRoutine"] is False
            assert occurrence["status"] == "running"
            assert occurrence["linkedSessionIds"]

    asyncio.run(run_flow())


def test_next_routine_date_skips_past_missed_windows_and_handles_custom() -> None:
    assert next_routine_date(date(2026, 6, 1), "daily", date(2026, 6, 25)) == date(2026, 6, 26)
    assert next_routine_date(date(2026, 1, 31), "monthly", date(2026, 2, 1)) == date(2026, 2, 28)
    assert next_routine_date(date(2026, 6, 25), "custom", date(2026, 6, 25)) is None
