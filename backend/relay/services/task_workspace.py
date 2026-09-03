"""Where a task's work lives on the computer that runs it.

A task's workspace identity is derived from its ids and never stored, the
same way a project's ``workspaceSubpath`` is a pure function of its project
id. This module is the one seam that resolves it, mirroring how
``computer_limits`` is the one seam for personal-computer limits: call it
wherever a dispatch or a browse needs to know where a task's files are, and
never rebuild the path by hand at a call site.
"""

from __future__ import annotations

from typing import Any

TASK_WORKSPACE_ROOT = "tasks"
WORKSPACE_LAYOUT_TASK = "task"
WORKSPACE_LAYOUT_THREAD = "thread"
WORKSPACE_LAYOUT_PROJECT = "project"
DAEMON_CAPABILITY_TASK_WORKSPACES = "task-workspaces"


def task_workspace_subpath(task: dict[str, Any]) -> str:
    """The durable directory a task's rounds share, under the node root.

    A routine occurrence nests under its routine so an employee browsing the
    routine sees every run's directory side by side, while the runs stay
    isolated from each other.
    """
    routine_id = task.get("sourceRoutineId")
    if isinstance(routine_id, str) and routine_id:
        return f"{TASK_WORKSPACE_ROOT}/{routine_id}/{task['id']}"
    return f"{TASK_WORKSPACE_ROOT}/{task['id']}"


def resolve_task_workspace(
    task: dict[str, Any],
    *,
    node: dict[str, Any] | None,
    project_snapshot: dict[str, Any] | None = None,
) -> tuple[str, str | None]:
    """The ``(workspaceLayout, workspaceSubpath)`` a dispatch of `task` should use.

    Resolved against the node that was already chosen, so the session records
    the layout the run will really get. A daemon that predates task workspaces
    degrades to the per-thread directory rather than failing the run: a project
    *is* its workspace, so a missing project capability is fatal, but a task
    merely loses shared state between rounds.
    """
    if project_snapshot:
        return (WORKSPACE_LAYOUT_PROJECT, project_snapshot["workspaceSubpath"])
    capabilities = (node or {}).get("capabilities") or []
    if DAEMON_CAPABILITY_TASK_WORKSPACES not in capabilities:
        return (WORKSPACE_LAYOUT_THREAD, None)
    return (WORKSPACE_LAYOUT_TASK, task_workspace_subpath(task))
