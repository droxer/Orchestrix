from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse, StreamingResponse
from loguru import logger

from ..controller import SessionArchivedError, SessionController, SessionRunInFlightError
from ..models import AGENT_NAMES
from ..stores import valid_agent
from .deps import AppContextDep
from .helpers import (
    assignment_list,
    get_session_for_actor,
    get_task_for_actor,
    json_body,
    owner_employee_id_for_create,
    request_actor_or_sandbox,
    role_name,
    string_field,
)

router = APIRouter()


@router.get("/sessions")
async def list_sessions(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    return {"sessions": [session for session in ctx.session_store.list_sessions() if actor["isAdmin"] or session.get("ownerEmployeeId") == actor["employeeId"]]}


@router.post("/sessions", status_code=201)
async def create_session(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
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
    )
    if assignments:
        controller.assign_session(session["id"], assignments)
    logger.info("Session created", session_id=session["id"], workspace_path=workspace_path, owner=owner)
    return ctx.session_store.get_session(session["id"])


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    return get_session_for_actor(ctx.session_store, session_id, actor)


@router.post("/sessions/{session_id}/assignments")
async def assign_session(session_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    get_session_for_actor(ctx.session_store, session_id, actor)
    body = await json_body(request)
    assignments = assignment_list(body.get("assignments"))
    if not assignments:
        raise HTTPException(400, "assignments must include at least one agent.")
    controller = SessionController(ctx.session_store, task_store=ctx.task_store, owner_employee_id=actor["employeeId"])
    try:
        controller.assign_session(session_id, assignments)
    except SessionArchivedError:
        raise HTTPException(409, "Session is archived.")
    except SessionRunInFlightError:
        raise HTTPException(409, "Session has a run in flight.")
    return ctx.session_store.get_session(session_id)


@router.post("/sessions/{session_id}/archive")
async def archive_session(session_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    get_session_for_actor(ctx.session_store, session_id, actor)
    controller = SessionController(
        ctx.session_store,
        task_store=ctx.task_store,
        owner_employee_id=actor["employeeId"],
    )
    return controller.archive_session(session_id)


@router.post("/sessions/{session_id}/title")
async def rename_session(session_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    get_session_for_actor(ctx.session_store, session_id, actor)
    body = await json_body(request)
    title = string_field(body, "title").strip()
    if not title:
        raise HTTPException(400, "title is required.")
    if len(title) > 200:
        raise HTTPException(400, "title must be 200 characters or fewer.")
    controller = SessionController(
        ctx.session_store,
        task_store=ctx.task_store,
        owner_employee_id=actor["employeeId"],
    )
    return controller.rename_session(session_id, title)


@router.post("/sessions/{session_id}/decisions")
async def decision(session_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
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
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    get_session_for_actor(ctx.session_store, session_id, actor)
    body = await json_body(request)
    target_agent = valid_agent(body.get("targetAgent"))
    if not target_agent:
        raise HTTPException(400, f"targetAgent must be one of: {', '.join(AGENT_NAMES)}.")
    mode = "review" if body.get("mode") == "review" else "action"
    controller = SessionController(ctx.session_store, task_store=ctx.task_store, owner_employee_id=actor["employeeId"])
    result = controller.handoff_session(
        session_id,
        target_agent,
        [{"agent": target_agent, "mode": mode, "role": role_name(body.get("role"))}],
        string_field(body, "note") or None,
    )
    logger.info("Session handoff recorded", session_id=session_id, target_agent=target_agent, mode=mode)
    return result


# Session lifecycle states after which no further events are appended; the
# stream flushes the backlog and closes when it sees one of these.
TERMINAL_SESSION_STATUSES = frozenset({"completed", "failed", "cancelled"})
_STREAM_POLL_SECONDS = 1.0
_STREAM_HEARTBEAT_SECONDS = 15.0
_STREAM_MAX_SECONDS = 60 * 30


def _sse_frame(data: dict[str, Any], *, event: str | None = None) -> str:
    prefix = f"event: {event}\n" if event else ""
    return f"{prefix}data: {json.dumps(data)}\n\n"


@router.get("/sessions/{session_id}/events")
async def session_events(session_id: str, request: Request, ctx: AppContextDep) -> StreamingResponse:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    # Authorize before the stream opens so 403/404 surface as normal responses.
    get_session_for_actor(ctx.session_store, session_id, actor)

    async def event_stream() -> AsyncIterator[str]:
        # Server-side tail-poll: re-read the materialized session each tick and
        # emit only newly-appended events (by index). This moves the poll off N
        # browser clients and onto one short loop per open stream, and lets the
        # active conversation update at push latency instead of the list poll's
        # cadence. The store rewrites the snapshot on every append, and
        # get_session reads it fresh, so new events are visible here.
        sent = 0
        start = time.monotonic()
        last_heartbeat = start
        while True:
            if await request.is_disconnected():
                return
            try:
                session = get_session_for_actor(ctx.session_store, session_id, actor)
            except HTTPException:
                return
            events = session.get("events", [])
            if len(events) > sent:
                for event in events[sent:]:
                    yield _sse_frame(event)
                sent = len(events)
                last_heartbeat = time.monotonic()
            status = session.get("status")
            if status in TERMINAL_SESSION_STATUSES:
                yield _sse_frame({"status": status}, event="done")
                return
            now = time.monotonic()
            if now - last_heartbeat >= _STREAM_HEARTBEAT_SECONDS:
                yield _sse_frame({"timestamp": datetime.utcnow().isoformat() + "Z"}, event="heartbeat")
                last_heartbeat = now
            if now - start >= _STREAM_MAX_SECONDS:
                yield _sse_frame({"status": status, "reason": "timeout"}, event="done")
                return
            await asyncio.sleep(_STREAM_POLL_SECONDS)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/sessions/{session_id}/artifacts/{artifact_id}")
async def read_artifact(session_id: str, artifact_id: str, request: Request, ctx: AppContextDep) -> PlainTextResponse:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    get_session_for_actor(ctx.session_store, session_id, actor)
    try:
        return PlainTextResponse(ctx.session_store.read_artifact(session_id, artifact_id))
    except Exception:
        raise HTTPException(404, "Artifact not found.")
