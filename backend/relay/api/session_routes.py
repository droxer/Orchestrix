from __future__ import annotations

import asyncio
import base64
import json
import time
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from loguru import logger

from ..core.models import AGENT_NAMES
from ..persistence.stores import valid_agent
from ..sessions import SessionArchivedError, SessionController, SessionRunInFlightError
from ..services.team_dispatch import (
    TeamDispatchError,
    task_thread_assignments,
    task_thread_ownership,
)
from .deps import AppContextDep
from .helpers import (
    artifact_index_item,
    assignment_list,
    get_session_for_actor,
    get_task_for_actor,
    agent_task_mode,
    is_workspace_artifact,
    json_body,
    owner_employee_id_for_create,
    request_actor_or_sandbox,
    role_name,
    string_field,
    workspace_artifacts,
)

router = APIRouter()


ACTIVE_TASK_STATUSES = frozenset({"assigned", "running", "waiting_for_human", "review", "blocked"})
ACTIVE_SESSION_STATUSES = frozenset({"running", "waiting_for_human"})


def session_artifact(session: dict[str, Any], artifact_id: str) -> dict[str, Any] | None:
    return next((artifact for artifact in session.get("artifacts", []) if artifact.get("id") == artifact_id), None)


def workspace_artifact_path(session: dict[str, Any], artifact: dict[str, Any]) -> Path | None:
    workspace_path = session.get("workspacePath")
    artifact_path = artifact.get("path")
    if not workspace_path or not artifact_path:
        return None
    try:
        root = Path(str(workspace_path)).resolve()
        path = Path(str(artifact_path))
        if path.is_symlink():
            return None
        target = path.resolve()
    except OSError:
        return None
    if target != root and root not in target.parents:
        return None
    if not target.is_file():
        return None
    return target


def session_brief_item(session: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": session["id"],
        "title": session.get("title"),
        "taskGoal": session.get("taskGoal"),
        "status": session.get("status"),
        "phase": session.get("phase"),
        "workspacePath": session.get("workspacePath"),
        "ownerEmployeeId": session.get("ownerEmployeeId"),
        "ownerAgentId": session.get("ownerAgentId"),
        "teamId": session.get("teamId"),
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
        "assignedAgentId": task.get("assignedAgentId"),
        "assignedTeamId": task.get("assignedTeamId"),
        "dueDate": task.get("dueDate"),
        "isRoutine": task.get("isRoutine", False),
        "routineType": task.get("routineType"),
        "routineCadence": task.get("routineCadence"),
        "routineNextRunDate": task.get("routineNextRunDate"),
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


def managed_agent_workspace_subpath(agent_id: str) -> Path:
    encoded = base64.urlsafe_b64encode(agent_id.encode("utf-8")).decode("ascii").rstrip("=")
    return Path("agents") / f"agent-{encoded}"


def agent_supervisor_employee_id(agent: dict[str, Any]) -> str | None:
    """Return an agent's owner across current and legacy agent snapshots."""
    owner = agent.get("supervisorEmployeeId") or agent.get("employeeId")
    return owner if isinstance(owner, str) and owner else None


def agent_for_workspace(ctx: Any, actor: dict[str, Any], requested_agent: str | None) -> dict[str, Any] | None:
    agent_id = requested_agent.strip() if isinstance(requested_agent, str) else ""
    if not agent_id:
        return None
    agent = ctx.agent_store.get_agent(agent_id)
    if not agent or agent.get("deletedAt"):
        raise HTTPException(404, "Agent not found.")
    if not actor["isAdmin"] and agent_supervisor_employee_id(agent) != actor["employeeId"]:
        raise HTTPException(403, "Cannot read another employee's agent workspace.")
    return agent


def session_uses_agent(session: dict[str, Any], agent_id: str) -> bool:
    return session.get("ownerAgentId") == agent_id or any(
        run.get("logicalAgentId") == agent_id for run in session.get("agentRuns", [])
    )


@router.get("/sessions")
async def list_sessions(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    return {"sessions": [session for session in ctx.session_store.list_sessions() if actor["isAdmin"] or session.get("ownerEmployeeId") == actor["employeeId"]]}


ARTIFACT_INDEX_DEFAULT_LIMIT = 200
ARTIFACT_INDEX_MAX_LIMIT = 1000


def artifact_index_limit(raw: str | None) -> int:
    if raw is None or not raw.strip():
        return ARTIFACT_INDEX_DEFAULT_LIMIT
    try:
        value = int(raw)
    except ValueError:
        raise HTTPException(400, "limit must be an integer.")
    if value < 1:
        raise HTTPException(400, "limit must be at least 1.")
    return min(value, ARTIFACT_INDEX_MAX_LIMIT)


@router.get("/artifacts")
async def list_artifacts(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    requested_employee = request.query_params.get("employeeId")
    if requested_employee and not actor["isAdmin"] and requested_employee != actor["employeeId"]:
        raise HTTPException(403, "Cannot list artifacts for another employee.")
    workspace_path = request.query_params.get("workspacePath")
    limit = artifact_index_limit(request.query_params.get("limit"))
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
    ordered = sorted(artifacts, key=lambda item: item.get("createdAt") or "", reverse=True)
    return {"artifacts": ordered[:limit]}


@router.get("/workspace/brief")
async def workspace_brief(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    requested_team_id = (request.query_params.get("teamId") or "").strip()
    if requested_team_id and request.query_params.get("agentId"):
        raise HTTPException(400, "agentId and teamId cannot be combined.")
    team = ctx.team_store.get_team(requested_team_id) if requested_team_id else None
    if requested_team_id and (not team or team.get("deletedAt")):
        raise HTTPException(404, "Team not found.")
    if team and not actor["isAdmin"] and team.get("ownerEmployeeId") != actor["employeeId"]:
        raise HTTPException(403, "Cannot read another employee's team workspace.")

    agent = agent_for_workspace(ctx, actor, request.query_params.get("agentId"))
    employee_id = (
        team.get("ownerEmployeeId")
        if team
        else agent_supervisor_employee_id(agent)
        if agent
        else employee_for_workspace_brief(actor, request.query_params.get("employeeId"))
    )
    if not employee_id:
        raise HTTPException(404, "Agent owner not found.")

    sessions = [
        session
        for session in ctx.session_store.list_sessions()
        if session.get("ownerEmployeeId") == employee_id
        and (not agent or session_uses_agent(session, agent["id"]))
        and (not team or session.get("teamId") == team["id"])
    ]
    team_session_ids = {session["id"] for session in sessions} if team else set()
    placement_node_ids: set[str] | None = None
    if agent:
        placement_node_ids = {
            placement["daemonNodeId"]
            for placement in ctx.agent_placement_store.list_placements(
                agent_id=agent["id"]
            )
        }
    elif team:
        placement_node_ids = {
            placement["daemonNodeId"]
            for agent_id in team.get("memberAgentIds", [])
            for placement in ctx.agent_placement_store.list_placements(
                agent_id=agent_id
            )
        }
    nodes = []
    for node in ctx.registry.monitor_nodes():
        active_node_runs = node.get("activeRuns", [])
        has_authorized_run = (
            any(
                run.get("currentLogicalAgentId") == agent["id"]
                for run in active_node_runs
            )
            if agent
            else any(
                run.get("sessionId") in team_session_ids for run in active_node_runs
            )
            if team
            else False
        )
        include_node = (
            node.get("employeeId") == employee_id
            if placement_node_ids is None
            else node["id"] in placement_node_ids or has_authorized_run
        )
        if include_node:
            nodes.append(node)
    active_runs = [
        run
        for node in nodes
        for run in node.get("activeRuns", [])
        if (not agent or run.get("currentLogicalAgentId") == agent["id"])
        and (not team or run.get("sessionId") in team_session_ids)
    ]
    tasks = [
        task
        for task in ctx.task_store.list_tasks()
        if (task.get("ownerEmployeeId") == employee_id or task.get("assigneeEmployeeId") == employee_id)
        and (not agent or task.get("assignedAgentId") == agent["id"])
        and (not team or task.get("assignedTeamId") == team["id"])
    ]
    artifacts = [
        artifact_index_item(session, artifact)
        for session in sessions
        for artifact in workspace_artifacts(session)
    ]

    recent_sessions = sorted(sessions, key=lambda item: item.get("updatedAt") or "", reverse=True)[:8]
    active_tasks = [task for task in tasks if task.get("status") in ACTIVE_TASK_STATUSES]
    recent_artifacts = sorted(artifacts, key=lambda item: item.get("createdAt") or "", reverse=True)[:12]

    return {
        "employeeId": employee_id,
        **({"agentId": agent["id"]} if agent else {}),
        **({"teamId": team["id"]} if team else {}),
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


@router.post("/sessions", status_code=201)
async def create_session(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    body = await json_body(request)
    task_goal = string_field(body, "taskGoal")
    if not task_goal:
        raise HTTPException(400, "taskGoal is required.")
    assignments = assignment_list(body.get("assignments"))
    owner_agent_id = next((assignment.get("agentId") for assignment in assignments if assignment.get("agentId")), None)
    workspace_path = string_field(body, "workspacePath") or "/workspace"
    task_id = body.get("taskId") if isinstance(body.get("taskId"), str) else None
    task = get_task_for_actor(ctx.task_store, task_id, actor) if task_id else None
    if task:
        assignments = task_thread_assignments(
            task,
            assignments,
            team_store=ctx.team_store,
            agent_store=ctx.agent_store,
        )
    owner = owner_employee_id_for_create(actor, body)
    thread_ownership = {
        "owner_employee_id": owner,
        **({"owner_agent_id": owner_agent_id} if owner_agent_id else {}),
    }
    if task:
        try:
            thread_ownership = task_thread_ownership(
                task, team_store=ctx.team_store, agent_store=ctx.agent_store
            )
        except TeamDispatchError as error:
            raise HTTPException(409, error.code) from error
        expected_owner = thread_ownership.get("owner_employee_id")
        requested_owner = string_field(body, "ownerEmployeeId") or string_field(body, "employeeId")
        if requested_owner and requested_owner != expected_owner:
            raise HTTPException(403, "Session owner must match the linked task assignee.")
        owner = expected_owner or owner
        if owner and "owner_employee_id" not in thread_ownership:
            thread_ownership["owner_employee_id"] = owner
    controller = SessionController(
        ctx.session_store,
        task_store=ctx.task_store,
        task_id=task_id,
        workspace_path=workspace_path,
        **thread_ownership,
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


@router.post("/sessions/{session_id}/cancel")
async def cancel_session_run(session_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    session = get_session_for_actor(ctx.session_store, session_id, actor)
    body = await json_body(request)
    reason = string_field(body, "reason") or "Cancelled by employee."
    node = next(
        (
            item
            for item in ctx.registry.monitor_nodes()
            if any(run.get("sessionId") == session_id for run in item.get("activeRuns", []))
        ),
        None,
    )
    if not node:
        return session
    return ctx.backend.cancel_run(
        node["id"],
        session_id,
        reason,
        actor_employee_id=None if actor.get("isAdmin") else actor["employeeId"],
    )


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
# Agent subprocesses emit output in small chunks, but this tail loop is the
# final hop before the browser. A one-second interval collects those chunks
# into visible bursts; 100 ms keeps the transcript perceptibly continuous
# without turning an open SSE connection into a busy loop.
_STREAM_POLL_SECONDS = 0.1
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
                yield _sse_frame({"timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}, event="heartbeat")
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
async def read_artifact(session_id: str, artifact_id: str, request: Request, ctx: AppContextDep) -> Any:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    session = get_session_for_actor(ctx.session_store, session_id, actor)
    artifact = session_artifact(session, artifact_id)
    if artifact and is_workspace_artifact(artifact):
        path = workspace_artifact_path(session, artifact)
        if path:
            return FileResponse(
                path,
                media_type=artifact.get("contentType") or "application/octet-stream",
                filename=artifact.get("title") or path.name,
            )
        # The live workspace copy is gone (or lives on another machine); fall
        # back to the content snapshot stored when the artifact was indexed.
        read_content = getattr(ctx.session_store, "read_artifact_content", None)
        content = read_content(session_id, artifact_id) if read_content else None
        if content is not None:
            return Response(content, media_type=artifact.get("contentType") or "application/octet-stream")
        raise HTTPException(404, "Artifact not found.")
    try:
        return PlainTextResponse(ctx.session_store.read_artifact(session_id, artifact_id))
    except (KeyError, FileNotFoundError, OSError):
        raise HTTPException(404, "Artifact not found.")
