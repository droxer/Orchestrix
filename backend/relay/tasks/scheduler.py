from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Callable

from loguru import logger

from ..core.models import AgentName
from ..daemon_registry import node_accepts_run
from ..persistence.agent_placement_store import create_node_placement
from ..persistence.stores import valid_agent
from ..persistence.task_store import routine_due_sort_key, task_claim_sort_key
from ..services.agent_routing import (
    AgentRoutingError,
    dispatch_failure_code,
    dispatch_reason_code,
    resolve_agent_assignments,
)
from ..services.team_dispatch import (
    TEAM_UNAVAILABLE_MESSAGE,
    TeamDispatchError,
    resolve_team_task_assignments,
    task_execution_employee_id,
)

MAX_DISPATCH_BACKOFF_SECONDS = 3600.0
PERMANENT_DISPATCH_CODES = {
    "agent_disabled",
    "agent_forbidden",
    "agent_not_found",
    "agent_policy_unsupported",
    "executor_mismatch",
}

ROUTINE_SKIP_NO_AGENT_MESSAGE = (
    "Routine skipped: no assigned agent. Assign an agent so the scheduler can run it."
)


def task_goal_text(task: dict[str, Any]) -> str:
    return (
        f"{task['title']}\n\n{task['description']}"
        if task.get("description")
        else task["title"]
    )


def materialize_legacy_agent_assignment(
    task: dict[str, Any],
    executor_kind: str,
    *,
    registry: Any,
    agent_store: Any,
    placement_store: Any,
) -> dict[str, Any] | None:
    employee_id = task_execution_employee_id(task)
    if not employee_id:
        return None
    assignment = {"agent": executor_kind, "mode": "action"}
    node = ready_node_for_task(registry, task, [assignment])
    if not node:
        return None
    agent = agent_store.ensure_compatibility_agent(
        employee_id,
        executor_kind,
        node["id"],
        computer_id=node.get("managedNodeId") or node["id"],
    )
    placement = next(
        (
            item
            for item in placement_store.list_placements(agent_id=agent["id"])
            if item["daemonNodeId"] == node["id"]
        ),
        None,
    )
    if placement is None:
        create_node_placement(placement_store, agent, node)
    return {"agent": executor_kind, "agentId": agent["id"]}


def materialize_legacy_task_assignment(
    task: dict[str, Any],
    *,
    task_store: Any,
    registry: Any,
    agent_store: Any,
    placement_store: Any,
) -> dict[str, Any] | None:
    executor_kind = valid_agent(task.get("assignedAgent"))
    if not executor_kind or task.get("assignedAgentId"):
        return None
    assignment = materialize_legacy_agent_assignment(
        task,
        executor_kind,
        registry=registry,
        agent_store=agent_store,
        placement_store=placement_store,
    )
    if not assignment:
        return None
    return task_store.set_task_assignment(
        task["id"], executor_kind, assignment["agentId"]
    )


@dataclass(frozen=True)
class SchedulerTickResult:
    promoted: int = 0
    dispatched: int = 0
    skipped: int = 0


class TaskScheduler:
    def __init__(
        self,
        *,
        task_store: Any,
        registry: Any,
        backend: Any,
        team_store: Any | None = None,
        managed_node_store: Any | None = None,
        interval_seconds: float = 10.0,
        max_dispatches_per_tick: int = 5,
        today: Callable[[], date] = date.today,
    ) -> None:
        self.task_store = task_store
        self.registry = registry
        self.backend = backend
        self.team_store = team_store
        self.managed_node_store = managed_node_store
        self.interval_seconds = interval_seconds
        self.max_dispatches_per_tick = max_dispatches_per_tick
        self._today = today
        self._loop_task: asyncio.Task[None] | None = None
        self._tick_lock = asyncio.Lock()
        # task id → (consecutive failures, monotonic time before which dispatch is skipped)
        self._dispatch_backoff: dict[str, tuple[int, float]] = {}

    def start(self) -> None:
        if self._loop_task and not self._loop_task.done():
            return
        self._loop_task = asyncio.create_task(
            self._run_loop(), name="relay-task-scheduler"
        )
        logger.info("Task scheduler started", interval_seconds=self.interval_seconds)

    async def stop(self) -> None:
        if not self._loop_task:
            return
        self._loop_task.cancel()
        try:
            await self._loop_task
        except asyncio.CancelledError:
            pass
        self._loop_task = None
        logger.info("Task scheduler stopped")

    async def tick(self) -> SchedulerTickResult:
        async with self._tick_lock:
            today = self._today()
            promoted, promote_skipped = self._promote_due_routines(today)
            dispatched, dispatch_skipped = await self._dispatch_assigned_tasks()
            return SchedulerTickResult(
                promoted=promoted,
                dispatched=dispatched,
                skipped=promote_skipped + dispatch_skipped,
            )

    async def _run_loop(self) -> None:
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Task scheduler tick failed")
            await asyncio.sleep(self.interval_seconds)

    def _promote_due_routines(self, today: date) -> tuple[int, int]:
        promoted = 0
        skipped = 0
        for routine in self._due_routines(today):
            routine = self._materialize_legacy_assignment(routine) or routine
            agent = valid_agent(routine.get("assignedAgent"))
            if not (
                (agent and routine.get("assignedAgentId"))
                or routine.get("assignedTeamId")
            ):
                skipped += 1
                self._record_routine_skip(routine)
                continue
            run_date = (
                date.fromisoformat(routine["routineNextRunDate"])
                if routine.get("routineNextRunDate")
                else today
            )
            next_run = next_routine_date(
                run_date, routine.get("routineCadence") or "weekly", today
            )
            occurrence = self.task_store.promote_due_routine(
                routine["id"],
                today.isoformat(),
                next_run.isoformat() if next_run else None,
            )
            if occurrence:
                promoted += 1
        return promoted, skipped

    def _record_routine_skip(self, routine: dict[str, Any]) -> None:
        activities = routine.get("activity") or []
        if (
            activities
            and activities[-1].get("message") == ROUTINE_SKIP_NO_AGENT_MESSAGE
        ):
            return
        self.task_store.record_activity(routine["id"], ROUTINE_SKIP_NO_AGENT_MESSAGE)
        logger.warning("Due routine skipped: no assigned agent", task_id=routine["id"])

    async def _dispatch_assigned_tasks(self) -> tuple[int, int]:
        dispatched = 0
        dispatchable = [
            self._materialize_legacy_assignment(task) or task
            for task in self._dispatchable_tasks()
        ]
        legacy = [
            task
            for task in dispatchable
            if valid_agent(task.get("assignedAgent")) and not task.get("assignedAgentId")
            and not task.get("assignedTeamId")
        ]
        for task in legacy:
            self._record_dispatch_deferred(
                task,
                "agent_not_found",
                "Select a named agent before this task can be dispatched.",
            )
        skipped = len(legacy)
        attempts = 0
        now = time.monotonic()
        candidates = [
            task
            for task in dispatchable
            if (
                valid_agent(task.get("assignedAgent"))
                and task.get("assignedAgentId")
            )
            or bool(task.get("assignedTeamId"))
        ]
        candidate_ids = {task["id"] for task in candidates}
        self._dispatch_backoff = {
            task_id: entry
            for task_id, entry in self._dispatch_backoff.items()
            if task_id in candidate_ids
        }
        for task in candidates:
            if attempts >= self.max_dispatches_per_tick:
                break
            if self._backoff_active(task["id"], now):
                skipped += 1
                continue
            team_id = task.get("assignedTeamId")
            agent = valid_agent(task.get("assignedAgent"))
            assignments: list[dict[str, Any]]
            try:
                employee_id = task_execution_employee_id(task)
                daemon_nodes = self.registry.monitor_nodes()
                if team_id:
                    assignments = resolve_team_task_assignments(
                        task,
                        team_store=self.team_store,
                        agent_store=self.backend.agent_store,
                        placement_store=self.backend.agent_placement_store,
                        daemon_nodes=daemon_nodes,
                    )
                    agent = assignments[0]["agent"]
                else:
                    assignments = [
                        {
                            "agent": agent,
                            "mode": "action",
                            "agentId": task["assignedAgentId"],
                        }
                    ]
                    assignments = resolve_agent_assignments(
                        assignments,
                        employee_id=employee_id,
                        is_admin=False,
                        agent_store=self.backend.agent_store,
                        placement_store=self.backend.agent_placement_store,
                        daemon_nodes=daemon_nodes,
                    )
                node = self.registry.get(assignments[0]["daemonNodeId"])
            except TeamDispatchError:
                self._record_dispatch_deferred(
                    task,
                    "team_unavailable",
                    TEAM_UNAVAILABLE_MESSAGE,
                )
                skipped += 1
                continue
            except AgentRoutingError as error:
                state = (
                    "rejected" if error.code in PERMANENT_DISPATCH_CODES else "queued"
                )
                self._record_dispatch_deferred(
                    task, dispatch_reason_code(error.code), str(error), state=state
                )
                if error.code in PERMANENT_DISPATCH_CODES:
                    skipped += 1
                    continue
                node = None
            if not node:
                self._ensure_managed_capacity(task)
                skipped += 1
                continue
            claimed = self.task_store.claim_task_for_dispatch(task["id"], agent)
            if not claimed:
                skipped += 1
                continue
            attempts += 1
            if await self._dispatch_claimed_task(
                claimed, agent, node["id"], assignments, team_id=team_id
            ):
                dispatched += 1
                self._dispatch_backoff.pop(task["id"], None)
            else:
                self._register_dispatch_failure(task["id"])
        return dispatched, skipped

    def _materialize_legacy_assignment(
        self, task: dict[str, Any]
    ) -> dict[str, Any] | None:
        return materialize_legacy_task_assignment(
            task,
            task_store=self.task_store,
            registry=self.registry,
            agent_store=self.backend.agent_store,
            placement_store=self.backend.agent_placement_store,
        )

    def _record_dispatch_deferred(
        self,
        task: dict[str, Any],
        code: str,
        message: str,
        *,
        state: str = "queued",
    ) -> None:
        current = task.get("dispatchOutcome") or {}
        if current.get("state") == state and current.get("code") == code:
            return
        self.task_store.record_dispatch_outcome(
            task["id"], state, code=code, message=message
        )

    def _ensure_managed_capacity(self, task: dict[str, Any]) -> None:
        capacity = ensure_managed_capacity_for_task(
            task, self.registry, self.managed_node_store
        )
        if capacity and capacity.provisioning_requested:
            logger.info(
                "Managed node provisioning requested for queued task",
                task_id=task["id"],
                employee_id=(
                    task.get("assigneeEmployeeId") or task.get("ownerEmployeeId")
                ),
            )

    async def _dispatch_claimed_task(
        self,
        task: dict[str, Any],
        agent: AgentName,
        node_id: str,
        assignments: list[dict[str, Any]],
        *,
        team_id: str | None = None,
    ) -> bool:
        claim = task.get("dispatchClaim") or {}
        claim_id = claim.get("id")
        try:
            session = await self.backend.run(
                node_id,
                {
                    "taskGoal": task_goal_text(task),
                    "assignments": assignments,
                    "taskId": task["id"],
                    "actorIsAdmin": True,
                    "agentFirst": True,
                    **({"teamId": team_id} if team_id else {}),
                    **({"idempotencyKey": claim_id} if claim_id else {}),
                },
            )
        except Exception as error:
            code = dispatch_failure_code(error)
            if claim_id and code != "dispatch_failed":
                self.task_store.release_dispatch_claim(task["id"], claim_id)
            self.task_store.record_dispatch_outcome(
                task["id"],
                "queued",
                code=code,
                message=str(error),
            )
            logger.warning(
                "Scheduled task dispatch failed",
                task_id=task["id"],
                agent=agent,
                error=str(error),
            )
            return False
        self.task_store.update_task(task["id"], {"status": "running"})
        if claim_id:
            self.task_store.release_dispatch_claim(task["id"], claim_id)
        self.task_store.record_dispatch_outcome(task["id"], "started")
        self.task_store.record_activity(
            task["id"],
            f"Scheduled dispatch started by {agent}.",
            {"agent": agent, "sessionId": session["id"]},
        )
        logger.info(
            "Scheduled task dispatched",
            task_id=task["id"],
            session_id=session["id"],
            agent=agent,
            node_id=node_id,
        )
        return True

    def _backoff_active(self, task_id: str, now: float) -> bool:
        entry = self._dispatch_backoff.get(task_id)
        return entry is not None and now < entry[1]

    def _register_dispatch_failure(self, task_id: str) -> None:
        failures = self._dispatch_backoff.get(task_id, (0, 0.0))[0] + 1
        delay = min(self.interval_seconds * (2**failures), MAX_DISPATCH_BACKOFF_SECONDS)
        self._dispatch_backoff[task_id] = (failures, time.monotonic() + delay)

    def _routine_due(self, task: dict[str, Any], today: date) -> bool:
        if (
            not task.get("isRoutine")
            or not task.get("routineEnabled")
            or not task.get("routineNextRunDate")
        ):
            return False
        try:
            next_run = date.fromisoformat(task["routineNextRunDate"])
        except ValueError:
            return False
        return next_run <= today

    def _due_routines(self, today: date) -> list[dict[str, Any]]:
        if hasattr(self.task_store, "list_due_routines"):
            return list(self.task_store.list_due_routines(today.isoformat()))
        routines = [
            task
            for task in self.task_store.list_tasks()
            if self._routine_due(task, today)
        ]
        return sorted(routines, key=routine_due_sort_key)

    def _dispatchable_tasks(self) -> list[dict[str, Any]]:
        if hasattr(self.task_store, "list_dispatchable_tasks"):
            return list(self.task_store.list_dispatchable_tasks())
        tasks = [
            task
            for task in self.task_store.list_tasks()
            if task.get("status") == "assigned"
            and not task.get("isRoutine")
            and (task.get("assignedAgent") or task.get("assignedTeamId"))
        ]
        return sorted(tasks, key=task_claim_sort_key)


def ready_node_for_task(
    registry: Any, task: dict[str, Any], assignments: list[dict[str, Any]]
) -> dict[str, Any] | None:
    if not assignments:
        return None
    requested_agents = [
        assignment.get("agent") for assignment in assignments if assignment.get("agent")
    ]
    employee_id = task.get("assigneeEmployeeId") or task.get("ownerEmployeeId")
    active_runs_by_node: dict[str, list[dict[str, Any]]] = {}
    for run in registry.daemon_store.list_active_runs():
        active_runs_by_node.setdefault(run["nodeId"], []).append(run)
    for node in registry.list_ready():
        if employee_id and node.get("employeeId") != employee_id:
            continue
        if node.get("status") in (
            "stopped",
            "failed",
            "provisioning",
        ) or not registry.is_live(node["id"]):
            continue
        disabled = set(node.get("disabledAgents") or [])
        if any(agent in disabled for agent in requested_agents):
            continue
        active_runs = active_runs_by_node.get(node["id"], [])
        if all(
            node.get("agents", {}).get(agent) == "ready" for agent in requested_agents
        ) and node_accepts_run(
            node,
            assignments=assignments,
            active_runs=active_runs,
        ):
            return node
    return None


def employee_has_device_node(registry: Any, employee_id: str) -> bool:
    return any(
        node.get("employeeId") == employee_id
        and node.get("nodeLocation") == "employee-device"
        and not node.get("retiredAt")
        for node in registry.monitor_nodes()
    )


def ensure_managed_capacity_for_task(
    task: dict[str, Any], registry: Any, managed_node_store: Any | None
) -> Any | None:
    if not managed_node_store:
        return None
    employee_id = task.get("assigneeEmployeeId") or task.get("ownerEmployeeId")
    if not employee_id or employee_has_device_node(registry, employee_id):
        return None
    return managed_node_store.ensure_node_for_employee(employee_id)


def next_routine_date(run_date: date, cadence: str, today: date) -> date | None:
    if cadence == "custom":
        return None
    next_run = _add_interval(run_date, cadence)
    while next_run <= today:
        next_run = _add_interval(next_run, cadence)
    return next_run


def _add_interval(value: date, cadence: str) -> date:
    if cadence == "daily":
        return value + timedelta(days=1)
    if cadence == "monthly":
        return _add_month(value)
    return value + timedelta(days=7)


def _add_month(value: date) -> date:
    month = value.month + 1
    year = value.year
    if month == 13:
        month = 1
        year += 1
    day = min(value.day, _month_days(year, month))
    return date(year, month, day)


def _month_days(year: int, month: int) -> int:
    if month == 12:
        following = date(year + 1, 1, 1)
    else:
        following = date(year, month + 1, 1)
    return (following - timedelta(days=1)).day
