"""Thread-scoped workspace browsing through live daemon reads or snapshots."""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from ..core.ids import new_database_id
from ..services.agent_routing import (
    resolve_legacy_session_computer_id,
    resolve_session_daemon_node_id,
)
from ..services.agent_workspace_snapshot import snapshot_file, snapshot_listing
from .deps import AppContext, AppContextDep
from .helpers import (
    artifact_index_item,
    request_actor,
    workspace_artifacts,
)
from .session_routes import agent_supervisor_employee_id
from .workspace_transport import (
    WORKSPACE_FILE_PREVIEW_LIMIT,
    dispatch_workspace_command,
    live_workspace_file,
    live_workspace_listing,
    raise_workspace_error,
    workspace_path,
    workspace_timestamp,
)

router = APIRouter()
THREAD_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$")


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
        raise HTTPException(403, "Cannot read another employee's thread workspace.")
    return agent


def _scope(request: Request) -> str:
    raw = (request.query_params.get("scope") or "agent-home").strip()
    if raw not in ("agent-home", "shared"):
        raise HTTPException(400, "Workspace scope must be agent-home or shared.")
    return raw


def _thread_session(
    ctx: AppContext, request: Request, agent_id: str, scope: str
) -> tuple[str, dict[str, Any]]:
    thread_id = (request.query_params.get("threadId") or "").strip()
    if not thread_id:
        raise HTTPException(400, "threadId is required for workspace access.")
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
    team_id = (request.query_params.get("teamId") or "").strip()
    team_participates = False
    if team_id:
        if scope != "shared":
            raise HTTPException(400, "teamId requires shared workspace scope.")
        team = ctx.team_store.get_team(team_id)
        actor = request_actor(request, ctx.auth_store)
        if (
            not team
            or team.get("deletedAt")
            or session.get("teamId") != team_id
            or agent_id not in team.get("memberAgentIds", [])
            or (
                not actor["isAdmin"]
                and team.get("ownerEmployeeId") != actor["employeeId"]
            )
        ):
            raise HTTPException(404, "Team workspace thread not found.")
        team_participates = True
    project_participates = False
    project_id = session.get("projectId")
    if project_id:
        project = ctx.project_store.get_project(project_id)
        actor = request_actor(request, ctx.auth_store)
        project_participates = bool(
            project
            and (
                actor["isAdmin"]
                or project.get("ownerEmployeeId") == actor["employeeId"]
            )
            and any(
                member.get("agentId") == agent_id and member.get("enabled", True)
                for member in project.get("members", [])
            )
        )
    participates = project_participates if project_id else (
        team_participates
        or session.get("ownerAgentId") == agent_id
        or any(
            run.get("logicalAgentId") == agent_id
            for run in session.get("agentRuns", [])
        )
    )
    if not participates:
        raise HTTPException(404, "Agent has no workspace in this thread.")
    return thread_id, session


def _select_thread_node(
    ctx: AppContext, session: dict[str, Any], scope: str
) -> dict[str, Any] | None:
    workspace_layout = session.get("workspaceLayout")
    if workspace_layout not in ("thread", "project"):
        return None
    capability = "workspace-read-shared" if scope == "shared" else "workspace-read"
    nodes = ctx.registry.monitor_nodes()
    nodes_by_id = {node["id"]: node for node in nodes}
    # Read-only recovery for sessions that predate Task 5's computerId
    # backfill; never persists, so it cannot trip the write-once guard in
    # SessionController.record_runtime_affinity. See
    # resolve_legacy_session_computer_id's docstring for why this route
    # needs its own recovery instead of relying on collaboration's
    # _backfill_runtime_affinity.
    identity = resolve_legacy_session_computer_id(
        session, ctx.agent_placement_store, nodes_by_id, ctx.registry.daemon_store
    )
    effective_session = (
        {**session, "computerId": identity}
        if identity and identity != session.get("computerId")
        else session
    )
    node_id = resolve_session_daemon_node_id(effective_session, nodes)
    node = next((item for item in nodes if item["id"] == node_id), None)
    if (
        node is None
        or not node.get("online")
        or node.get("stale")
        or capability not in (node.get("capabilities") or [])
        or (
            "project-workspaces"
            if workspace_layout == "project"
            else "thread-workspaces"
        )
        not in (node.get("capabilities") or [])
    ):
        return None
    return node


def _scope_command(
    scope: str,
    agent_id: str,
    thread_id: str,
    workspace_layout: str,
    workspace_subpath: str | None = None,
) -> dict[str, Any]:
    return {
        "agentId": agent_id,
        **({"scope": "shared"} if scope == "shared" else {}),
        "sessionId": thread_id,
        "workspaceLayout": workspace_layout,
        **({"workspaceSubpath": workspace_subpath} if workspace_subpath else {}),
    }


def _snapshot_artifacts(
    ctx: AppContext, agent_id: str, session: dict[str, Any]
) -> list[dict[str, Any]]:
    return [
        artifact_index_item(session, artifact)
        for artifact in workspace_artifacts(session)
        if artifact.get("agentId") == agent_id
    ]


@router.get("/agents/{agent_id}/workspace/files")
async def agent_workspace_files(
    agent_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    _authorized_agent(ctx, request, agent_id)
    scope = _scope(request)
    path = workspace_path(request.query_params.get("path"))
    thread_id, session = _thread_session(ctx, request, agent_id, scope)
    node = _select_thread_node(ctx, session, scope)
    if node:
        event = await dispatch_workspace_command(
            ctx,
            node,
            {
                "id": new_database_id(),
                "type": "workspace.list",
                **_scope_command(
                    scope,
                    agent_id,
                    thread_id,
                    session.get("workspaceLayout") or "thread",
                    session.get("workspaceSubpath"),
                ),
                "path": path,
            },
        )
        raise_workspace_error(event)
        return live_workspace_listing(
            event,
            path=path,
            metadata={
                "agentId": agent_id,
                "scope": scope,
                "nodeId": node["id"],
                "threadId": thread_id,
            },
        )
    if scope == "shared":
        # The shared workspace only exists on a live computer; no snapshot fallback.
        raise HTTPException(503, {"reason": "placement-unavailable"})
    artifacts = _snapshot_artifacts(ctx, agent_id, session)
    return {
        "agentId": agent_id,
        "scope": scope,
        "source": "snapshot",
        "threadId": thread_id,
        "path": path,
        "exists": True,
        "entries": snapshot_listing(artifacts, agent_id, path),
        "generatedAt": workspace_timestamp(),
    }


@router.get("/agents/{agent_id}/workspace/file")
async def agent_workspace_file(
    agent_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    _authorized_agent(ctx, request, agent_id)
    scope = _scope(request)
    path = workspace_path(request.query_params.get("path"), required=True)
    thread_id, session = _thread_session(ctx, request, agent_id, scope)
    node = _select_thread_node(ctx, session, scope)
    if node:
        event = await dispatch_workspace_command(
            ctx,
            node,
            {
                "id": new_database_id(),
                "type": "workspace.read",
                **_scope_command(
                    scope,
                    agent_id,
                    thread_id,
                    session.get("workspaceLayout") or "thread",
                    session.get("workspaceSubpath"),
                ),
                "path": path,
            },
        )
        raise_workspace_error(event)
        return live_workspace_file(
            event,
            path=path,
            metadata={
                "agentId": agent_id,
                "scope": scope,
                "nodeId": node["id"],
                "threadId": thread_id,
            },
        )
    if scope == "shared":
        raise HTTPException(503, {"reason": "placement-unavailable"})
    result = snapshot_file(
        ctx.session_store,
        _snapshot_artifacts(ctx, agent_id, session),
        agent_id,
        path,
    )
    if result is None:
        raise HTTPException(404, "Workspace file path was not found.")
    return {
        "agentId": agent_id,
        "scope": scope,
        "source": "snapshot",
        "threadId": thread_id,
        "exists": True,
        **result,
        "limitBytes": WORKSPACE_FILE_PREVIEW_LIMIT,
        "generatedAt": workspace_timestamp(),
    }
