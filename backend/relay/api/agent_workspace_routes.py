"""Agent-scoped workspace browsing through live daemon reads or snapshots."""

from __future__ import annotations

import asyncio
import base64
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from ..core.ids import new_database_id
from ..services.agent_routing import (
    resolve_session_daemon_node_id,
)
from ..services.agent_workspace_snapshot import snapshot_file, snapshot_listing
from ..services.event_notifier import workspace_response_key
from ..services.workspace_query import WORKSPACE_COMMAND_TIMEOUT_SECONDS
from .deps import AppContext, AppContextDep
from .helpers import newest_agent_workspace_artifacts, request_actor
from .session_routes import agent_supervisor_employee_id

router = APIRouter()
WORKSPACE_FILE_PREVIEW_LIMIT = 256 * 1024
THREAD_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$")


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _authorized_agent(
    ctx: AppContext, request: Request, agent_id: str
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    agent = ctx.agent_store.get_agent(agent_id)
    if not agent or agent.get("deletedAt"):
        raise HTTPException(404, "Agent not found.")
    if (
        not actor["isAdmin"]
        and agent_supervisor_employee_id(agent) != actor["employeeId"]
    ):
        raise HTTPException(403, "Cannot read another employee's agent workspace.")
    return agent


def _scope(request: Request) -> str:
    raw = (request.query_params.get("scope") or "agent-home").strip()
    if raw not in ("agent-home", "shared"):
        raise HTTPException(400, "Workspace scope must be agent-home or shared.")
    return raw


def _path(raw: str | None, *, required: bool = False) -> str:
    requested = (raw or "").strip()
    if requested.startswith("/") or ".." in requested.split("/"):
        raise HTTPException(
            400, "Workspace path must be relative and must not traverse upward."
        )
    value = requested.strip("/")
    if required and not value:
        raise HTTPException(400, "Workspace file path is required.")
    return value


def _thread_session(
    ctx: AppContext, request: Request, agent_id: str
) -> tuple[str | None, dict[str, Any] | None]:
    thread_id = (request.query_params.get("threadId") or "").strip()
    if not thread_id:
        return None, None
    if (
        not THREAD_ID_PATTERN.fullmatch(thread_id)
        or thread_id in (".", "..")
        or thread_id.endswith(".")
    ):
        raise HTTPException(400, "Thread id is invalid.")
    try:
        session = ctx.session_store.get_session(thread_id)
    except KeyError as error:
        raise HTTPException(404, "Thread not found.") from error
    participates = session.get("ownerAgentId") == agent_id or any(
        run.get("logicalAgentId") == agent_id
        for run in session.get("agentRuns", [])
    )
    if not participates:
        raise HTTPException(404, "Agent has no workspace in this thread.")
    return thread_id, session


async def _dispatch(
    ctx: AppContext, node: dict[str, Any], command: dict[str, Any]
) -> dict[str, Any]:
    key = workspace_response_key(command["id"])
    deadline = asyncio.get_running_loop().time() + WORKSPACE_COMMAND_TIMEOUT_SECONDS
    enqueued = False
    while True:
        with ctx.control_plane_notifier.observe(key) as observed_version:
            if not enqueued:
                try:
                    await run_in_threadpool(ctx.registry.enqueue, node["id"], command)
                except ValueError as error:
                    raise HTTPException(
                        503, {"reason": "placement-overloaded", "detail": str(error)}
                    ) from error
                enqueued = True
            response = await run_in_threadpool(
                ctx.daemon_store.get_workspace_response, command["id"]
            )
            if response is not None:
                return response
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                raise HTTPException(503, {"reason": "placement-unavailable"})
            await ctx.control_plane_notifier.wait(
                key, observed_version, timeout=remaining
            )


def _workspace_error(event: dict[str, Any]) -> None:
    if event.get("type") != "workspace.error":
        return
    messages = {
        "not-found": (404, "Workspace file path was not found."),
        "is-directory": (400, "Workspace file path is a directory."),
        "invalid-path": (400, "Workspace path is invalid."),
    }
    status, message = messages.get(
        event.get("code"), (502, event.get("message") or "Workspace read failed.")
    )
    raise HTTPException(status, message)


def _select_thread_node(
    ctx: AppContext, session: dict[str, Any], scope: str
) -> dict[str, Any] | None:
    capability = "workspace-read-shared" if scope == "shared" else "workspace-read"
    nodes = ctx.registry.monitor_nodes()
    node_id = resolve_session_daemon_node_id(
        session,
        ctx.agent_placement_store,
        nodes,
        ctx.registry.daemon_store,
    )
    node = next((item for item in nodes if item["id"] == node_id), None)
    if (
        node is None
        or not node.get("online")
        or node.get("stale")
        or capability not in (node.get("capabilities") or [])
    ):
        return None
    return node


def _scope_command(
    scope: str, agent_id: str, thread_id: str | None
) -> dict[str, Any]:
    return {
        "agentId": agent_id,
        **({"scope": "shared"} if scope == "shared" else {}),
        **({"sessionId": thread_id} if thread_id else {}),
    }


@router.get("/agents/{agent_id}/workspace/files")
async def agent_workspace_files(
    agent_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    _authorized_agent(ctx, request, agent_id)
    scope = _scope(request)
    path = _path(request.query_params.get("path"))
    thread_id, session = _thread_session(ctx, request, agent_id)
    # Agent homes are thread-scoped. Without an explicit thread, serve the
    # durable cross-thread artifact view instead of reading the legacy node root.
    node = _select_thread_node(ctx, session, scope) if session else None
    if node:
        event = await _dispatch(
            ctx,
            node,
            {
                "id": new_database_id(),
                "type": "workspace.list",
                **_scope_command(scope, agent_id, thread_id),
                "path": path,
            },
        )
        _workspace_error(event)
        return {
            "agentId": agent_id,
            "scope": scope,
            "source": "live",
            "nodeId": node["id"],
            **({"threadId": thread_id} if thread_id else {}),
            "path": event.get("path", path),
            "exists": bool(event.get("exists")),
            "entries": event.get("entries") or [],
            "generatedAt": _timestamp(),
        }
    if scope == "shared":
        # The shared workspace only exists on a live computer; no snapshot fallback.
        raise HTTPException(503, {"reason": "placement-unavailable"})
    artifacts = newest_agent_workspace_artifacts(ctx.session_store, agent_id)
    return {
        "agentId": agent_id,
        "scope": scope,
        "source": "snapshot",
        "path": path,
        "exists": True,
        "entries": snapshot_listing(artifacts, agent_id, path),
        "generatedAt": _timestamp(),
    }


@router.get("/agents/{agent_id}/workspace/file")
async def agent_workspace_file(
    agent_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    _authorized_agent(ctx, request, agent_id)
    scope = _scope(request)
    path = _path(request.query_params.get("path"), required=True)
    thread_id, session = _thread_session(ctx, request, agent_id)
    node = _select_thread_node(ctx, session, scope) if session else None
    if node:
        event = await _dispatch(
            ctx,
            node,
            {
                "id": new_database_id(),
                "type": "workspace.read",
                **_scope_command(scope, agent_id, thread_id),
                "path": path,
            },
        )
        _workspace_error(event)
        raw = event.get("contentBase64")
        content = (
            base64.b64decode(raw).decode("utf-8", errors="replace")
            if isinstance(raw, str)
            else None
        )
        return {
            "agentId": agent_id,
            "scope": scope,
            "source": "live",
            "nodeId": node["id"],
            **({"threadId": thread_id} if thread_id else {}),
            "path": event.get("path", path),
            "exists": True,
            "isBinary": bool(event.get("isBinary")),
            "bytes": event.get("bytes") or 0,
            "content": content,
            "truncated": bool(event.get("truncated")),
            "limitBytes": WORKSPACE_FILE_PREVIEW_LIMIT,
            "generatedAt": _timestamp(),
        }
    if scope == "shared":
        raise HTTPException(503, {"reason": "placement-unavailable"})
    result = snapshot_file(
        ctx.session_store,
        newest_agent_workspace_artifacts(ctx.session_store, agent_id),
        agent_id,
        path,
    )
    if result is None:
        raise HTTPException(404, "Workspace file path was not found.")
    return {
        "agentId": agent_id,
        "scope": scope,
        "source": "snapshot",
        "exists": True,
        **result,
        "limitBytes": WORKSPACE_FILE_PREVIEW_LIMIT,
        "generatedAt": _timestamp(),
    }
