from __future__ import annotations

from typing import Any, Literal, Protocol, TypedDict

from ..persistence.protocols import SessionStore, TaskStore
from ..persistence.task_store import TaskExecutionActiveError

TERMINAL_SESSION_STATUSES = frozenset({"completed", "failed", "cancelled"})


class TaskDeletionContext(Protocol):
    task_store: TaskStore
    session_store: SessionStore


class TaskDeletionResult(TypedDict):
    task: dict[str, Any]
    outcome: Literal["deleted", "already_deleted"]


class TaskDeletionError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def task_has_active_linked_session(
    session_store: SessionStore, task: dict[str, Any]
) -> bool:
    for session_id in task.get("linkedSessionIds", []):
        try:
            session = session_store.get_session(session_id)
        except (KeyError, FileNotFoundError):
            continue
        if session.get("status") not in TERMINAL_SESSION_STATUSES:
            return True
    return False


def delete_task(
    ctx: TaskDeletionContext,
    task_id: str,
    actor: dict[str, Any],
) -> TaskDeletionResult:
    try:
        task = ctx.task_store.get_task(task_id)
    except (KeyError, FileNotFoundError) as error:
        raise TaskDeletionError("task_not_found") from error

    actor_employee_id = actor.get("employeeId")
    if not actor.get("isAdmin") and task.get("ownerEmployeeId") != actor_employee_id:
        raise TaskDeletionError("task_delete_forbidden")

    if task.get("deletedAt"):
        return {"task": task, "outcome": "already_deleted"}

    try:
        deleted = ctx.task_store.delete_task(
            task_id,
            deleted_by=actor_employee_id,
            reject_active_claim=True,
            active_linked_session=lambda current: task_has_active_linked_session(
                ctx.session_store, current
            ),
        )
    except TaskExecutionActiveError as error:
        raise TaskDeletionError("task_execution_active") from error
    return {"task": deleted, "outcome": "deleted"}
