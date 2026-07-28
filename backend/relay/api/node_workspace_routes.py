"""Admin browsing of a computer's shared workspace through live daemon reads.

The shared workspace is the node workspace root that all agents hosted on the
computer collaborate in. It only exists on a live daemon that advertises the
``workspace-read-shared`` capability; there is no snapshot fallback here —
per-agent artifacts remain the durable record.
"""

from __future__ import annotations

import base64
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from ..core.ids import new_relay_id
from ..security.auth import require_admin_session
from .agent_workspace_routes import (
    WORKSPACE_FILE_PREVIEW_LIMIT,
    _dispatch,
    _path,
    _timestamp,
    _workspace_error,
)
from .deps import AppContextDep

router = APIRouter()


def _shared_capable_node(ctx: Any, node_id: str) -> dict[str, Any]:
    node = next((item for item in ctx.registry.monitor_nodes() if item["id"] == node_id), None)
    if node is None:
        raise HTTPException(404, "Daemon node not found.")
    if not node.get("online") or "workspace-read-shared" not in (node.get("capabilities") or []):
        raise HTTPException(503, {"reason": "placement-unavailable"})
    return node


@router.get("/admin/daemon-nodes/{node_id}/workspace/files")
async def node_workspace_files(node_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    path = _path(request.query_params.get("path"))
    node = _shared_capable_node(ctx, node_id)
    event = await _dispatch(ctx, node, {"id": new_relay_id("cmd"), "type": "workspace.list", "scope": "shared", "path": path})
    _workspace_error(event)
    return {"nodeId": node["id"], "scope": "shared", "source": "live", "path": event.get("path", path), "exists": bool(event.get("exists")), "entries": event.get("entries") or [], "generatedAt": _timestamp()}


@router.get("/admin/daemon-nodes/{node_id}/workspace/file")
async def node_workspace_file(node_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    path = _path(request.query_params.get("path"), required=True)
    node = _shared_capable_node(ctx, node_id)
    event = await _dispatch(ctx, node, {"id": new_relay_id("cmd"), "type": "workspace.read", "scope": "shared", "path": path})
    _workspace_error(event)
    raw = event.get("contentBase64")
    content = base64.b64decode(raw).decode("utf-8", errors="replace") if isinstance(raw, str) else None
    return {"nodeId": node["id"], "scope": "shared", "source": "live", "path": event.get("path", path), "exists": True, "isBinary": bool(event.get("isBinary")), "bytes": event.get("bytes") or 0, "content": content, "truncated": bool(event.get("truncated")), "limitBytes": WORKSPACE_FILE_PREVIEW_LIMIT, "generatedAt": _timestamp()}
