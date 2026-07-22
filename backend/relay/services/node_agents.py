from __future__ import annotations

from typing import Any

from loguru import logger

from .team_membership import remove_agent_from_teams


def assert_node_agent_runs_drained(ctx: Any, node_id: str) -> None:
    registry = getattr(ctx, "registry", None)
    daemon_store = getattr(registry, "daemon_store", None)
    if not daemon_store:
        return
    if any(
        request.get("nodeId") == node_id
        or any(
            assignment.get("daemonNodeId") == node_id
            for assignment in request.get("assignments") or []
        )
        for request in daemon_store.list_active_run_requests()
    ):
        raise ValueError(
            "Daemon node has active agent work. Wait for its runs to finish before deleting it."
        )


def sync_node_agents(ctx: Any, node: dict[str, Any]) -> None:
    """Materialize stable compatibility agents for legacy node capabilities."""
    employee_id = node.get("employeeId")
    if not employee_id:
        return
    supported = set(node.get("supportedAgents") or []) | set(node.get("agents") or {})
    disabled = set(node.get("disabledAgents") or [])
    node_name = node.get("displayName") or node["id"]
    for executor_kind in sorted(supported - disabled):
        try:
            agent = ctx.agent_store.ensure_compatibility_agent(employee_id, executor_kind, node["id"], node_name=node_name)
        except Exception as error:
            if "no such table" in str(error) or "does not exist" in str(error):
                logger.warning("Skipping agent sync during rolling upgrade", node_id=node.get("id"), error=str(error))
                return
            raise
        placement = next((item for item in ctx.agent_placement_store.list_placements(agent_id=agent["id"]) if item["daemonNodeId"] == node["id"]), None)
        if placement is None:
            ctx.agent_placement_store.create_placement(agent, node["id"])
        elif placement.get("desiredState") == "removed":
            ctx.agent_placement_store.update_placement(placement["id"], {"desiredState": "active"})


def remove_node_agents(ctx: Any, node_id: str) -> list[str]:
    """Retire a node's compatibility agents under the dispatch lifecycle lock."""
    registry = getattr(ctx, "registry", None)
    dispatch_lock = getattr(registry, "dispatch_lock", None)
    if dispatch_lock:
        with dispatch_lock:
            return _remove_node_agents_locked(ctx, node_id)
    return _remove_node_agents_locked(ctx, node_id)


def _remove_node_agents_locked(ctx: Any, node_id: str) -> list[str]:
    """Delete agents and placements bound to a deleted computer.

    An agent lives on exactly one computer (one agent = one computer) and its
    home does not migrate, so deleting the computer must retire every agent
    placed on it — compatibility and custom alike — otherwise they linger in
    the roster with no computer to run on. Agents that still hold an active
    placement elsewhere survive. Removed placements are still swept so an
    agent whose node was unassigned first is cleaned up as well.
    """
    assert_node_agent_runs_drained(ctx, node_id)
    removed_agents: list[str] = []
    seen: set[str] = set()
    try:
        placements = ctx.agent_placement_store.list_placements(
            daemon_node_id=node_id, include_removed=True
        )
    except Exception as error:
        if "no such table" in str(error) or "does not exist" in str(error):
            logger.warning("Skipping agent removal during rolling upgrade", node_id=node_id, error=str(error))
            return removed_agents
        raise
    for placement in placements:
        if placement.get("desiredState") != "removed":
            ctx.agent_placement_store.update_placement(placement["id"], {"desiredState": "removed"})
        agent_id = placement.get("agentId")
        if not agent_id or agent_id in seen:
            continue
        seen.add(agent_id)
        agent = ctx.agent_store.get_agent(agent_id)
        active_elsewhere = ctx.agent_placement_store.list_placements(
            agent_id=agent_id
        )
        if (
            agent
            and not agent.get("deletedAt")
            and not active_elsewhere
        ):
            ctx.agent_store.delete_agent(agent_id)
            if getattr(ctx, "team_store", None):
                remove_agent_from_teams(
                    ctx.team_store, agent_id, agent["supervisorEmployeeId"]
                )
            removed_agents.append(agent_id)
    return removed_agents
