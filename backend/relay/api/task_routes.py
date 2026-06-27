from __future__ import annotations

from typing import Any
from datetime import date

from fastapi import APIRouter, HTTPException, Request
from loguru import logger

from ..core.models import AGENT_NAMES
from ..persistence.stores import task_priority, task_routine_cadence, task_routine_type, task_status, valid_agent
from ..sessions import SessionController
from ..tasks import next_routine_date
from .deps import AppContextDep
from .helpers import (
    actor_can_access_record,
    agent_task_mode,
    assignee_employee_id_for_task,
    assignment_list,
    get_task_for_actor,
    json_body,
    owner_employee_id_for_create,
    participants_for_assignments,
    request_actor,
    string_field,
)

router = APIRouter()


def task_goal_text(task: dict[str, Any]) -> str:
    return f"{task['title']}\n\n{task['description']}" if task.get("description") else task["title"]


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


def routine_fields(body: dict[str, Any], *, current: dict[str, Any] | None = None) -> dict[str, Any]:
    has_routine_input = any(key in body for key in ("isRoutine", "routineType", "routineCadence", "routineNextRunDate", "routineEnabled"))
    if not has_routine_input:
        return {}
    is_routine = bool_field(body, "isRoutine")
    enabled = bool_field(body, "routineEnabled")
    routine_type = task_routine_type(body.get("routineType")) if "routineType" in body else None
    cadence = task_routine_cadence(body.get("routineCadence")) if "routineCadence" in body else None
    if "routineType" in body and body.get("routineType") and not routine_type:
        raise HTTPException(400, "routineType must be one of: task, job.")
    if "routineCadence" in body and body.get("routineCadence") and not cadence:
        raise HTTPException(400, "routineCadence must be one of: daily, weekly, monthly, custom.")
    next_run = date_field(body, "routineNextRunDate") if "routineNextRunDate" in body else None
    next_is_routine = bool(is_routine if is_routine is not None else current.get("isRoutine") if current else True)
    return {
        "isRoutine": is_routine if is_routine is not None else next_is_routine,
        "routineType": routine_type or (current or {}).get("routineType") or "task",
        "routineCadence": cadence or (current or {}).get("routineCadence") or "weekly",
        "routineNextRunDate": next_run,
        "routineEnabled": enabled if enabled is not None else (bool((current or {}).get("routineEnabled")) if current else next_is_routine),
    }


def ready_node_for_task(ctx: AppContextDep, task: dict[str, Any], agent: str) -> dict[str, Any] | None:
    employee_id = task.get("assigneeEmployeeId") or task.get("ownerEmployeeId")
    for node in ctx.registry.list_ready():
        if employee_id and node.get("employeeId") != employee_id:
            continue
        if node.get("status") != "ready" or not ctx.registry.is_live(node["id"]):
            continue
        if agent in set(node.get("disabledAgents") or []):
            continue
        if node.get("agents", {}).get(agent) == "ready":
            return node
    return None


async def start_task_on_ready_node(
    ctx: AppContextDep,
    task: dict[str, Any],
    actor: dict[str, Any],
    *,
    mode: str = "action",
    record_pending: bool = True,
) -> dict[str, Any] | None:
    agent = valid_agent(task.get("assignedAgent"))
    if not agent:
        return None
    if task.get("isRoutine"):
        return None
    if task.get("status") in ("running", "review", "waiting_for_human", "done"):
        return None
    node = ready_node_for_task(ctx, task, agent)
    if not node:
        if record_pending:
            return {"task": ctx.task_store.record_activity(task["id"], f"No ready node is available for {agent}.", {"agent": agent}), "session": None}
        return None
    try:
        run_request = {
            "taskGoal": task_goal_text(task),
            "assignments": [{"agent": agent, "mode": agent_task_mode(mode)}],
            "taskId": task["id"],
            "actorIsAdmin": actor["isAdmin"],
        }
        if not actor["isAdmin"]:
            run_request["actorEmployeeId"] = actor["employeeId"]
        session = await ctx.backend.run(node["id"], run_request)
    except ValueError as error:
        if record_pending:
            updated = ctx.task_store.record_activity(task["id"], str(error), {"agent": agent})
            return {"task": updated, "session": None}
        raise
    updated_task = ctx.task_store.record_activity(task["id"], f"{agent} started the task.", {"agent": agent, "sessionId": session["id"]})
    logger.info("Task started", task_id=task["id"], session_id=session["id"], agent=agent, node_id=node["id"])
    return {"task": updated_task, "session": session}


async def start_routine_occurrence_on_ready_node(
    ctx: AppContextDep,
    routine: dict[str, Any],
    actor: dict[str, Any],
    *,
    agent: str,
    mode: str = "action",
) -> dict[str, Any] | None:
    if not routine.get("isRoutine") or not routine.get("routineEnabled"):
        return None
    today = date.today()
    scheduled_run_date = routine_next_run_date(routine)
    occurrence = None
    if scheduled_run_date and scheduled_run_date <= today:
        next_run = next_routine_date(scheduled_run_date, routine.get("routineCadence") or "weekly", today)
        occurrence = ctx.task_store.promote_due_routine(
            routine["id"],
            today.isoformat(),
            next_run.isoformat() if next_run else None,
        )
        if not occurrence:
            return None
    else:
        occurrence = ctx.task_store.create_task({
            "title": routine["title"],
            "description": routine.get("description", ""),
            "priority": routine.get("priority", "normal"),
            "ownerEmployeeId": routine.get("ownerEmployeeId"),
            "assigneeEmployeeId": routine.get("assigneeEmployeeId"),
            "dueDate": today.isoformat(),
            "assignedAgent": agent,
            "status": "assigned",
        })
        ctx.task_store.record_activity(
            routine["id"],
            f"Routine occurrence created: {occurrence['id']}.",
            {"agent": agent},
        )
    result = await start_task_on_ready_node(ctx, occurrence, actor, mode=mode)
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


@router.get("/tasks")
async def list_tasks(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    return {"tasks": [task for task in ctx.task_store.list_tasks() if actor_can_access_record(actor, task)]}


@router.post("/tasks", status_code=201)
async def create_task(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    body = await json_body(request)
    title = string_field(body, "title") or string_field(body, "taskGoal")
    if not title:
        raise HTTPException(400, "title is required.")
    owner = owner_employee_id_for_create(actor, body)
    assignee = assignee_employee_id_for_task(actor, body, owner)
    task = ctx.task_store.create_task({
        "title": title,
        "description": string_field(body, "description"),
        "priority": task_priority(body.get("priority")) or "normal",
        "ownerEmployeeId": owner,
        "assigneeEmployeeId": assignee,
        "dueDate": date_field(body, "dueDate"),
        **routine_fields(body),
    })
    logger.info("Task created", task_id=task["id"], title=title, owner=owner)
    agent = valid_agent(body.get("assignedAgent"))
    if agent:
        task = ctx.task_store.assign_task(task["id"], agent)
        logger.info("Task assigned", task_id=task["id"], agent=agent)
    if body.get("createSession") is True or isinstance(body.get("assignments"), list):
        workspace_path = string_field(body, "workspacePath") or "/workspace"
        controller = SessionController(
            ctx.session_store,
            task_store=ctx.task_store,
            task_id=task["id"],
            workspace_path=workspace_path,
            owner_employee_id=owner,
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
async def get_task(task_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    return get_task_for_actor(ctx.task_store, task_id, actor)


@router.patch("/tasks/{task_id}")
async def update_task(task_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    current = get_task_for_actor(ctx.task_store, task_id, actor)
    body = await json_body(request)
    title = string_field(body, "title") or None
    description = body.get("description") if isinstance(body.get("description"), str) else None
    priority = task_priority(body.get("priority"))
    status = task_status(body.get("status"))
    due_date = date_field(body, "dueDate")
    routine = routine_fields(body, current=current)
    assignee = assignee_employee_id_for_task(actor, body, current.get("assigneeEmployeeId")) if "assigneeEmployeeId" in body or "assignee_employee_id" in body else None
    agent = valid_agent(body.get("assignedAgent")) if "assignedAgent" in body else None
    if "assignedAgent" in body and body.get("assignedAgent") and not agent:
        raise HTTPException(400, f"assignedAgent must be one of: {', '.join(AGENT_NAMES)}.")
    if not title and description is None and not priority and not status and due_date is None and assignee is None and not agent and not routine:
        raise HTTPException(400, "PATCH requires title, description, priority, dueDate, assigneeEmployeeId, assignedAgent, or status.")
    task = ctx.task_store.update_task(task_id, {
        "title": title,
        "description": description,
        "priority": priority,
        "status": status,
        "dueDate": due_date,
        "assigneeEmployeeId": assignee,
        **routine,
    })
    if agent:
        task = ctx.task_store.assign_task(task_id, agent)
    return task


@router.post("/tasks/{task_id}/assign")
async def assign_task(task_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    get_task_for_actor(ctx.task_store, task_id, actor)
    body = await json_body(request)
    agent = valid_agent(body.get("agent"))
    if not agent:
        raise HTTPException(400, f"agent must be one of: {', '.join(AGENT_NAMES)}.")
    task = ctx.task_store.assign_task(task_id, agent)
    return task


@router.post("/tasks/{task_id}/start", status_code=202)
async def start_task(task_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    task = get_task_for_actor(ctx.task_store, task_id, actor)
    body = await json_body(request)
    agent = valid_agent(body.get("agent")) or valid_agent(task.get("assignedAgent"))
    if not agent:
        raise HTTPException(400, f"agent must be one of: {', '.join(AGENT_NAMES)}.")
    if task.get("assignedAgent") != agent:
        task = ctx.task_store.assign_task(task_id, agent)
    mode = agent_task_mode(body.get("mode"))
    if task.get("isRoutine"):
        result = await start_routine_occurrence_on_ready_node(ctx, task, actor, agent=agent, mode=mode)
    else:
        result = await start_task_on_ready_node(ctx, task, actor, mode=mode)
    if not result or not result.get("session"):
        return {"task": result["task"] if result else task, "session": None}
    return result


@router.post("/tasks/claim-next")
async def claim_next_task(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    body = await json_body(request)
    agent = valid_agent(body.get("agent"))
    if not agent:
        raise HTTPException(400, f"agent must be one of: {', '.join(AGENT_NAMES)}.")
    requested_assignee = string_field(body, "assigneeEmployeeId") or string_field(body, "assignee_employee_id")
    assignee = requested_assignee if actor["isAdmin"] and requested_assignee else actor["employeeId"]
    task = ctx.task_store.claim_next_task_for_agent(agent, assignee)
    if task and not actor_can_access_record(actor, task):
        raise HTTPException(403, "Task access denied.")
    return {"task": task}


@router.post("/tasks/{task_id}/pickup")
async def pickup_task(task_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    body = await json_body(request)
    current = get_task_for_actor(ctx.task_store, task_id, actor)
    agent = valid_agent(body.get("agent")) or current.get("assignedAgent")
    if not agent:
        raise HTTPException(400, f"agent must be one of: {', '.join(AGENT_NAMES)}.")
    task = current if current.get("assignedAgent") == agent else ctx.task_store.assign_task(task_id, agent)
    workspace_path = string_field(body, "workspacePath") or "/workspace"
    controller = SessionController(
        ctx.session_store,
        task_store=ctx.task_store,
        task_id=task["id"],
        workspace_path=workspace_path,
        owner_employee_id=current.get("ownerEmployeeId") or actor["employeeId"],
    )
    session = controller.create_session(task_goal_text(task), ["human", agent])
    mode = agent_task_mode(body.get("mode"))
    controller.assign_session(session["id"], [{"agent": agent, "mode": mode}])
    task = ctx.task_store.record_activity(
        task["id"],
        f"{agent} picked up the task.",
        {"agent": agent, "sessionId": session["id"]},
    )
    logger.info("Task picked up", task_id=task_id, session_id=session["id"], agent=agent, mode=mode)
    return {"task": task, "session": ctx.session_store.get_session(session["id"])}


@router.get("/tasks/{task_id}/events")
async def task_events(task_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    return {"events": get_task_for_actor(ctx.task_store, task_id, actor)["events"]}
