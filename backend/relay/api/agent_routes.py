from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from loguru import logger

from ..collaboration.models import RunIntent
from ..collaboration.service import CollaborationConductor, CollaborationError
from ..persistence.agent_placement_store import create_node_placement, placement_status
from ..security.auth import require_admin_session
from ..services.computer_names import computer_display_name
from ..services.team_membership import remove_agent_from_teams
from .deps import AppContextDep
from .helpers import (
    json_body,
    request_actor,
    string_field,
)

router = APIRouter()


# What an agent's own supervisor may change. The role belongs here with the
# personality: both describe how their agent works, and the supervisor is the
# person who knows what job it should do on their team.
AGENT_META_FIELDS = frozenset({"displayName", "instructions", "defaultRole"})


@router.get("/agents")
async def list_agents(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    agents = ctx.agent_store.list_agents(supervisor_employee_id=actor["employeeId"])
    live_node_ids = {node["id"] for node in ctx.registry.monitor_nodes()}
    views = [
        _agent_with_placements(ctx, agent)
        for agent in agents
        if agent.get("enabled", True)
    ]

    def _on_live_computer(view: dict[str, Any]) -> bool:
        return any(
            placement.get("daemonNodeId") in live_node_ids
            for placement in view["placements"]
        )

    # A compatibility agent belongs to exactly one computer. Once that computer
    # is gone — unassigned/deleted (placement removed) or no longer registered
    # (an active placement left dangling at a node that vanished) — the agent is
    # stale and must drop out of the roster and the chat header instead of
    # lingering as a struck-through, computer-less entry that inflates the count.
    # An offline-but-registered node still counts as live, so its agent stays
    # (shown disabled). Custom agents (no compatibilityKey) may legitimately have
    # no placement, so they always stay.
    return {
        "agents": [
            view
            for view in views
            if not view.get("compatibilityKey") or _on_live_computer(view)
        ]
    }


@router.patch("/agents/{agent_id}")
async def update_agent(
    agent_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    agent = ctx.agent_store.get_agent(agent_id)
    if not agent or agent.get("deletedAt"):
        raise HTTPException(404, "Agent not found.")
    if agent.get("supervisorEmployeeId") != actor["employeeId"]:
        raise HTTPException(403, "Cannot update another employee's agent.")
    body = await json_body(request)
    unknown = set(body) - AGENT_META_FIELDS
    if unknown:
        raise HTTPException(
            400,
            f"Unsupported agent field(s): {', '.join(sorted(unknown))}.",
        )
    try:
        updated = _update_agent_and_realize_placements(ctx, agent_id, body)
    except ValueError as error:
        raise HTTPException(
            409 if "already has" in str(error) else 400, str(error)
        ) from error
    return {"agent": _agent_with_placements(ctx, updated)}


@router.get("/admin/agents")
async def list_control_panel_agents(
    request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    employee_id = (
        request.query_params.get("employeeId")
        or request.query_params.get("supervisorEmployeeId")
        or None
    )
    return {
        "agents": [
            _agent_with_placements(ctx, agent)
            for agent in ctx.agent_store.list_agents(
                supervisor_employee_id=employee_id, include_deleted=True
            )
        ]
    }


@router.post("/admin/agents", status_code=201)
async def create_control_panel_agent(
    request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    body = await json_body(request)
    employee_id = string_field(body, "supervisorEmployeeId")
    if not _employee_exists(ctx.auth_store, employee_id):
        raise HTTPException(404, "Employee not found.")
    try:
        return {"agent": ctx.agent_store.create_agent(employee_id, body)}
    except ValueError as error:
        raise HTTPException(
            409 if "already has" in str(error) else 400, str(error)
        ) from error


@router.get("/admin/agents/{agent_id}")
async def get_control_panel_agent(
    agent_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    agent = ctx.agent_store.get_agent(agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found.")
    return {"agent": _agent_with_placements(ctx, agent)}


@router.patch("/admin/agents/{agent_id}")
async def update_control_panel_agent(
    agent_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    try:
        return {
            "agent": _update_agent_and_realize_placements(
                ctx, agent_id, await json_body(request)
            )
        }
    except KeyError as error:
        raise HTTPException(404, "Agent not found.") from error
    except ValueError as error:
        raise HTTPException(
            409 if "already has" in str(error) else 400, str(error)
        ) from error


@router.delete("/admin/agents/{agent_id}", status_code=200)
async def delete_control_panel_agent(
    agent_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    agent = ctx.agent_store.get_agent(agent_id)
    if not agent or agent.get("deletedAt"):
        raise HTTPException(404, "Agent not found.")
    if _agent_has_active_run(ctx, agent_id):
        raise HTTPException(
            409,
            "Agent has active work. Wait for its runs to finish before deleting it.",
        )
    try:
        deleted = ctx.agent_store.delete_agent(agent_id)
        ctx.profile_image_store.delete("agents", agent_id)
        remove_agent_from_teams(ctx.team_store, agent_id, agent["supervisorEmployeeId"])
        return {"agent": deleted}
    except KeyError as error:
        raise HTTPException(404, "Agent not found.") from error


@router.get("/admin/agent-placements")
async def list_agent_placements(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    agent_id = request.query_params.get("agentId") or None
    daemon_node_id = request.query_params.get("nodeId") or None
    placements = ctx.agent_placement_store.list_placements(
        agent_id=agent_id,
        daemon_node_id=daemon_node_id,
        include_removed=True,
    )
    return {"placements": [_placement_view(ctx, placement) for placement in placements]}


@router.post("/admin/agents/{agent_id}/placements", status_code=201)
async def create_agent_placement(
    agent_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    agent = ctx.agent_store.get_agent(agent_id)
    if not agent or agent.get("deletedAt"):
        raise HTTPException(404, "Agent not found.")
    body = await json_body(request)
    daemon_node_id = body.get("daemonNodeId")
    if not isinstance(daemon_node_id, str) or not daemon_node_id.strip():
        raise HTTPException(400, "daemonNodeId is required.")
    node = ctx.registry.get(daemon_node_id)
    if not node:
        raise HTTPException(404, "Daemon node not found.")
    try:
        placement = create_node_placement(ctx.agent_placement_store, agent, node, body)
    except ValueError as error:
        raise HTTPException(
            409 if "already has" in str(error) else 400, str(error)
        ) from error
    return {"placement": _placement_view(ctx, placement)}


@router.patch("/admin/agent-placements/{placement_id}")
async def update_agent_placement(
    placement_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    body = await json_body(request)
    try:
        placement = ctx.agent_placement_store.update_placement(placement_id, body)
    except KeyError as error:
        raise HTTPException(404, "Agent placement not found.") from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    return {"placement": _placement_view(ctx, placement)}


@router.delete("/admin/agent-placements/{placement_id}", status_code=200)
async def delete_agent_placement(
    placement_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    try:
        placement = ctx.agent_placement_store.update_placement(
            placement_id, {"desiredState": "removed"}
        )
    except KeyError as error:
        raise HTTPException(404, "Agent placement not found.") from error
    return {"placement": _placement_view(ctx, placement)}


@router.post("/agent-runs", status_code=202)
async def run_logical_agents(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    body = await json_body(request)
    task_goal = string_field(body, "taskGoal") or string_field(body, "task_goal")
    if not task_goal:
        raise HTTPException(400, "taskGoal is required.")
    raw_assignments = body.get("assignments")
    if raw_assignments is not None and not isinstance(raw_assignments, list):
        raise HTTPException(400, "assignments must be a list.")
    decision = body.get("decision")
    try:
        return await CollaborationConductor(ctx).submit(
            RunIntent(
                task_goal=task_goal,
                session_id=string_field(body, "sessionId")
                or string_field(body, "session_id")
                or None,
                raw_assignments=raw_assignments,
                mode=string_field(body, "mode") or "action",
                requested_team_id=string_field(body, "teamId")
                or string_field(body, "team_id")
                or None,
                requested_node_id=string_field(body, "daemonNodeId")
                or string_field(body, "daemon_node_id")
                or None,
                idempotency_key=string_field(body, "idempotencyKey")
                or string_field(body, "idempotency_key")
                or None,
                user_message_id=string_field(body, "userMessageId")
                or string_field(body, "user_message_id")
                or None,
                decision=decision if isinstance(decision, dict) else None,
            ),
            actor,
        )
    except CollaborationError as error:
        detail: Any = (
            str(error)
            if error.status in (400, 403)
            else {"code": error.code, "message": str(error)}
        )
        raise HTTPException(error.status, detail) from error


def _employee_exists(auth_store: Any, employee_id: str) -> bool:
    if hasattr(auth_store, "list_employees"):
        return any(
            employee.get("id") == employee_id
            for employee in auth_store.list_employees()
        )
    if (
        hasattr(auth_store, "deleted_employee_ids")
        and employee_id in auth_store.deleted_employee_ids()
    ):
        return False
    return any(
        user.get("employeeId") == employee_id for user in auth_store.list_users()
    )


def _update_agent_and_realize_placements(
    ctx: AppContextDep, agent_id: str, patch: dict[str, Any]
) -> dict[str, Any]:
    previous = ctx.agent_store.get_agent(agent_id)
    updated = ctx.agent_store.update_agent(agent_id, patch)
    if previous and updated.get("version") != previous.get("version"):
        for placement in ctx.agent_placement_store.list_placements(agent_id=agent_id):
            try:
                ctx.agent_placement_store.realize_agent_version(
                    placement["id"], updated["version"]
                )
            except Exception as error:  # readiness does not depend on this audit field
                logger.warning(
                    "Agent placement version realization deferred",
                    agent_id=agent_id,
                    placement_id=placement["id"],
                    agent_version=updated["version"],
                    error=str(error),
                )
    return updated


def _agent_has_active_run(ctx: AppContextDep, agent_id: str) -> bool:
    return any(
        any(
            assignment.get("agentId") == agent_id
            for assignment in request.get("assignments") or []
        )
        for request in ctx.registry.daemon_store.list_active_run_requests()
    )


def _agent_with_placements(ctx: AppContextDep, agent: dict[str, Any]) -> dict[str, Any]:
    placements = [
        _placement_view(ctx, placement)
        for placement in ctx.agent_placement_store.list_placements(agent_id=agent["id"])
    ]
    availability = "offline"
    if any(placement["status"] == "ready" for placement in placements):
        availability = "ready"
    elif any(placement["status"] == "busy" for placement in placements):
        availability = "busy"
    elif any(placement["status"] == "pending" for placement in placements):
        availability = "pending"
    # The role shapes what a team member is told to contribute, so the people
    # who own the agent need to see it.
    return {
        **agent,
        "availability": availability,
        "placements": placements,
    }


def _placement_view(ctx: AppContextDep, placement: dict[str, Any]) -> dict[str, Any]:
    node = next(
        (
            item
            for item in ctx.registry.monitor_nodes()
            if item["id"] == placement["daemonNodeId"]
        ),
        None,
    )
    agent = ctx.agent_store.get_agent(placement["agentId"])
    view = placement_status(placement, agent, node)
    if not node:
        return {**view, "nodeOwnership": "unknown"}
    return {
        **view,
        "nodeDisplayName": computer_display_name(ctx, node),
        "nodeOwnership": node.get("nodeLocation") or "unknown",
        **(
            {"nodeSandboxMode": node["sandboxMode"]}
            if node.get("sandboxMode") in ("boxlite", "none")
            else {}
        ),
    }
