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
from ..services.team_dispatch import (
    TeamDispatchError,
    task_thread_assignments,
    task_thread_ownership,
)
from ..sessions import SessionArchivedError, SessionController, SessionRunInFlightError
from .deps import AppContextDep
from .helpers import (
    agent_task_mode,
    artifact_index_item,
    assignment_list,
    get_session_for_actor,
    get_task_for_actor,
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
        "daemonNodeId": session.get("daemonNodeId"),
        "managedNodeId": session.get("managedNodeId"),
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


def ensure_sessions_managed_affinity(
    ctx: Any, sessions: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    unresolved_runtime_ids = {
        session["daemonNodeId"]
        for session in sessions
        if not session.get("managedNodeId")
        and isinstance(session.get("daemonNodeId"), str)
    }
    if not unresolved_runtime_ids:
        return sessions
    identities = ctx.registry.daemon_store.historical_managed_node_ids(
        unresolved_runtime_ids
    )
    if not identities:
        return sessions
    controller = SessionController(ctx.session_store)
    return [
        controller.record_runtime_affinity(
            session["id"], identities[session["daemonNodeId"]]
        )
        if not session.get("managedNodeId")
        and session.get("daemonNodeId") in identities
        else session
        for session in sessions
    ]


def ensure_session_managed_affinity(ctx: Any, session: dict[str, Any]) -> dict[str, Any]:
    return ensure_sessions_managed_affinity(ctx, [session])[0]


@router.get("/threads")
async def list_sessions(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    visible = [session for session in ctx.session_store.list_sessions() if actor["isAdmin"] or session.get("ownerEmployeeId") == actor["employeeId"]]
    return {"sessions": ensure_sessions_managed_affinity(ctx, visible)}


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
    sessions = ensure_sessions_managed_affinity(ctx, sessions)
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
                run.get("logicalAgentId") == agent["id"]
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
        if (not agent or run.get("logicalAgentId") == agent["id"])
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


@router.post("/threads", status_code=201)
async def create_session(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    body = await json_body(request)
    task_goal = string_field(body, "taskGoal")
    if not task_goal:
        raise HTTPException(400, "taskGoal is required.")
    assignments = assignment_list(body.get("assignments"))
    owner_agent_id = next((assignment.get("agentId") for assignment in assignments if assignment.get("agentId")), None)
    workspace_path = string_field(body, "workspacePath") or "/workspace"
    daemon_node_id = string_field(body, "daemonNodeId") or string_field(
        body, "daemon_node_id"
    )
    managed_node_id = None
    task_id = body.get("taskId") if isinstance(body.get("taskId"), str) else None
    task = get_task_for_actor(ctx.task_store, task_id, actor) if task_id else None
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
            assignments = task_thread_assignments(
                task,
                assignments,
                team_store=ctx.team_store,
                agent_store=ctx.agent_store,
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
    if daemon_node_id:
        node = next(
            (
                item
                for item in ctx.registry.monitor_nodes()
                if item.get("id") == daemon_node_id
            ),
            None,
        )
        if not node or not node.get("online") or node.get("stale"):
            raise HTTPException(
                409,
                {
                    "code": "node_offline",
                    "message": "The selected computer is not available.",
                },
            )
        if owner and node.get("employeeId") != owner:
            raise HTTPException(403, "The selected computer belongs to another employee.")
        managed_node_id = node.get("managedNodeId")
    controller = SessionController(
        ctx.session_store,
        task_store=ctx.task_store,
        task_id=task_id,
        workspace_path=workspace_path,
        daemon_node_id=daemon_node_id,
        managed_node_id=managed_node_id,
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


@router.get("/threads/{session_id}")
async def get_session(session_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    return ensure_session_managed_affinity(
        ctx, get_session_for_actor(ctx.session_store, session_id, actor)
    )


@router.patch("/threads/{session_id}")
async def update_session(
    session_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    get_session_for_actor(ctx.session_store, session_id, actor)
    body = await json_body(request)
    unknown = set(body) - {"title", "archived"}
    if unknown or not body:
        fields = ", ".join(sorted(unknown)) if unknown else "none"
        raise HTTPException(400, f"Unsupported thread field(s): {fields}.")
    controller = SessionController(
        ctx.session_store,
        task_store=ctx.task_store,
        owner_employee_id=actor["employeeId"],
    )
    result = ctx.session_store.get_session(session_id)
    if "title" in body:
        title = string_field(body, "title").strip()
        if not title:
            raise HTTPException(400, "title is required.")
        if len(title) > 200:
            raise HTTPException(400, "title must be 200 characters or fewer.")
        result = controller.rename_session(session_id, title)
    if "archived" in body:
        if body["archived"] is not True:
            raise HTTPException(400, "archived currently supports only true.")
        result = controller.archive_session(session_id)
    return result


@router.post("/threads/{session_id}/cancellations", status_code=202)
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
    run_request = ctx.registry.daemon_store.active_run_request_for_session_any_node(
        session_id
    )
    node_id = node["id"] if node else run_request.get("nodeId") if run_request else None
    if not node_id:
        if session.get("status") in ("completed", "failed", "cancelled"):
            return session
        return SessionController(
            ctx.session_store,
            task_store=ctx.task_store,
            task_id=session.get("taskId"),
            owner_employee_id=actor["employeeId"],
        ).cancel_session(session_id, reason)
    return ctx.backend.cancel_run(
        node_id,
        session_id,
        reason,
        actor_employee_id=None if actor.get("isAdmin") else actor["employeeId"],
    )


@router.post("/threads/{session_id}/assignments")
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


@router.delete("/threads/{session_id}", status_code=204)
async def delete_session(session_id: str, request: Request, ctx: AppContextDep) -> Response:
    actor = request_actor_or_sandbox(request, ctx.auth_store, ctx.registry)
    controller = SessionController(
        ctx.session_store,
        task_store=ctx.task_store,
        owner_employee_id=actor["employeeId"],
    )
    try:
        with ctx.registry.dispatch_lock:
            snapshot = get_session_for_actor(ctx.session_store, session_id, actor)
            if ctx.registry.daemon_store.active_run_request_for_session_any_node(
                session_id
            ):
                raise SessionRunInFlightError(session_id)
            controller.delete_session(session_id, snapshot=snapshot)
    except SessionRunInFlightError:
        raise HTTPException(409, "Session has a run in flight.")
    return Response(status_code=204)


@router.post("/threads/{session_id}/decisions")
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


@router.post("/threads/{session_id}/handoffs")
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


@router.get("/threads/{session_id}/events")
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
        # EventSource keeps the original URL across automatic reconnects but
        # advances Last-Event-ID as frames arrive. Prefer that live cursor over
        # the URL's initial `after` value so a reconnect does not replay the
        # entire stream window.
        after_event_id = request.headers.get("last-event-id") or request.query_params.get("after")
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


@router.get("/threads/{session_id}/artifacts/{artifact_id}")
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
