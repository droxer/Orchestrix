from __future__ import annotations

import asyncio
from datetime import date
from tempfile import TemporaryDirectory

from relay.daemon_registry import DaemonNodeRegistry, ServerDaemonNodeBackend
from relay.persistence.daemon_store import LocalDaemonStore
from relay.persistence.session_store import LocalSessionStore
from relay.persistence.task_store import LocalTaskStore
from relay.persistence.employee_agent_store import LocalEmployeeAgentStore
from relay.persistence.agent_placement_store import LocalAgentPlacementStore
from relay.services.managed_nodes import LocalManagedNodeStore
from relay.tasks import ROUTINE_SKIP_NO_AGENT_MESSAGE, TaskScheduler, next_routine_date


def test_scheduler_dispatches_assigned_task_to_ready_node() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            task_store = LocalTaskStore(root)
            registry = DaemonNodeRegistry(
                session_store, LocalDaemonStore(root), task_store=task_store
            )
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
            task = task_store.create_task(
                {
                    "title": "Ship scheduled backlog",
                    "description": "Run automatically.",
                    "assignedAgent": "codex",
                    "assigneeEmployeeId": "alice",
                    "status": "assigned",
                }
            )
            scheduler = TaskScheduler(
                task_store=task_store, registry=registry, backend=backend
            )

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


def test_scheduler_requests_managed_capacity_once_when_no_node_is_ready() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            task_store = LocalTaskStore(root)
            registry = DaemonNodeRegistry(
                LocalSessionStore(root), LocalDaemonStore(root), task_store=task_store
            )
            managed_nodes = LocalManagedNodeStore(root)
            task_store.create_task(
                {
                    "title": "Needs managed capacity",
                    "assignedAgent": "codex",
                    "assigneeEmployeeId": "alice",
                    "status": "assigned",
                }
            )
            scheduler = TaskScheduler(
                task_store=task_store,
                registry=registry,
                backend=ServerDaemonNodeBackend(registry),
                managed_node_store=managed_nodes,
            )

            first = await scheduler.tick()
            second = await scheduler.tick()

            assert first.dispatched == 0
            assert first.skipped == 1
            assert second.dispatched == 0
            assert len(managed_nodes.list_nodes()) == 1
            [node] = managed_nodes.list_nodes()
            assert node["employeeId"] == "alice"
            assert node["desiredState"] == "running"

    asyncio.run(run_flow())


def test_scheduler_waits_for_an_employee_local_node_instead_of_provisioning_managed() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            task_store = LocalTaskStore(root)
            registry = DaemonNodeRegistry(
                LocalSessionStore(root), LocalDaemonStore(root), task_store=task_store
            )
            registry.provision_pending(
                "alice", "/Users/alice/workspace", sandbox_mode="none"
            )
            managed_nodes = LocalManagedNodeStore(root)
            task_store.create_task(
                {
                    "title": "Wait for Alice's computer",
                    "assignedAgent": "codex",
                    "assigneeEmployeeId": "alice",
                    "status": "assigned",
                }
            )

            await TaskScheduler(
                task_store=task_store,
                registry=registry,
                backend=ServerDaemonNodeBackend(registry),
                managed_node_store=managed_nodes,
            ).tick()

            assert managed_nodes.list_nodes() == []

    asyncio.run(run_flow())


def test_scheduler_dispatches_task_by_logical_agent_placement() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            task_store = LocalTaskStore(root)
            agent_store = LocalEmployeeAgentStore(root)
            placement_store = LocalAgentPlacementStore(root)
            registry = DaemonNodeRegistry(
                session_store, LocalDaemonStore(root), task_store=task_store
            )
            backend = ServerDaemonNodeBackend(
                registry,
                employee_agent_store=agent_store,
                agent_placement_store=placement_store,
            )
            registry.register(
                {
                    "sandboxId": "node_builder",
                    "employeeId": "alice",
                    "token": "node_token",
                    "workspacePath": "/workspace/alice",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                "ui_token",
            )
            agent = agent_store.create_agent(
                "alice", {"displayName": "Builder", "executorKind": "codex"}
            )
            placement_store.create_placement(agent, "node_builder")
            task = task_store.create_task(
                {
                    "title": "Ship with Builder",
                    "assignedAgent": "codex",
                    "assignedAgentId": agent["id"],
                    "assigneeEmployeeId": "alice",
                    "status": "assigned",
                }
            )

            result = await TaskScheduler(
                task_store=task_store, registry=registry, backend=backend
            ).tick()

            assert result.dispatched == 1
            [command] = registry.take_commands("node_builder", "node_token")
            assert command["logicalAgentId"] == agent["id"]
            assert task_store.get_task(task["id"])["assignedAgentId"] == agent["id"]

    asyncio.run(run_flow())


def test_scheduler_promotes_due_routine_and_advances_next_run() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            task_store = LocalTaskStore(root)
            registry = DaemonNodeRegistry(
                session_store, LocalDaemonStore(root), task_store=task_store
            )
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
            routine = task_store.create_task(
                {
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
                }
            )
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
            occurrences = [
                task for task in task_store.list_tasks() if task["id"] != routine["id"]
            ]
            assert len(occurrences) == 1
            occurrence = occurrences[0]
            assert occurrence["title"] == "Weekly report"
            assert occurrence["priority"] == "high"
            assert occurrence["dueDate"] == "2026-06-25"
            assert occurrence["isRoutine"] is False
            assert occurrence["status"] == "running"
            assert occurrence["linkedSessionIds"]

    asyncio.run(run_flow())


def test_scheduler_dispatches_by_priority_not_recency() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            task_store = LocalTaskStore(root)
            registry = DaemonNodeRegistry(
                session_store, LocalDaemonStore(root), task_store=task_store
            )
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
            high = task_store.create_task(
                {
                    "title": "Older high priority",
                    "priority": "high",
                    "assignedAgent": "codex",
                    "assigneeEmployeeId": "alice",
                    "status": "assigned",
                }
            )
            low = task_store.create_task(
                {
                    "title": "Newer low priority",
                    "priority": "low",
                    "assignedAgent": "codex",
                    "assigneeEmployeeId": "alice",
                    "status": "assigned",
                }
            )
            scheduler = TaskScheduler(
                task_store=task_store, registry=registry, backend=backend
            )

            result = await scheduler.tick()

            # The node has one exclusive slot, so only the high-priority task
            # runs even though the low-priority one was touched more recently.
            assert result.dispatched == 1
            assert task_store.get_task(high["id"])["status"] == "running"
            assert task_store.get_task(low["id"])["status"] == "assigned"

    asyncio.run(run_flow())


def test_scheduler_records_skip_activity_once_for_agentless_due_routine() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            task_store = LocalTaskStore(root)
            registry = DaemonNodeRegistry(
                session_store, LocalDaemonStore(root), task_store=task_store
            )
            backend = ServerDaemonNodeBackend(registry)
            routine = task_store.create_task(
                {
                    "title": "Agentless routine",
                    "assigneeEmployeeId": "alice",
                    "isRoutine": True,
                    "routineCadence": "weekly",
                    "routineNextRunDate": "2026-06-25",
                    "routineEnabled": True,
                }
            )
            scheduler = TaskScheduler(
                task_store=task_store,
                registry=registry,
                backend=backend,
                today=lambda: date(2026, 6, 25),
            )

            first = await scheduler.tick()
            second = await scheduler.tick()

            assert first.promoted == 0
            assert first.skipped == 1
            assert second.skipped == 1
            skips = [
                activity
                for activity in task_store.get_task(routine["id"])["activity"]
                if activity["message"] == ROUTINE_SKIP_NO_AGENT_MESSAGE
            ]
            assert len(skips) == 1

    asyncio.run(run_flow())


def test_scheduler_backs_off_after_failed_dispatch() -> None:
    class FailingBackend:
        def __init__(self) -> None:
            self.calls = 0

        async def run(self, node_id: str, request: dict) -> dict:
            self.calls += 1
            raise ValueError("dispatch rejected")

    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            task_store = LocalTaskStore(root)
            registry = DaemonNodeRegistry(
                session_store, LocalDaemonStore(root), task_store=task_store
            )
            backend = FailingBackend()
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
            task = task_store.create_task(
                {
                    "title": "Keeps failing",
                    "assignedAgent": "codex",
                    "assigneeEmployeeId": "alice",
                    "status": "assigned",
                }
            )
            scheduler = TaskScheduler(
                task_store=task_store, registry=registry, backend=backend
            )

            first = await scheduler.tick()
            second = await scheduler.tick()

            assert first.dispatched == 0
            assert backend.calls == 1
            # The failed task is back in the queue but skipped until its
            # backoff window elapses, so the immediate retick does not re-run.
            assert task_store.get_task(task["id"])["status"] == "assigned"
            assert second.dispatched == 0
            assert second.skipped == 1
            assert backend.calls == 1

    asyncio.run(run_flow())


def test_scheduler_uses_targeted_task_queue_queries() -> None:
    class QueryOnlyTaskStore:
        def __init__(self) -> None:
            self.due_queries = 0
            self.dispatch_queries = 0

        def list_due_routines(self, today: str) -> list[dict]:
            self.due_queries += 1
            return []

        def list_dispatchable_tasks(self) -> list[dict]:
            self.dispatch_queries += 1
            return []

        def list_tasks(self) -> list[dict]:
            raise AssertionError("scheduler should use targeted queue queries")

    async def run_flow() -> None:
        store = QueryOnlyTaskStore()
        scheduler = TaskScheduler(
            task_store=store,
            registry=object(),
            backend=object(),
            today=lambda: date(2026, 6, 25),
        )

        result = await scheduler.tick()

        assert result.promoted == 0
        assert result.dispatched == 0
        assert result.skipped == 0
        assert store.due_queries == 1
        assert store.dispatch_queries == 1

    asyncio.run(run_flow())


def test_next_routine_date_skips_past_missed_windows_and_handles_custom() -> None:
    assert next_routine_date(date(2026, 6, 1), "daily", date(2026, 6, 25)) == date(
        2026, 6, 26
    )
    assert next_routine_date(date(2026, 1, 31), "monthly", date(2026, 2, 1)) == date(
        2026, 2, 28
    )
    assert next_routine_date(date(2026, 6, 25), "custom", date(2026, 6, 25)) is None
