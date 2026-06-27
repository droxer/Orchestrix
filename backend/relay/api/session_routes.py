from __future__ import annotations

import asyncio
import json
import stat
import time
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse, StreamingResponse
from loguru import logger

from ..core.models import AGENT_NAMES
from ..persistence.stores import valid_agent
from ..sessions import SessionArchivedError, SessionController, SessionRunInFlightError
from .deps import AppContextDep
from .helpers import (
    assignment_list,
    get_session_for_actor,
    get_task_for_actor,
    agent_task_mode,
    json_body,
    owner_employee_id_for_create,
    request_actor_or_sandbox,
    role_name,
    string_field,
)

router = APIRouter()


ACTIVE_TASK_STATUSES = frozenset({"assigned", "running", "waiting_for_human", "review", "blocked"})
ACTIVE_SESSION_STATUSES = frozenset({"running", "waiting_for_human"})
WORKSPACE_FILE_LIMIT = 200
WORKSPACE_FILE_PREVIEW_LIMIT = 256 * 1024  # 256 KB cap for inline file previews
# Internal run transcripts — stored for bridge/replay but not user-facing outputs.
WORKSPACE_HIDDEN_ARTIFACT_KINDS = frozenset({"command_log"})


def is_workspace_artifact(artifact: dict[str, Any]) -> bool:
    return artifact.get("kind") not in WORKSPACE_HIDDEN_ARTIFACT_KINDS


def workspace_artifacts(session: dict[str, Any]) -> list[dict[str, Any]]:
    return [artifact for artifact in session.get("artifacts", []) if is_workspace_artifact(artifact)]


def artifact_index_item(session: dict[str, Any], artifact: dict[str, Any]) -> dict[str, Any]:
    return {
        **artifact,
        "sessionId": session["id"],
        "sessionTitle": session.get("title"),
        "taskGoal": session.get("taskGoal"),
        "ownerEmployeeId": session.get("ownerEmployeeId"),
        "workspacePath": session.get("workspacePath"),
        "sessionUpdatedAt": session.get("updatedAt"),
    }


def session_brief_item(session: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": session["id"],
        "title": session.get("title"),
        "taskGoal": session.get("taskGoal"),
        "status": session.get("status"),
        "phase": session.get("phase"),
        "workspacePath": session.get("workspacePath"),
        "ownerEmployeeId": session.get("ownerEmployeeId"),
        "currentAgent": session.get("currentAgent"),
        "pendingDecision": session.get("pendingDecision"),
        "artifactCount": len(workspace_artifacts(session)),
        "runCount": len(session.get("agentRuns", [])),
        "updatedAt": session.get("updatedAt"),
        "createdAt": session.get("createdAt"),
    }


def task_brief_item(task: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": task["id"],
        "title": task.get("title"),
        "status": task.get("status"),
        "priority": task.get("priority"),
        "ownerEmployeeId": task.get("ownerEmployeeId"),
        "assigneeEmployeeId": task.get("assigneeEmployeeId"),
        "assignedAgent": task.get("assignedAgent"),
        "dueDate": task.get("dueDate"),
        "isRoutine": task.get("isRoutine", False),
        "routineEnabled": task.get("routineEnabled", False),
        "linkedSessionIds": task.get("linkedSessionIds", []),
        "updatedAt": task.get("updatedAt"),
        "createdAt": task.get("createdAt"),
    }


def employee_for_workspace_brief(actor: dict[str, Any], requested_employee: str | None) -> str:
    requested = requested_employee.strip() if isinstance(requested_employee, str) else ""
    if requested and actor["isAdmin"]:
        return requested
    if requested and requested != actor["employeeId"]:
        raise HTTPException(403, "Cannot read another employee's workspace.")
    return actor["employeeId"]


def workspace_path_for_employee(ctx: Any, employee_id: str) -> str:
    nodes = [node for node in ctx.registry.monitor_nodes() if node.get("employeeId") == employee_id]
    primary_node = nodes[0] if nodes else None
    sessions = [session for session in ctx.session_store.list_sessions() if session.get("ownerEmployeeId") == employee_id]
    return (
        (primary_node or {}).get("workspacePath")
        or next((session.get("workspacePath") for session in sessions if session.get("workspacePath")), None)
        or "/workspace"
    )


def workspace_file_timestamp(value: float) -> str:
    return datetime.fromtimestamp(value, timezone.utc).isoformat().replace("+00:00", "Z")


def workspace_file_item(root: Path, entry: Path) -> dict[str, Any] | None:
    try:
        info = entry.lstat()
    except OSError:
        return None
    mode = info.st_mode
    kind = (
        "directory" if stat.S_ISDIR(mode)
        else "file" if stat.S_ISREG(mode)
        else "symlink" if stat.S_ISLNK(mode)
        else "other"
    )
    return {
        "name": entry.name,
        "path": entry.relative_to(root).as_posix(),
        "kind": kind,
        "bytes": None if kind == "directory" else info.st_size,
        "updatedAt": workspace_file_timestamp(info.st_mtime),
    }


def workspace_target_path(root: Path, relative_path: str) -> tuple[Path, Path]:
    requested = relative_path.strip().strip("/")
    if Path(requested).is_absolute():
        raise HTTPException(400, "Workspace file path must be relative.")
    root_resolved = root.resolve()
    target = (root_resolved / requested).resolve()
    if target != root_resolved and root_resolved not in target.parents:
        raise HTTPException(403, "Workspace file path escapes the workspace.")
    return root_resolved, target


@router.get("/sessions")
async def list_sessions(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    return {"sessions": [session for session in ctx.session_store.list_sessions() if actor["isAdmin"] or session.get("ownerEmployeeId") == actor["employeeId"]]}


@router.get("/artifacts")
async def list_artifacts(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    requested_employee = request.query_params.get("employeeId")
    if requested_employee and not actor["isAdmin"] and requested_employee != actor["employeeId"]:
        raise HTTPException(403, "Cannot list artifacts for another employee.")
    workspace_path = request.query_params.get("workspacePath")
    artifacts: list[dict[str, Any]] = []
    for session in ctx.session_store.list_sessions():
        owner = session.get("ownerEmployeeId")
        if not actor["isAdmin"] and owner != actor["employeeId"]:
            continue
        if requested_employee and owner != requested_employee:
            continue
        if workspace_path and session.get("workspacePath") != workspace_path:
            continue
        for artifact in workspace_artifacts(session):
            artifacts.append(artifact_index_item(session, artifact))
    return {"artifacts": sorted(artifacts, key=lambda item: item.get("createdAt") or "", reverse=True)}


@router.get("/workspace/brief")
async def workspace_brief(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    employee_id = employee_for_workspace_brief(actor, request.query_params.get("employeeId"))

    nodes = [node for node in ctx.registry.monitor_nodes() if node.get("employeeId") == employee_id]
    primary_node = nodes[0] if nodes else None
    active_runs = [run for node in nodes for run in node.get("activeRuns", [])]

    sessions = [session for session in ctx.session_store.list_sessions() if session.get("ownerEmployeeId") == employee_id]
    tasks = [
        task
        for task in ctx.task_store.list_tasks()
        if task.get("ownerEmployeeId") == employee_id or task.get("assigneeEmployeeId") == employee_id
    ]
    artifacts = [
        artifact_index_item(session, artifact)
        for session in sessions
        for artifact in workspace_artifacts(session)
    ]

    workspace_path = workspace_path_for_employee(ctx, employee_id)
    recent_sessions = sorted(sessions, key=lambda item: item.get("updatedAt") or "", reverse=True)[:8]
    active_tasks = [task for task in tasks if task.get("status") in ACTIVE_TASK_STATUSES]
    recent_artifacts = sorted(artifacts, key=lambda item: item.get("createdAt") or "", reverse=True)[:12]

    return {
        "employeeId": employee_id,
        "workspacePath": workspace_path,
        "primaryNode": primary_node,
        "nodes": nodes,
        "activeRuns": sorted(active_runs, key=lambda item: item.get("startedAt") or "", reverse=True),
        "sessions": [session_brief_item(session) for session in recent_sessions],
        "tasks": [task_brief_item(task) for task in sorted(active_tasks, key=lambda item: item.get("updatedAt") or "", reverse=True)[:10]],
        "artifacts": recent_artifacts,
        "metrics": {
            "nodeCount": len(nodes),
            "activeRunCount": len(active_runs),
            "sessionCount": len(sessions),
            "activeSessionCount": len([session for session in sessions if session.get("status") in ACTIVE_SESSION_STATUSES]),
            "taskCount": len(tasks),
            "activeTaskCount": len(active_tasks),
            "artifactCount": len(artifacts),
        },
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


@router.get("/workspace/files")
async def workspace_files(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    employee_id = employee_for_workspace_brief(actor, request.query_params.get("employeeId"))
    workspace_path = workspace_path_for_employee(ctx, employee_id)
    root = Path(workspace_path)
    relative_path = request.query_params.get("path") or ""

    if not root.exists():
        return {
            "employeeId": employee_id,
            "workspacePath": workspace_path,
            "path": "",
            "exists": False,
            "entries": [],
            "limit": WORKSPACE_FILE_LIMIT,
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }

    root_resolved, target = workspace_target_path(root, relative_path)
    if not target.exists():
        raise HTTPException(404, "Workspace file path was not found.")
    if not target.is_dir():
        raise HTTPException(400, "Workspace file path must be a directory.")

    entries: list[dict[str, Any]] = []
    try:
        for entry in target.iterdir():
            item = workspace_file_item(root_resolved, entry)
            if item:
                entries.append(item)
    except OSError as exc:
        raise HTTPException(400, f"Cannot list workspace files: {exc}") from exc

    entries.sort(key=lambda item: (item["kind"] != "directory", item["name"].lower()))
    return {
        "employeeId": employee_id,
        "workspacePath": workspace_path,
        "path": "" if target == root_resolved else target.relative_to(root_resolved).as_posix(),
        "exists": True,
        "entries": entries[:WORKSPACE_FILE_LIMIT],
        "limit": WORKSPACE_FILE_LIMIT,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


@router.get("/workspace/file")
async def workspace_file(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    employee_id = employee_for_workspace_brief(actor, request.query_params.get("employeeId"))
    relative_path = (request.query_params.get("path") or "").strip()
    if not relative_path:
        raise HTTPException(400, "Workspace file path is required.")

    workspace_path = workspace_path_for_employee(ctx, employee_id)
    root = Path(workspace_path)
    if not root.exists():
        raise HTTPException(404, "Workspace file path was not found.")

    root_resolved, target = workspace_target_path(root, relative_path)
    if not target.exists():
        raise HTTPException(404, "Workspace file path was not found.")
    if target.is_dir():
        raise HTTPException(400, "Workspace file path is a directory.")
    if not target.is_file():
        raise HTTPException(400, "Workspace file path is not a regular file.")

    try:
        size = target.stat().st_size
        with target.open("rb") as handle:
            raw = handle.read(WORKSPACE_FILE_PREVIEW_LIMIT)
    except OSError as exc:
        raise HTTPException(400, f"Cannot read workspace file: {exc}") from exc

    is_binary = b"\x00" in raw
    content: str | None = None
    if not is_binary:
        try:
            content = raw.decode("utf-8")
        except UnicodeDecodeError:
            is_binary = True

    return {
        "employeeId": employee_id,
        "workspacePath": workspace_path,
        "path": target.relative_to(root_resolved).as_posix(),
        "exists": True,
        "isBinary": is_binary,
        "bytes": size,
        "content": content,
        "truncated": size > WORKSPACE_FILE_PREVIEW_LIMIT,
        "limitBytes": WORKSPACE_FILE_PREVIEW_LIMIT,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


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
    mode = agent_task_mode(body.get("mode"))
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
    event_id = data.get("id")
    prefix = f"id: {event_id}\n" if isinstance(event_id, str) and event_id else ""
    prefix += f"event: {event}\n" if event else ""
    return f"{prefix}data: {json.dumps(data)}\n\n"


def _event_start_index(events: list[Any], after_event_id: str | None) -> int:
    if not after_event_id:
        return 0
    for index, event in enumerate(events):
        if isinstance(event, dict) and event.get("id") == after_event_id:
            return index + 1
    return 0


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
        after_event_id = request.query_params.get("after") or request.headers.get("last-event-id")
        sent: int | None = None
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
            if sent is None:
                sent = _event_start_index(events, after_event_id)
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
