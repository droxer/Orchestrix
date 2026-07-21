from __future__ import annotations

from typing import Any
from datetime import date

from fastapi import APIRouter, HTTPException, Request
from loguru import logger

from ..persistence.stores import (
    relay_task_event,
    task_priority,
    task_routine_cadence,
    task_routine_type,
    task_status,
    valid_agent,
)
from ..sessions import SessionController
from ..tasks import ensure_managed_capacity_for_task, next_routine_date, ready_node_for_task, task_goal_text
from ..services.agent_routing import (
    AgentRoutingError,
    dispatch_failure_code,
    dispatch_reason_code,
    resolve_agent_assignments,
)
from .deps import AppContextDep
from .helpers import (
    actor_can_access_record,
    agent_task_mode,
    artifact_index_item,
    assignee_employee_id_for_task,
    assignment_list,
    get_task_for_actor,
    json_body,
    owner_employee_id_for_create,
    participants_for_assignments,
    request_actor,
    string_field,
    workspace_artifact_key,
    workspace_artifacts,
)

router = APIRouter()

PERMANENT_DISPATCH_CODES = {
    "agent_disabled",
    "agent_forbidden",
    "agent_not_found",
    "executor_mismatch",
}


def logical_agent_for_assignment(
    ctx: AppContextDep,
    actor: dict[str, Any],
    agent_id: str | None,
    *,
    expected_employee_id: str | None = None,
) -> dict[str, Any] | None:
    if not agent_id:
        return None
    agent = ctx.agent_store.get_agent(agent_id)
    if not agent or agent.get("deletedAt"):
        raise HTTPException(404, "Logical agent not found.")
    allowed_employee_id = expected_employee_id or actor["employeeId"]
    if agent.get("supervisorEmployeeId") != allowed_employee_id:
        raise HTTPException(403, "Logical agent is not available to the task assignee.")
    if not actor["isAdmin"] and agent.get("supervisorEmployeeId") != actor["employeeId"]:
        raise HTTPException(403, "Logical agent access denied.")
    return agent


def date_field(body: dict[str, Any], key: str) -> str | None:
    if key not in body:
        return None
    raw = body.get(key)
    if raw in (None, ""):
        return ""
    if not isinstance(raw, str):
        raise HTTPException(400, f"{key} must be a YYYY-MM-DD date.")
    value = raw.strip()
    try:
        date.fromisoformat(value)
    except ValueError:
        raise HTTPException(400, f"{key} must be a YYYY-MM-DD date.")
    return value


def bool_field(body: dict[str, Any], key: str) -> bool | None:
    if key not in body:
        return None
    raw = body.get(key)
    if isinstance(raw, bool):
        return raw
    raise HTTPException(400, f"{key} must be a boolean.")


def routine_fields(
    body: dict[str, Any], *, current: dict[str, Any] | None = None
) -> dict[str, Any]:
    has_routine_input = any(
        key in body
        for key in (
            "isRoutine",
            "routineType",
            "routineCadence",
            "routineNextRunDate",
            "routineEnabled",
        )
    )
    if not has_routine_input:
        return {}
    is_routine = bool_field(body, "isRoutine")
    enabled = bool_field(body, "routineEnabled")
    routine_type = (
        task_routine_type(body.get("routineType")) if "routineType" in body else None
    )
    cadence = (
        task_routine_cadence(body.get("routineCadence"))
        if "routineCadence" in body
        else None
    )
    if "routineType" in body and body.get("routineType") and not routine_type:
        raise HTTPException(400, "routineType must be one of: task, job.")
    if "routineCadence" in body and body.get("routineCadence") and not cadence:
        raise HTTPException(
            400, "routineCadence must be one of: daily, weekly, monthly, custom."
        )
    has_next_run_input = "routineNextRunDate" in body
    next_run = date_field(body, "routineNextRunDate") if has_next_run_input else None
    next_is_routine = bool(
        is_routine
        if is_routine is not None
        else current.get("isRoutine")
        if current
        else True
    )
    next_enabled = (
        enabled
        if enabled is not None
        else (
            bool((current or {}).get("routineEnabled")) if current else next_is_routine
        )
    )
    resolved_cadence = cadence or (current or {}).get("routineCadence") or "weekly"
    cadence_changed = bool(
        current and cadence and cadence != current.get("routineCadence")
    )
    reenabled = bool(
        current and enabled is True and not current.get("routineEnabled")
    )
    if (
        next_is_routine
        and next_enabled
        and resolved_cadence != "custom"
        and ((current is None and not has_next_run_input) or cadence_changed or reenabled)
    ):
        today = date.today()
        calculated_next_run = next_routine_date(today, resolved_cadence, today)
        next_run = calculated_next_run.isoformat() if calculated_next_run else None
    return {
        "isRoutine": is_routine if is_routine is not None else next_is_routine,
        "routineType": routine_type or (current or {}).get("routineType") or "task",
        "routineCadence": resolved_cadence,
        "routineNextRunDate": next_run,
        "routineEnabled": next_enabled,
    }


def team_assignments_for_task(
    ctx: AppContextDep, task: dict[str, Any]
) -> list[dict[str, Any]]:
    employee_id = task.get("assigneeEmployeeId") or task.get("ownerEmployeeId")
    if not employee_id:
        return []
    selected: list[dict[str, Any]] = []
    daemon_nodes = ctx.registry.monitor_nodes()
    for agent in ctx.agent_store.list_agents(
        supervisor_employee_id=employee_id
    ):
        if not agent.get("enabled", True):
            continue
        candidate = {
            "agentId": agent["id"],
            "agent": agent["executorKind"],
            "mode": "ask",
            **({"role": agent["defaultRole"]} if agent.get("defaultRole") else {}),
        }
        try:
            resolve_agent_assignments(
                [*selected, candidate],
                employee_id=employee_id,
                is_admin=True,
                agent_store=ctx.agent_store,
                placement_store=ctx.agent_placement_store,
                daemon_nodes=daemon_nodes,
            )
        except AgentRoutingError:
            continue
        selected.append(candidate)
    return selected if len(selected) > 1 else []


async def start_task_on_ready_node(
    ctx: AppContextDep,
    task: dict[str, Any],
    actor: dict[str, Any],
    *,
    mode: str = "action",
    assignments: list[dict[str, Any]] | None = None,
    record_pending: bool = True,
) -> dict[str, Any] | None:
    run_assignments = assignments or []
    agent = valid_agent(task.get("assignedAgent")) or (
        run_assignments[0]["agent"] if run_assignments else None
    )
    if not agent:
        return None
    if not run_assignments:
        run_assignments = [
            {
                "agent": agent,
                "mode": agent_task_mode(mode),
                **(
                    {"agentId": task["assignedAgentId"]}
                    if task.get("assignedAgentId")
                    else {}
                ),
            }
        ]
    if task.get("isRoutine"):
        return None
    if task.get("status") not in ("backlog", "assigned"):
        return None
    if task.get("assignedAgentId") and task.get("status") == "backlog":
        task = ctx.task_store.update_task(task["id"], {"status": "assigned"})
    agent_first = any(item.get("agentId") for item in run_assignments)
    if agent_first:
        try:
            run_assignments = resolve_agent_assignments(
                run_assignments,
                employee_id=task.get("ownerEmployeeId")
                or task.get("assigneeEmployeeId")
                or actor["employeeId"],
                is_admin=False,
                agent_store=ctx.agent_store,
                placement_store=ctx.agent_placement_store,
                daemon_nodes=ctx.registry.monitor_nodes(),
            )
        except AgentRoutingError as error:
            if record_pending:
                code = dispatch_reason_code(error.code)
                state = "rejected" if error.code in PERMANENT_DISPATCH_CODES else "queued"
                message = str(error)
                if state == "queued":
                    capacity = ensure_managed_capacity_for_task(
                        task, ctx.registry, ctx.managed_node_store
                    )
                    if capacity and capacity.provisioning_requested:
                        employee_id = task.get("assigneeEmployeeId") or task.get(
                            "ownerEmployeeId"
                        )
                        message = (
                            f"Managed node provisioning requested for {employee_id}."
                        )
                        ctx.task_store.record_activity(
                            task["id"], message, {"agent": agent}
                        )
                updated = ctx.task_store.record_dispatch_outcome(
                    task["id"], state, code=code, message=message
                )
                return {
                    "task": updated,
                    "session": None,
                    "dispatch": {
                        "state": state,
                        "code": code,
                        "message": message,
                    },
                }
            raise
        node = ctx.registry.get(run_assignments[0]["daemonNodeId"])
    else:
        node = ready_node_for_task(ctx.registry, task, run_assignments)
    if not node:
        employee_id = task.get("assigneeEmployeeId") or task.get("ownerEmployeeId")
        capacity = ensure_managed_capacity_for_task(
            task, ctx.registry, ctx.managed_node_store
        )
        requested_capacity = bool(capacity and capacity.provisioning_requested)
        if record_pending:
            label = ", ".join(dict.fromkeys(item["agent"] for item in run_assignments))
            message = (
                f"Managed node provisioning requested for {employee_id}."
                if requested_capacity
                else f"No ready node is available for {label}."
            )
            ctx.task_store.record_activity(task["id"], message, {"agent": agent})
            code = "configuration_pending" if requested_capacity else "agent_offline"
            updated = ctx.task_store.record_dispatch_outcome(
                task["id"], "queued", code=code, message=message
            )
            return {
                "task": updated,
                "session": None,
                "dispatch": {
                    "state": "queued",
                    "code": code,
                    "message": message,
                },
            }
        return None
    temporary_team_status = False
    if task.get("status") == "backlog":
        task = ctx.task_store.update_task(task["id"], {"status": "assigned"})
        temporary_team_status = not bool(task.get("assignedAgentId"))
    # Claim the task before dispatching so the background scheduler (which only
    # dispatches "assigned" tasks it can claim) cannot start a second session
    # for the same task in the window before the run flips it to running.
    claim_agent = valid_agent(task.get("assignedAgent")) or agent
    claimed = None
    if claim_agent:
        claimed = ctx.task_store.claim_task_for_dispatch(
            task["id"], claim_agent, message=f"Claimed by {agent}."
        )
        if not claimed:
            return {
                "task": ctx.task_store.get_task(task["id"]),
                "session": None,
                "dispatch": {
                    "state": "queued",
                    "code": "dispatch_in_progress",
                    "message": "This task already has a dispatch in progress.",
                },
            }
        task = claimed
    claim_id = (task.get("dispatchClaim") or {}).get("id")
    try:
        run_request = {
            "taskGoal": task_goal_text(task),
            "assignments": run_assignments,
            "taskId": task["id"],
            "actorIsAdmin": actor["isAdmin"],
            **({"agentFirst": True} if agent_first else {}),
            **({"idempotencyKey": claim_id} if claim_id else {}),
        }
        if not actor["isAdmin"]:
            run_request["actorEmployeeId"] = actor["employeeId"]
        session = await ctx.backend.run(node["id"], run_request)
    except Exception as error:
        code = dispatch_failure_code(error)
        released = bool(claim_id and code != "dispatch_failed")
        if released:
            ctx.task_store.release_dispatch_claim(task["id"], claim_id)
        if temporary_team_status and released:
            ctx.task_store.update_task(task["id"], {"status": "backlog"})
        if record_pending:
            state = "rejected" if code == "agent_forbidden" else "queued"
            updated = ctx.task_store.record_dispatch_outcome(
                task["id"], state, code=code, message=str(error)
            )
            return {
                "task": updated,
                "session": None,
                "dispatch": {"state": state, "code": code, "message": str(error)},
            }
        raise
    ctx.task_store.update_task(task["id"], {"status": "running"})
    if claim_id:
        ctx.task_store.release_dispatch_claim(task["id"], claim_id)
    message = (
        "Discussion started."
        if all(item.get("mode") == "ask" for item in run_assignments)
        and len(run_assignments) > 1
        else f"{agent} started the task."
    )
    updated_task = ctx.task_store.record_activity(
        task["id"], message, {"agent": agent, "sessionId": session["id"]}
    )
    logger.info(
        "Task started",
        task_id=task["id"],
        session_id=session["id"],
        agent=agent,
        assignments=run_assignments,
        node_id=node["id"],
    )
    updated_task = ctx.task_store.record_dispatch_outcome(task["id"], "started")
    return {
        "task": updated_task,
        "session": session,
        "dispatch": {"state": "started"},
    }


async def start_routine_occurrence_on_ready_node(
    ctx: AppContextDep,
    routine: dict[str, Any],
    actor: dict[str, Any],
    *,
    agent: str,
    mode: str = "action",
    assignments: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    if not routine.get("isRoutine") or not routine.get("routineEnabled"):
        return None
    today = date.today()
    scheduled_run_date = routine_next_run_date(routine)
    occurrence = None
    # A due routine uses the atomic promotion path; an early manual start still
    # records the same parent/occurrence lineage.
    if (
        scheduled_run_date
        and scheduled_run_date <= today
    ):
        next_run = next_routine_date(
            scheduled_run_date, routine.get("routineCadence") or "weekly", today
        )
        occurrence = ctx.task_store.promote_due_routine(
            routine["id"],
            today.isoformat(),
            next_run.isoformat() if next_run else None,
            agent_override=agent,
        )
        if not occurrence:
            return None
    else:
        occurrence = ctx.task_store.create_task(
            {
                "title": routine["title"],
                "description": routine.get("description", ""),
                "priority": routine.get("priority", "normal"),
                "ownerEmployeeId": routine.get("ownerEmployeeId"),
                "assigneeEmployeeId": routine.get("assigneeEmployeeId"),
                "dueDate": today.isoformat(),
                "sourceRoutineId": routine["id"],
                "scheduledFor": today.isoformat(),
                "assignedAgent": agent,
                **(
                    {"assignedAgentId": routine["assignedAgentId"]}
                    if routine.get("assignedAgentId")
                    else {}
                ),
                "status": "assigned",
            }
        )
        ctx.task_store.append_event(
            routine["id"],
            relay_task_event(
                "task.occurrence_created",
                routine["id"],
                {
                    "occurrenceId": occurrence["id"],
                    "scheduledFor": today.isoformat(),
                },
            ),
        )
    result = await start_task_on_ready_node(
        ctx, occurrence, actor, mode=mode, assignments=assignments
    )
    if result and result.get("session"):
        ctx.task_store.link_session(routine["id"], result["session"]["id"])
    return result


def routine_next_run_date(routine: dict[str, Any]) -> date | None:
    next_run = routine.get("routineNextRunDate")
    if not next_run:
        return None
    try:
        return date.fromisoformat(next_run)
    except ValueError:
        return None


def complete_linked_task_sessions(
    ctx: AppContextDep, task: dict[str, Any], outcome: str
) -> None:
    controller = SessionController(ctx.session_store)
    for session_id in task.get("linkedSessionIds", []):
        try:
            session = ctx.session_store.get_session(session_id)
        except (KeyError, FileNotFoundError):
            continue
        except Exception:
            logger.warning(
                "Unexpected error reading linked session",
                session_id=session_id,
                exc_info=True,
            )
            continue
        if session.get("status") in ("completed", "failed", "cancelled"):
            continue
        controller.complete_session(session_id, outcome)


@router.get("/tasks")
async def list_tasks(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    return {
        "tasks": [
            task
            for task in ctx.task_store.list_tasks()
            if actor_can_access_record(actor, task)
        ]
    }


@router.post("/tasks", status_code=201)
async def create_task(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    body = await json_body(request)
    title = string_field(body, "title") or string_field(body, "taskGoal")
    if not title:
        raise HTTPException(400, "title is required.")
    owner = owner_employee_id_for_create(actor, body)
    assignee = assignee_employee_id_for_task(actor, body, owner)
    assigned_agent_id = string_field(body, "assignedAgentId") or None
    if "assignedAgent" in body:
        raise HTTPException(400, "assignedAgent is read-only; use assignedAgentId.")
    logical_agent = logical_agent_for_assignment(
        ctx, actor, assigned_agent_id, expected_employee_id=owner
    )
    if logical_agent:
        assignee = logical_agent["supervisorEmployeeId"]
    agent = logical_agent["executorKind"] if logical_agent else None
    status = task_status(body.get("status"))
    if "status" in body and not status:
        raise HTTPException(400, "status is not a recognized task status.")
    if status == "assigned" and not assigned_agent_id:
        raise HTTPException(400, "assigned status requires assignedAgentId.")
    routine = routine_fields(body)
    if routine.get("isRoutine") and not assigned_agent_id and "routineEnabled" not in body:
        routine["routineEnabled"] = False
    if routine.get("routineEnabled") and not assigned_agent_id:
        raise HTTPException(400, "An enabled routine requires assignedAgentId.")
    task = ctx.task_store.create_task(
        {
            "title": title,
            "description": string_field(body, "description"),
            "priority": task_priority(body.get("priority")) or "normal",
            "ownerEmployeeId": owner,
            "assigneeEmployeeId": assignee,
            "dueDate": date_field(body, "dueDate"),
            "status": status,
            **routine,
        }
    )
    logger.info("Task created", task_id=task["id"], title=title, owner=owner)
    if agent:
        task = ctx.task_store.set_task_assignment(
            task["id"], agent, assigned_agent_id
        )
        logger.info(
            "Task assigned", task_id=task["id"], agent=agent, agent_id=assigned_agent_id
        )
    if body.get("createSession") is True or isinstance(body.get("assignments"), list):
        workspace_path = string_field(body, "workspacePath") or "/workspace"
        controller = SessionController(
            ctx.session_store,
            task_store=ctx.task_store,
            task_id=task["id"],
            workspace_path=workspace_path,
            owner_employee_id=owner,
            owner_agent_id=assigned_agent_id,
        )
        session = controller.create_session(
            task_goal_text(task),
            participants_for_assignments(body.get("assignments"), agent),
            True,
        )
        logger.info(
            "Session created from task",
            task_id=task["id"],
            session_id=session["id"],
            workspace_path=workspace_path,
        )
        assignments = assignment_list(body.get("assignments"))
        if assignments:
            controller.assign_session(session["id"], assignments)
        task = ctx.task_store.link_session(task["id"], session["id"])
    return task


@router.get("/tasks/{task_id}")
async def get_task(
    task_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    return get_task_for_actor(ctx.task_store, task_id, actor)


@router.patch("/tasks/{task_id}")
async def update_task(
    task_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    current = get_task_for_actor(ctx.task_store, task_id, actor)
    body = await json_body(request)
    title = string_field(body, "title") or None
    description = (
        body.get("description") if isinstance(body.get("description"), str) else None
    )
    priority = task_priority(body.get("priority"))
    status = task_status(body.get("status"))
    if "status" in body and not status:
        raise HTTPException(400, "status is not a recognized task status.")
    due_date = date_field(body, "dueDate")
    routine = routine_fields(body, current=current)
    assignee = (
        assignee_employee_id_for_task(actor, body, current.get("assigneeEmployeeId"))
        if "assigneeEmployeeId" in body or "assignee_employee_id" in body
        else None
    )
    agent = valid_agent(body.get("assignedAgent")) if "assignedAgent" in body else None
    assigned_agent_id = (
        string_field(body, "assignedAgentId") if "assignedAgentId" in body else None
    )
    if "assignedAgent" in body:
        raise HTTPException(400, "assignedAgent is read-only; use assignedAgentId.")
    assignee_changed = bool(
        assignee and assignee != current.get("assigneeEmployeeId")
    )
    if (
        assignee_changed
        and current.get("assignedAgentId")
        and "assignedAgentId" not in body
    ):
        raise HTTPException(
            400,
            "Changing the assignee requires assignedAgentId for the new employee, or an explicit empty assignedAgentId.",
        )
    logical_agent = logical_agent_for_assignment(
        ctx,
        actor,
        assigned_agent_id,
        expected_employee_id=current.get("ownerEmployeeId")
        or current.get("assigneeEmployeeId"),
    )
    if logical_agent:
        if agent and agent != logical_agent["executorKind"]:
            raise HTTPException(
                400, "assignedAgent does not match assignedAgentId executor kind."
            )
        agent = logical_agent["executorKind"]
        assignee = logical_agent["supervisorEmployeeId"]
    if (
        not title
        and description is None
        and not priority
        and not status
        and due_date is None
        and assignee is None
        and not agent
        and "assignedAgentId" not in body
        and not routine
    ):
        raise HTTPException(
            400,
            "PATCH requires title, description, priority, dueDate, assigneeEmployeeId, assignedAgentId, assignedAgent, or status.",
        )
    next_routine_enabled = routine.get("routineEnabled", current.get("routineEnabled"))
    next_is_routine = routine.get("isRoutine", current.get("isRoutine"))
    next_agent_id = (
        assigned_agent_id
        if "assignedAgentId" in body
        else current.get("assignedAgentId")
    )
    if next_is_routine and next_routine_enabled and not next_agent_id:
        raise HTTPException(400, "An enabled routine requires assignedAgentId.")
    if status == "assigned" and not next_agent_id:
        raise HTTPException(400, "assigned status requires assignedAgentId.")
    task = ctx.task_store.update_task(
        task_id,
        {
            "title": title,
            "description": description,
            "priority": priority,
            "status": status,
            "dueDate": due_date,
            "assigneeEmployeeId": assignee,
            **routine,
        },
    )
    if logical_agent and assigned_agent_id != current.get("assignedAgentId"):
        task = ctx.task_store.set_task_assignment(task_id, agent, assigned_agent_id)
    elif "assignedAgentId" in body and not assigned_agent_id:
        task = ctx.task_store.unassign_task(task_id)
    if status == "done":
        complete_linked_task_sessions(ctx, task, "Task marked done.")
        task = ctx.task_store.get_task(task_id)
    return task


@router.delete("/tasks/{task_id}")
async def delete_task(
    task_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    get_task_for_actor(ctx.task_store, task_id, actor)
    task = ctx.task_store.delete_task(task_id)
    logger.info(
        "Task deleted",
        task_id=task_id,
        actor=actor.get("employeeId") or actor.get("username"),
    )
    return task


@router.post("/tasks/{task_id}/assign")
async def assign_task(
    task_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    get_task_for_actor(ctx.task_store, task_id, actor)
    body = await json_body(request)
    assigned_agent_id = (
        string_field(body, "agentId") or string_field(body, "assignedAgentId") or None
    )
    logical_agent = logical_agent_for_assignment(
        ctx,
        actor,
        assigned_agent_id,
        expected_employee_id=get_task_for_actor(ctx.task_store, task_id, actor).get(
            "ownerEmployeeId"
        )
        or actor["employeeId"],
    )
    if not logical_agent or not assigned_agent_id:
        raise HTTPException(400, "agentId is required for task assignment.")
    task = ctx.task_store.set_task_assignment(
        task_id, logical_agent["executorKind"], assigned_agent_id
    )
    task = ctx.task_store.update_task(task_id, {"status": "assigned"})
    return task


@router.post("/tasks/{task_id}/start", status_code=202)
async def start_task(
    task_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    task = get_task_for_actor(ctx.task_store, task_id, actor)
    body = await json_body(request)
    assignments = assignment_list(body.get("assignments"))
    if body.get("agent") is not None:
        raise HTTPException(400, "agent is read-only; start through assignedAgentId.")
    if assignments and any(not assignment.get("agentId") for assignment in assignments):
        updated = ctx.task_store.record_dispatch_outcome(
            task_id,
            "rejected",
            code="agent_not_found",
            message="Every start assignment requires a named agentId.",
        )
        return {
            "task": updated,
            "session": None,
            "dispatch": {
                "state": "rejected",
                "code": "agent_not_found",
                "message": "Every start assignment requires a named agentId.",
            },
        }
    if (
        not assignments
        and task.get("assignedAgent")
        and not task.get("assignedAgentId")
    ):
        updated = ctx.task_store.record_dispatch_outcome(
            task_id,
            "rejected",
            code="agent_not_found",
            message="Select a named agent before starting this legacy task.",
        )
        return {
            "task": updated,
            "session": None,
            "dispatch": {
                "state": "rejected",
                "code": "agent_not_found",
                "message": "Select a named agent before starting this legacy task.",
            },
        }
    if not assignments and task.get("assignedAgentId") and task.get("assignedAgent"):
        assignments = [
            {
                "agentId": task["assignedAgentId"],
                "agent": task["assignedAgent"],
                "mode": agent_task_mode(body.get("mode")),
            }
        ]
    agent = valid_agent(task.get("assignedAgent"))
    if not agent and assignments:
        agent = assignments[0]["agent"]
    if not agent and not assignments:
        assignments = team_assignments_for_task(ctx, task)
        if assignments:
            agent = assignments[0]["agent"]
    if not agent:
        updated = ctx.task_store.record_dispatch_outcome(
            task_id,
            "rejected",
            code="agent_not_found",
            message="Select a named agent before starting this task.",
        )
        return {
            "task": updated,
            "session": None,
            "dispatch": {
                "state": "rejected",
                "code": "agent_not_found",
                "message": "Select a named agent before starting this task.",
            },
        }
    mode = agent_task_mode(body.get("mode"))
    if task.get("isRoutine"):
        if not task.get("assignedAgentId"):
            updated = ctx.task_store.record_dispatch_outcome(
                task_id,
                "rejected",
                code="agent_not_found",
                message="A routine requires a named agent before it can start.",
            )
            return {
                "task": updated,
                "session": None,
                "dispatch": {
                    "state": "rejected",
                    "code": "agent_not_found",
                    "message": "A routine requires a named agent before it can start.",
                },
            }
        result = await start_routine_occurrence_on_ready_node(
            ctx, task, actor, agent=agent, mode=mode, assignments=assignments or None
        )
    else:
        result = await start_task_on_ready_node(
            ctx, task, actor, mode=mode, assignments=assignments or None
        )
    if not result or not result.get("session"):
        return (
            result
            if result
            else {
                "task": task,
                "session": None,
                "dispatch": {"state": "rejected", "code": "invalid_state"},
            }
        )
    return result


@router.post("/tasks/claim-next")
async def claim_next_task(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    request_actor(request, ctx.auth_store)
    raise HTTPException(
        410,
        "Executor claim-next is retired; tasks dispatch through named-agent leases.",
    )


@router.post("/tasks/{task_id}/pickup")
async def pickup_task(
    task_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    body = await json_body(request)
    current = get_task_for_actor(ctx.task_store, task_id, actor)
    agent_id = string_field(body, "agentId") or string_field(
        body, "assignedAgentId"
    )
    logical_agent = logical_agent_for_assignment(
        ctx,
        actor,
        agent_id,
        expected_employee_id=current.get("ownerEmployeeId") or actor["employeeId"],
    )
    if not logical_agent or not agent_id:
        raise HTTPException(400, "agentId is required to pick up a task.")
    agent = logical_agent["executorKind"]
    ctx.task_store.update_task(
        task_id, {"assigneeEmployeeId": logical_agent["supervisorEmployeeId"]}
    )
    task = ctx.task_store.set_task_assignment(task_id, agent, agent_id)
    workspace_path = string_field(body, "workspacePath") or "/workspace"
    controller = SessionController(
        ctx.session_store,
        task_store=ctx.task_store,
        task_id=task["id"],
        workspace_path=workspace_path,
        owner_employee_id=current.get("ownerEmployeeId") or actor["employeeId"],
        owner_agent_id=agent_id,
    )
    session = controller.create_session(task_goal_text(task), ["human", agent])
    mode = agent_task_mode(body.get("mode"))
    controller.assign_session(
        session["id"], [{"agentId": agent_id, "agent": agent, "mode": mode}]
    )
    task = ctx.task_store.record_activity(
        task["id"],
        f"{agent} picked up the task.",
        {"agent": agent, "sessionId": session["id"]},
    )
    logger.info(
        "Task picked up",
        task_id=task_id,
        session_id=session["id"],
        agent=agent,
        mode=mode,
    )
    return {"task": task, "session": ctx.session_store.get_session(session["id"])}


@router.get("/tasks/{task_id}/events")
async def task_events(
    task_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    return {"events": get_task_for_actor(ctx.task_store, task_id, actor)["events"]}


@router.get("/tasks/{task_id}/artifacts")
async def task_artifacts(
    task_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    """Generated files (documents, decks, spreadsheets, …) produced while working the task.

    Aggregates workspace artifacts across the task's linked sessions and dedupes
    to the newest record per workspace file, so a file regenerated in a later
    session surfaces once at its latest state.
    """
    actor = request_actor(request, ctx.auth_store)
    task = get_task_for_actor(ctx.task_store, task_id, actor)
    newest: dict[str, dict[str, Any]] = {}
    for session_id in task.get("linkedSessionIds", []):
        try:
            session = ctx.session_store.get_session(session_id)
        except (KeyError, FileNotFoundError):
            continue  # A linked session may have been deleted; skip it.
        except Exception:
            logger.warning(
                "Unexpected error reading linked session for artifact aggregation",
                session_id=session_id,
                exc_info=True,
            )
            continue
        for artifact in workspace_artifacts(session):
            key = workspace_artifact_key(session, artifact)
            current = newest.get(key)
            if current is None or (artifact.get("createdAt") or "") >= (
                current.get("createdAt") or ""
            ):
                newest[key] = {
                    **artifact_index_item(session, artifact),
                    "taskId": task_id,
                }
    ordered = sorted(
        newest.values(), key=lambda item: item.get("createdAt") or "", reverse=True
    )
    return {"taskId": task_id, "artifacts": ordered}
