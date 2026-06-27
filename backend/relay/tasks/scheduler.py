from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Callable

from loguru import logger

from ..core.models import AgentName
from ..persistence.stores import valid_agent


def task_goal_text(task: dict[str, Any]) -> str:
    return f"{task['title']}\n\n{task['description']}" if task.get("description") else task["title"]


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
        interval_seconds: float = 10.0,
        max_dispatches_per_tick: int = 5,
        today: Callable[[], date] = date.today,
    ) -> None:
        self.task_store = task_store
        self.registry = registry
        self.backend = backend
        self.interval_seconds = interval_seconds
        self.max_dispatches_per_tick = max_dispatches_per_tick
        self._today = today
        self._loop_task: asyncio.Task[None] | None = None
        self._tick_lock = asyncio.Lock()

    def start(self) -> None:
        if self._loop_task and not self._loop_task.done():
            return
        self._loop_task = asyncio.create_task(self._run_loop(), name="relay-task-scheduler")
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
            promoted = self._promote_due_routines(today)
            dispatched = await self._dispatch_assigned_tasks()
            return SchedulerTickResult(promoted=promoted, dispatched=dispatched)

    async def _run_loop(self) -> None:
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Task scheduler tick failed")
            await asyncio.sleep(self.interval_seconds)

    def _promote_due_routines(self, today: date) -> int:
        promoted = 0
        for routine in self.task_store.list_tasks():
            if not self._routine_due(routine, today):
                continue
            agent = valid_agent(routine.get("assignedAgent"))
            if not agent:
                continue
            run_date = date.fromisoformat(routine["routineNextRunDate"])
            next_run = next_routine_date(run_date, routine.get("routineCadence") or "weekly", today)
            occurrence = self.task_store.promote_due_routine(routine["id"], today.isoformat(), next_run.isoformat() if next_run else None)
            if occurrence:
                promoted += 1
        return promoted

    async def _dispatch_assigned_tasks(self) -> int:
        dispatched = 0
        for task in self.task_store.list_tasks():
            if dispatched >= self.max_dispatches_per_tick:
                break
            agent = valid_agent(task.get("assignedAgent"))
            if not agent or task.get("status") != "assigned" or task.get("isRoutine"):
                continue
            node = ready_node_for_task(self.registry, task, agent)
            if not node:
                continue
            claimed = self.task_store.claim_task_for_dispatch(task["id"], agent)
            if not claimed:
                continue
            if await self._dispatch_claimed_task(claimed, agent, node["id"]):
                dispatched += 1
        return dispatched

    async def _dispatch_claimed_task(self, task: dict[str, Any], agent: AgentName, node_id: str) -> bool:
        try:
            session = await self.backend.run(node_id, {
                "taskGoal": task_goal_text(task),
                "assignments": [{"agent": agent, "mode": "action"}],
                "taskId": task["id"],
                "actorIsAdmin": True,
            })
        except Exception as error:
            self.task_store.assign_task(task["id"], agent)
            self.task_store.record_activity(task["id"], f"Scheduled dispatch failed: {error}", {"agent": agent})
            logger.warning("Scheduled task dispatch failed", task_id=task["id"], agent=agent, error=str(error))
            return False
        self.task_store.record_activity(
            task["id"],
            f"Scheduled dispatch started by {agent}.",
            {"agent": agent, "sessionId": session["id"]},
        )
        logger.info("Scheduled task dispatched", task_id=task["id"], session_id=session["id"], agent=agent, node_id=node_id)
        return True

    def _routine_due(self, task: dict[str, Any], today: date) -> bool:
        if not task.get("isRoutine") or not task.get("routineEnabled") or not task.get("routineNextRunDate"):
            return False
        try:
            next_run = date.fromisoformat(task["routineNextRunDate"])
        except ValueError:
            return False
        return next_run <= today

def ready_node_for_task(registry: Any, task: dict[str, Any], agent: str) -> dict[str, Any] | None:
    employee_id = task.get("assigneeEmployeeId") or task.get("ownerEmployeeId")
    for node in registry.list_ready():
        if employee_id and node.get("employeeId") != employee_id:
            continue
        if node.get("status") != "ready" or not registry.is_live(node["id"]):
            continue
        if agent in set(node.get("disabledAgents") or []):
            continue
        if node.get("agents", {}).get(agent) == "ready":
            return node
    return None


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
