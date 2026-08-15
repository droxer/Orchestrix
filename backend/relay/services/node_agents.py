from __future__ import annotations

from typing import Any, Protocol

from loguru import logger

from ..core.computer_identity import computer_id
from ..persistence.agent_placement_store import create_node_placement
from ..persistence.protocols import AgentPlacementStore, AgentStore, TeamStore


class NodeAgentRegistry(Protocol):
    daemon_store: Any
    dispatch_lock: Any

    def monitor_nodes(self) -> list[dict[str, Any]]: ...


class NodeAgentContext(Protocol):
    registry: NodeAgentRegistry
    agent_store: AgentStore
    agent_placement_store: AgentPlacementStore
    team_store: TeamStore


def assert_node_agent_runs_drained(ctx: NodeAgentContext, node_id: str) -> None:
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


def employee_is_live(ctx: NodeAgentContext, employee_id: str) -> bool:
    """Whether the employee exists and has not been soft-deleted.

    `employees.deleted_at` only filters listings, so without this check a node
    that keeps registering would backfill placements for an employee's
    already-declared agents even after that employee (and their agents) were
    just deleted.

    `auth_store` is not part of NodeAgentContext, so it is read defensively —
    test doubles and reduced contexts may not carry one.
    """
    auth_store = getattr(ctx, "auth_store", None)
    if auth_store is None:
        return True
    if hasattr(auth_store, "list_employees"):
        # list_employees already excludes soft-deleted rows.
        return any(
            employee.get("id") == employee_id
            for employee in auth_store.list_employees()
        )
    if hasattr(auth_store, "deleted_employee_ids"):
        return employee_id not in auth_store.deleted_employee_ids()
    return True


def sync_node_agents(ctx: NodeAgentContext, node: dict[str, Any]) -> None:
    """Attach this Computer's already-declared agents to its current node.

    Does not create agents — agents are declared explicitly by employees
    (POST /agents). An employee can declare an agent while its computer is
    offline, when there's no node to place it on yet; this backfills that
    once the computer comes online.
    """
    employee_id = node.get("employeeId")
    if not employee_id:
        return
    if not employee_is_live(ctx, employee_id):
        logger.info(
            "Skipping agent sync for a deleted employee",
            node_id=node.get("id"),
            employee_id=employee_id,
        )
        return
    node_computer_id = computer_id(node)
    # node["agents"] always carries every AGENT_NAMES key regardless of what's
    # actually installed (see registry.py / node_backend.py), so folding its
    # full key set into `available` would always add back the entire agent
    # roster — that's the bug Task 4 retires. Only entries whose status is
    # "ready" indicate a runtime this node can actually run; supportedAgents
    # is a convenience field some callers (and older node records) supply
    # directly instead. Mirrors available_runtimes() in agent_creation.py.
    available = set(node.get("supportedAgents") or [])
    available |= {
        kind
        for kind, status in (node.get("agents") or {}).items()
        if status == "ready"
    }
    available -= set(node.get("disabledAgents") or [])
    try:
        owned = ctx.agent_store.list_agents(supervisor_employee_id=employee_id)
    except Exception as error:
        if _missing_agent_table(error):
            logger.warning(
                "Skipping agent sync during rolling upgrade",
                node_id=node.get("id"),
                error=str(error),
            )
            return
        raise
    for agent in owned:
        if agent.get("deletedAt") or agent.get("computerId") != node_computer_id:
            continue
        if agent["executorKind"] not in available:
            continue
        if ctx.agent_placement_store.list_placements(agent_id=agent["id"]):
            continue
        create_node_placement(ctx.agent_placement_store, agent, node)


def _missing_agent_table(error: Exception) -> bool:
    message = str(error)
    return "no such table" in message or "does not exist" in message


def remove_node_agents(ctx: NodeAgentContext, node_id: str) -> list[str]:
    """Retire a node's agents under the dispatch lifecycle lock."""
    registry = getattr(ctx, "registry", None)
    dispatch_lock = getattr(registry, "dispatch_lock", None)
    if dispatch_lock:
        with dispatch_lock:
            return _remove_node_agents_locked(ctx, node_id)
    return _remove_node_agents_locked(ctx, node_id)


def _remove_node_agents_locked(ctx: NodeAgentContext, node_id: str) -> list[str]:
    """Remove placements on a deleted computer, but keep the agent itself.

    Agents are declared explicitly by employees and can only be deleted by
    employees. Once the computer is gone, binding_status marks the agent
    computer_gone and it stays on the roster — the system never erases it.
    """
    assert_node_agent_runs_drained(ctx, node_id)
    orphaned_agents: list[str] = []
    seen: set[str] = set()
    try:
        placements = ctx.agent_placement_store.list_placements(
            daemon_node_id=node_id, include_removed=True
        )
    except Exception as error:
        if "no such table" in str(error) or "does not exist" in str(error):
            logger.warning(
                "Skipping agent removal during rolling upgrade",
                node_id=node_id,
                error=str(error),
            )
            return orphaned_agents
        raise
    for placement in placements:
        if placement.get("desiredState") != "removed":
            ctx.agent_placement_store.update_placement(
                placement["id"], {"desiredState": "removed"}
            )
        agent_id = placement.get("agentId")
        if not agent_id or agent_id in seen:
            continue
        seen.add(agent_id)
        agent = ctx.agent_store.get_agent(agent_id)
        active_elsewhere = ctx.agent_placement_store.list_placements(agent_id=agent_id)
        if agent and not agent.get("deletedAt") and not active_elsewhere:
            orphaned_agents.append(agent_id)
    return orphaned_agents
