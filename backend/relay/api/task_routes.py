from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from loguru import logger

from ..controller import SessionController
from ..models import AGENT_NAMES
from ..stores import task_priority, task_status, valid_agent
from .deps import AppContextDep
from .helpers import (
    actor_can_access_record,
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
    task = ctx.task_store.create_task({
        "title": title,
        "description": string_field(body, "description"),
        "priority": task_priority(body.get("priority")) or "normal",
        "ownerEmployeeId": owner,
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
    get_task_for_actor(ctx.task_store, task_id, actor)
    body = await json_body(request)
    title = string_field(body, "title") or None
    description = body.get("description") if isinstance(body.get("description"), str) else None
    priority = task_priority(body.get("priority"))
    status = task_status(body.get("status"))
    if not title and description is None and not priority and not status:
        raise HTTPException(400, "PATCH requires title, description, priority, or status.")
    return ctx.task_store.update_task(task_id, {"title": title, "description": description, "priority": priority, "status": status})


@router.post("/tasks/{task_id}/assign")
async def assign_task(task_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    get_task_for_actor(ctx.task_store, task_id, actor)
    body = await json_body(request)
    agent = valid_agent(body.get("agent"))
    if not agent:
        raise HTTPException(400, f"agent must be one of: {', '.join(AGENT_NAMES)}.")
    return ctx.task_store.assign_task(task_id, agent)


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
    mode = "review" if body.get("mode") == "review" else "action"
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
