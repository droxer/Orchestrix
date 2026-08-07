from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from loguru import logger

from ..persistence.agent_placement_store import create_node_placement, placement_status
from ..security.auth import require_admin_session
from ..services.agent_routing import (
    AgentRoutingError,
    resolve_agent_assignments,
    resolve_session_daemon_node_id,
)
from ..services.computer_names import computer_display_name
from ..services.team_membership import remove_agent_from_teams
from ..services.team_placement import (
    TeamPlacementError,
    active_placement_node_id,
    assert_teams_stay_colocated,
    teams_blocking_placement_change,
)
from ..sessions.controller import SessionController
from .deps import AppContextDep
from .helpers import (
    agent_task_mode,
    get_session_for_actor,
    json_body,
    request_actor,
    role_name,
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
    # Placing an agent on a different computer moves it off the old one, so a
    # single-agent placement is also the moment a team can be split.
    if active_placement_node_id(ctx.agent_placement_store, agent_id) != node["id"]:
        _assert_teams_stay_colocated(ctx, agent, node["id"])
    try:
        placement = create_node_placement(
            ctx.agent_placement_store, agent, node, body
        )
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
    if body.get("desiredState") == "removed":
        _assert_placement_removal_keeps_teams_intact(ctx, placement_id)
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
    _assert_placement_removal_keeps_teams_intact(ctx, placement_id)
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
    raw_assignments = body.get("assignments")
    if not task_goal or not isinstance(raw_assignments, list) or not raw_assignments:
        raise HTTPException(400, "taskGoal and at least one assignment are required.")
    idempotency_key = string_field(body, "idempotencyKey") or string_field(
        body, "idempotency_key"
    )
    if idempotency_key:
        existing = ctx.backend.idempotent_run(idempotency_key, actor["employeeId"])
        if existing:
            return existing
    session_id = string_field(body, "sessionId") or string_field(body, "session_id")
    session = (
        get_session_for_actor(ctx.session_store, session_id, actor)
        if session_id
        else None
    )
    if session and not session.get("managedNodeId") and session.get("daemonNodeId"):
        managed_node_id = ctx.registry.daemon_store.historical_managed_node_id(
            session["daemonNodeId"]
        )
        if managed_node_id:
            session = SessionController(ctx.session_store).record_runtime_affinity(
                session["id"], managed_node_id
            )
    requested_node_id = string_field(body, "daemonNodeId") or string_field(
        body, "daemon_node_id"
    )
    daemon_nodes = ctx.registry.monitor_nodes()
    session_node_id = resolve_session_daemon_node_id(
        session,
        ctx.agent_placement_store,
        daemon_nodes,
        ctx.registry.daemon_store,
    )
    requested_original_runtime = bool(
        session
        and session.get("managedNodeId")
        and requested_node_id == session.get("daemonNodeId")
    )
    if (
        session_node_id
        and requested_node_id
        and requested_node_id != session_node_id
        and not requested_original_runtime
    ):
        raise HTTPException(
            409,
            {
                "code": "workspace_unavailable",
                "message": (
                    "This thread already runs on another computer. "
                    "Start a new thread to use the selected computer."
                ),
            },
        )
    required_node_id = session_node_id or requested_node_id
    assignments = []
    for item in raw_assignments:
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("agentId"), str)
            or not item["agentId"]
        ):
            raise HTTPException(400, "Each assignment requires agentId.")
        assignments.append(
            {
                "agentId": item["agentId"],
                **(
                    {"executorKind": item["executorKind"]}
                    if isinstance(item.get("executorKind"), str)
                    and item["executorKind"]
                    else {}
                ),
                "mode": agent_task_mode(item.get("mode")),
                **({"role": item["role"]} if role_name(item.get("role")) else {}),
            }
        )
    try:
        resolved = resolve_agent_assignments(
            assignments,
            employee_id=actor["employeeId"],
            is_admin=actor["isAdmin"],
            agent_store=ctx.agent_store,
            placement_store=ctx.agent_placement_store,
            daemon_nodes=daemon_nodes,
            session=session,
            required_node_id=required_node_id,
            daemon_store=ctx.registry.daemon_store,
            team_store=ctx.team_store,
        )
        parsed: dict[str, Any] = {
            "taskGoal": task_goal,
            "assignments": resolved,
            "actorEmployeeId": actor["employeeId"],
            "actorIsAdmin": actor["isAdmin"],
            "agentFirst": True,
            "daemonNodeId": required_node_id or resolved[0]["daemonNodeId"],
        }
        if session_id:
            parsed["sessionId"] = session_id
        user_message_id = string_field(body, "userMessageId") or string_field(
            body, "user_message_id"
        )
        if user_message_id:
            parsed["userMessageId"] = user_message_id
        if idempotency_key:
            parsed["idempotencyKey"] = idempotency_key
        decision = body.get("decision")
        if isinstance(decision, dict):
            kind = decision.get("kind")
            target_agent = decision.get("targetAgent")
            if kind not in ("rerun", "handoff") or not isinstance(target_agent, str):
                raise HTTPException(
                    400, "decision requires rerun or handoff and targetAgent."
                )
            target_assignment = resolved[0]
            if target_agent != target_assignment["executorKind"]:
                raise HTTPException(
                    400, "decision targetAgent does not match assignment."
                )
            requested_target_id = decision.get("targetAgentId")
            if (
                requested_target_id
                and requested_target_id != target_assignment["agentId"]
            ):
                raise HTTPException(
                    400, "decision targetAgentId does not match assignment."
                )
            parsed["decision"] = {
                "kind": kind,
                "targetAgent": target_assignment["executorKind"],
                "targetAgentId": target_assignment["agentId"],
                **(
                    {"note": decision["note"]}
                    if isinstance(decision.get("note"), str)
                    and decision["note"].strip()
                    else {}
                ),
            }
        return await ctx.backend.run(resolved[0]["daemonNodeId"], parsed)
    except AgentRoutingError as error:
        raise HTTPException(409, {"code": error.code, "message": str(error)}) from error
    except PermissionError as error:
        raise HTTPException(403, str(error)) from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error


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


def _assert_teams_stay_colocated(
    ctx: AppContextDep, agent: dict[str, Any], next_node_id: str | None
) -> None:
    try:
        assert_teams_stay_colocated(
            ctx.team_store, ctx.agent_placement_store, agent, next_node_id
        )
    except TeamPlacementError as error:
        raise HTTPException(409, error.code) from error


def _assert_placement_removal_keeps_teams_intact(
    ctx: AppContextDep, placement_id: str
) -> None:
    placement = ctx.agent_placement_store.get_placement(placement_id)
    if not placement or placement.get("desiredState") == "removed":
        return
    agent = ctx.agent_store.get_agent(placement["agentId"])
    if not agent or agent.get("deletedAt"):
        return
    _assert_teams_stay_colocated(ctx, agent, None)


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
    # defaultRole used to be withheld because nothing acted on it. It now
    # decides what a team member is told to do and which mode it runs in, so
    # the people who own the agent need to see it.
    return {
        **agent,
        "availability": availability,
        "placements": placements,
        # Teams that would be split if this agent gave up its computer. The
        # view carries them so every surface — including an admin looking at
        # another employee's agent — can explain a blocked placement change
        # without fetching teams it cannot see.
        "placementLockedByTeams": [
            team["name"]
            for team in teams_blocking_placement_change(ctx.team_store, agent)
        ],
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
