from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import PlainTextResponse
from loguru import logger

from ..controller import SessionController
from ..models import AGENT_NAMES
from ..stores import valid_agent
from .deps import AppContextDep
from .helpers import (
    assignment_list,
    get_session_for_actor,
    get_task_for_actor,
    json_body,
    owner_employee_id_for_create,
    request_actor,
    role_name,
    string_field,
)

router = APIRouter()


@router.get("/sessions")
async def list_sessions(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    return {"sessions": [session for session in ctx.session_store.list_sessions() if actor["isAdmin"] or session.get("ownerEmployeeId") == actor["employeeId"]]}


@router.post("/sessions", status_code=201)
async def create_session(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    body = await json_body(request)
    task_goal = string_field(body, "taskGoal")
    if not task_goal:
        raise HTTPException(400, "taskGoal is required.")
    assignments = assignment_list(body.get("assignments"))
    workspace_path = string_field(body, "workspacePath") or "/workspace"
    task_id = body.get("taskId") if isinstance(body.get("taskId"), str) else None
    task = get_task_for_actor(ctx.task_store, task_id, actor) if task_id else None
    owner = owner_employee_id_for_create(actor, body)
    if task and task.get("ownerEmployeeId"):
        requested_owner = string_field(body, "ownerEmployeeId") or string_field(body, "employeeId")
        if actor["isAdmin"] and not requested_owner:
            owner = task["ownerEmployeeId"]
        elif owner != task["ownerEmployeeId"]:
            raise HTTPException(403, "Session owner must match the linked task owner.")
    controller = SessionController(
        ctx.session_store,
        task_store=ctx.task_store,
        task_id=task_id,
        workspace_path=workspace_path,
        owner_employee_id=owner,
    )
    session = controller.create_session(
        task_goal,
        list(dict.fromkeys(["human", *(assignment["agent"] for assignment in assignments)])),
        True,
    )
    if assignments:
        controller.assign_session(session["id"], assignments)
    logger.info("Session created", session_id=session["id"], workspace_path=workspace_path, owner=owner)
    return ctx.session_store.get_session(session["id"])


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    return get_session_for_actor(ctx.session_store, session_id, actor)


@router.post("/sessions/{session_id}/assignments")
async def assign_session(session_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    get_session_for_actor(ctx.session_store, session_id, actor)
    body = await json_body(request)
    assignments = assignment_list(body.get("assignments"))
    if not assignments:
        raise HTTPException(400, "assignments must include at least one agent.")
    controller = SessionController(ctx.session_store, task_store=ctx.task_store, owner_employee_id=actor["employeeId"])
    controller.assign_session(session_id, assignments)
    return ctx.session_store.get_session(session_id)


@router.post("/sessions/{session_id}/decisions")
async def decision(session_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    get_session_for_actor(ctx.session_store, session_id, actor)
    body = await json_body(request)
    kind = body.get("kind")
    if kind not in ("approve", "reject", "cancel", "rerun", "handoff", "mark_done"):
        raise HTTPException(400, "kind must be approve, reject, cancel, rerun, handoff, or mark_done.")
    controller = SessionController(ctx.session_store, task_store=ctx.task_store, owner_employee_id=actor["employeeId"])
    result = controller.record_decision(
        session_id,
        kind,
        string_field(body, "note") or None,
        valid_agent(body.get("targetAgent")),
    )
    logger.info("Session decision recorded", session_id=session_id, kind=kind)
    return result


@router.post("/sessions/{session_id}/handoffs")
async def handoff(session_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    get_session_for_actor(ctx.session_store, session_id, actor)
    body = await json_body(request)
    target_agent = valid_agent(body.get("targetAgent"))
    if not target_agent:
        raise HTTPException(400, f"targetAgent must be one of: {', '.join(AGENT_NAMES)}.")
    mode = "review" if body.get("mode") == "review" else "implement"
    controller = SessionController(ctx.session_store, task_store=ctx.task_store, owner_employee_id=actor["employeeId"])
    result = controller.handoff_session(
        session_id,
        target_agent,
        [{"agent": target_agent, "mode": mode, "role": role_name(body.get("role"))}],
        string_field(body, "note") or None,
    )
    logger.info("Session handoff recorded", session_id=session_id, target_agent=target_agent, mode=mode)
    return result


@router.get("/sessions/{session_id}/events")
async def session_events(session_id: str, request: Request, ctx: AppContextDep) -> Response:
    actor = request_actor(request, ctx.auth_store)
    session = get_session_for_actor(ctx.session_store, session_id, actor)
    body = "".join(f"event: {event['type']}\ndata: {json.dumps(event)}\n\n" for event in session["events"])
    body += f"event: heartbeat\ndata: {json.dumps({'timestamp': datetime.utcnow().isoformat() + 'Z'})}\n\n"
    return Response(body, media_type="text/event-stream")


@router.get("/sessions/{session_id}/artifacts/{artifact_id}")
async def read_artifact(session_id: str, artifact_id: str, request: Request, ctx: AppContextDep) -> PlainTextResponse:
    actor = request_actor(request, ctx.auth_store)
    get_session_for_actor(ctx.session_store, session_id, actor)
    try:
        return PlainTextResponse(ctx.session_store.read_artifact(session_id, artifact_id))
    except Exception:
        raise HTTPException(404, "Artifact not found.")
