from __future__ import annotations

from typing import Any
from datetime import date

from fastapi import APIRouter, HTTPException, Request
from loguru import logger

from ..core.models import AGENT_NAMES
from ..daemon_registry import node_accepts_run
from ..persistence.stores import task_priority, task_routine_cadence, task_routine_type, task_status, valid_agent
from ..sessions import SessionController
from ..tasks import next_routine_date, ready_node_for_task, task_goal_text
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


def team_assignments_for_task(ctx: AppContextDep, task: dict[str, Any]) -> list[dict[str, Any]]:
    employee_id = task.get("assigneeEmployeeId") or task.get("ownerEmployeeId")
    for node in ctx.registry.list_ready():
        if employee_id and node.get("employeeId") != employee_id:
            continue
        if node.get("status") in ("stopped", "failed", "provisioning") or not ctx.registry.is_live(node["id"]):
            continue
        disabled = set(node.get("disabledAgents") or [])
        assignments = [
            {"agent": agent, "mode": "ask"}
            for agent in AGENT_NAMES
            if agent not in disabled and node.get("agents", {}).get(agent) == "ready"
        ]
        if not assignments:
            continue
        active_runs = ctx.registry.daemon_store.list_active_runs(node["id"])
        if node_accepts_run(node, assignments=assignments, active_runs=active_runs):
            return assignments
    return []


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
    agent = valid_agent(task.get("assignedAgent")) or (run_assignments[0]["agent"] if run_assignments else None)
    if not agent:
        return None
    if not run_assignments:
        run_assignments = [{"agent": agent, "mode": agent_task_mode(mode)}]
    if task.get("isRoutine"):
        return None
    if task.get("status") in ("running", "review", "done"):
        return None
    node = ready_node_for_task(ctx.registry, task, run_assignments)
    if not node:
        if record_pending:
            label = ", ".join(dict.fromkeys(item["agent"] for item in run_assignments))
            return {"task": ctx.task_store.record_activity(task["id"], f"No ready node is available for {label}.", {"agent": agent}), "session": None}
        return None
    # Claim the task before dispatching so the background scheduler (which only
    # dispatches "assigned" tasks it can claim) cannot start a second session
    # for the same task in the window before the run flips it to running.
    claim_agent = valid_agent(task.get("assignedAgent"))
    claimed = None
    if claim_agent and task.get("status") == "assigned":
        claimed = ctx.task_store.claim_task_for_dispatch(task["id"], claim_agent, message=f"Claimed by {agent}.")
        if not claimed:
            return {"task": ctx.task_store.get_task(task["id"]), "session": None}
        task = claimed
    try:
        run_request = {
            "taskGoal": task_goal_text(task),
            "assignments": run_assignments,
            "taskId": task["id"],
            "actorIsAdmin": actor["isAdmin"],
        }
        if not actor["isAdmin"]:
            run_request["actorEmployeeId"] = actor["employeeId"]
        session = await ctx.backend.run(node["id"], run_request)
    except (ValueError, PermissionError) as error:
        if claimed:
            ctx.task_store.assign_task(task["id"], claim_agent)
        if record_pending:
            updated = ctx.task_store.record_activity(task["id"], str(error), {"agent": agent})
            return {"task": updated, "session": None}
        raise
    message = "Discussion started." if all(item.get("mode") == "ask" for item in run_assignments) and len(run_assignments) > 1 else f"{agent} started the task."
    updated_task = ctx.task_store.record_activity(task["id"], message, {"agent": agent, "sessionId": session["id"]})
    logger.info("Task started", task_id=task["id"], session_id=session["id"], agent=agent, assignments=run_assignments, node_id=node["id"])
    return {"task": updated_task, "session": session}


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
    # Promotion requires the routine's own assigned agent; an agentless routine
    # started manually (e.g. as a team discussion) takes the ad-hoc path below.
    if scheduled_run_date and scheduled_run_date <= today and valid_agent(routine.get("assignedAgent")):
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
    result = await start_task_on_ready_node(ctx, occurrence, actor, mode=mode, assignments=assignments)
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


def complete_linked_task_sessions(ctx: AppContextDep, task: dict[str, Any], outcome: str) -> None:
    controller = SessionController(ctx.session_store)
    for session_id in task.get("linkedSessionIds", []):
        try:
            session = ctx.session_store.get_session(session_id)
        except (KeyError, FileNotFoundError):
            continue
        except Exception:
            logger.warning("Unexpected error reading linked session", session_id=session_id, exc_info=True)
            continue
        if session.get("status") in ("completed", "failed", "cancelled"):
            continue
        controller.complete_session(session_id, outcome)


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
    if status == "done":
        complete_linked_task_sessions(ctx, task, "Task marked done.")
        task = ctx.task_store.get_task(task_id)
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
    assignments = assignment_list(body.get("assignments"))
    agent = valid_agent(body.get("agent")) or valid_agent(task.get("assignedAgent"))
    if not agent and assignments:
        agent = assignments[0]["agent"]
    if not agent and not assignments:
        assignments = team_assignments_for_task(ctx, task)
        if assignments:
            agent = assignments[0]["agent"]
    if not agent:
        return {
            "task": ctx.task_store.record_activity(task_id, "No ready agent team is available."),
            "session": None,
        }
    if not assignments and task.get("assignedAgent") != agent:
        task = ctx.task_store.assign_task(task_id, agent)
    mode = agent_task_mode(body.get("mode"))
    if task.get("isRoutine"):
        result = await start_routine_occurrence_on_ready_node(ctx, task, actor, agent=agent, mode=mode, assignments=assignments or None)
    else:
        result = await start_task_on_ready_node(ctx, task, actor, mode=mode, assignments=assignments or None)
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


@router.get("/tasks/{task_id}/artifacts")
async def task_artifacts(task_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
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
            logger.warning("Unexpected error reading linked session for artifact aggregation", session_id=session_id, exc_info=True)
            continue
        for artifact in workspace_artifacts(session):
            key = workspace_artifact_key(session, artifact)
            current = newest.get(key)
            if current is None or (artifact.get("createdAt") or "") >= (current.get("createdAt") or ""):
                newest[key] = {**artifact_index_item(session, artifact), "taskId": task_id}
    ordered = sorted(newest.values(), key=lambda item: item.get("createdAt") or "", reverse=True)
    return {"taskId": task_id, "artifacts": ordered}
