"""Agent-scoped workspace browsing through live daemon reads or snapshots."""

from __future__ import annotations

import asyncio
import base64
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from ..core.ids import new_relay_id
from ..services.agent_routing import select_workspace_node
from ..services.agent_workspace_snapshot import snapshot_file, snapshot_listing
from ..services.workspace_query import WORKSPACE_COMMAND_TIMEOUT_SECONDS
from .deps import AppContextDep
from .helpers import newest_agent_workspace_artifacts, request_actor
from .session_routes import agent_supervisor_employee_id

router = APIRouter()
WORKSPACE_FILE_PREVIEW_LIMIT = 256 * 1024


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _authorized_agent(ctx: Any, request: Request, agent_id: str) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    agent = ctx.agent_store.get_agent(agent_id)
    if not agent or agent.get("deletedAt"):
        raise HTTPException(404, "Agent not found.")
    if not actor["isAdmin"] and agent_supervisor_employee_id(agent) != actor["employeeId"]:
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
        raise HTTPException(400, "Workspace path must be relative and must not traverse upward.")
    value = requested.strip("/")
    if required and not value:
        raise HTTPException(400, "Workspace file path is required.")
    return value


async def _dispatch(ctx: Any, node: dict[str, Any], command: dict[str, Any]) -> dict[str, Any]:
    future = ctx.workspace_query_broker.register(command["id"], node["id"])
    try:
        ctx.registry.enqueue(node["id"], command)
        return await asyncio.wait_for(future, timeout=WORKSPACE_COMMAND_TIMEOUT_SECONDS)
    except asyncio.TimeoutError as error:
        raise HTTPException(503, {"reason": "placement-unavailable"}) from error
    finally:
        ctx.workspace_query_broker.discard(command["id"])


def _workspace_error(event: dict[str, Any]) -> None:
    if event.get("type") != "workspace.error":
        return
    messages = {"not-found": (404, "Workspace file path was not found."), "is-directory": (400, "Workspace file path is a directory."), "invalid-path": (400, "Workspace path is invalid.")}
    status, message = messages.get(event.get("code"), (502, event.get("message") or "Workspace read failed."))
    raise HTTPException(status, message)


def _select_node(ctx: Any, agent: dict[str, Any], scope: str) -> dict[str, Any] | None:
    capability = "workspace-read-shared" if scope == "shared" else "workspace-read"
    return select_workspace_node(agent, ctx.agent_placement_store, ctx.registry.monitor_nodes(), capability=capability)


def _scope_command(scope: str, agent_id: str) -> dict[str, Any]:
    return {"agentId": agent_id, **({"scope": "shared"} if scope == "shared" else {})}


@router.get("/agents/{agent_id}/workspace/files")
async def agent_workspace_files(agent_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    agent = _authorized_agent(ctx, request, agent_id)
    scope = _scope(request)
    path = _path(request.query_params.get("path"))
    node = _select_node(ctx, agent, scope)
    if node:
        event = await _dispatch(ctx, node, {"id": new_relay_id("cmd"), "type": "workspace.list", **_scope_command(scope, agent_id), "path": path})
        _workspace_error(event)
        return {"agentId": agent_id, "scope": scope, "source": "live", "nodeId": node["id"], "path": event.get("path", path), "exists": bool(event.get("exists")), "entries": event.get("entries") or [], "generatedAt": _timestamp()}
    if scope == "shared":
        # The shared workspace only exists on a live computer; no snapshot fallback.
        raise HTTPException(503, {"reason": "placement-unavailable"})
    artifacts = newest_agent_workspace_artifacts(ctx.session_store, agent_id)
    return {"agentId": agent_id, "scope": scope, "source": "snapshot", "path": path, "exists": True, "entries": snapshot_listing(artifacts, agent_id, path), "generatedAt": _timestamp()}


@router.get("/agents/{agent_id}/workspace/file")
async def agent_workspace_file(agent_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    agent = _authorized_agent(ctx, request, agent_id)
    scope = _scope(request)
    path = _path(request.query_params.get("path"), required=True)
    node = _select_node(ctx, agent, scope)
    if node:
        event = await _dispatch(ctx, node, {"id": new_relay_id("cmd"), "type": "workspace.read", **_scope_command(scope, agent_id), "path": path})
        _workspace_error(event)
        raw = event.get("contentBase64")
        content = base64.b64decode(raw).decode("utf-8", errors="replace") if isinstance(raw, str) else None
        return {"agentId": agent_id, "scope": scope, "source": "live", "nodeId": node["id"], "path": event.get("path", path), "exists": True, "isBinary": bool(event.get("isBinary")), "bytes": event.get("bytes") or 0, "content": content, "truncated": bool(event.get("truncated")), "limitBytes": WORKSPACE_FILE_PREVIEW_LIMIT, "generatedAt": _timestamp()}
    if scope == "shared":
        raise HTTPException(503, {"reason": "placement-unavailable"})
    result = snapshot_file(ctx.session_store, newest_agent_workspace_artifacts(ctx.session_store, agent_id), agent_id, path)
    if result is None:
        raise HTTPException(404, "Workspace file path was not found.")
    return {"agentId": agent_id, "scope": scope, "source": "snapshot", "exists": True, **result, "limitBytes": WORKSPACE_FILE_PREVIEW_LIMIT, "generatedAt": _timestamp()}
