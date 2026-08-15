"""Employee soft-delete and the cascade it owns.

Deleting an employee touches five stores: the auth store marks the employee
deleted, the registry unassigns their nodes, their agents are deleted, their
placements removed, their team memberships dropped, and their managed nodes
marked for teardown. Each store used to commit that on its own, so a failure
part-way through left a deleted employee still owning live agents, placements,
and nodes, with no way to finish or undo the rest.

Now the durable work runs in one transaction on the shared engine. The registry
also keeps nodes in memory, which a database rollback cannot undo, so the
affected entries are snapshotted and restored if the transaction fails.
"""

from __future__ import annotations

from contextlib import nullcontext
from typing import Any

from loguru import logger

from ..persistence.store_common import store_transaction
from .team_membership import remove_agent_from_teams

CASCADE_STORES = (
    "auth_store",
    "agent_store",
    "agent_placement_store",
    "team_store",
)


def cascade_engine(ctx: Any) -> Any | None:
    """The engine shared by every store in the cascade, if there is one.

    Returns None when any participant is file-backed or points at a different
    database -- there is no transaction to join, so the cascade behaves as it
    did before.
    """
    engines = []
    for name in CASCADE_STORES:
        engine = getattr(getattr(ctx, name, None), "engine", None)
        if engine is None:
            return None
        engines.append(engine)
    registry_store = getattr(getattr(ctx, "registry", None), "daemon_store", None)
    daemon_engine = getattr(registry_store, "engine", None)
    if daemon_engine is None:
        return None
    engines.append(daemon_engine)

    first = engines[0]
    return first if all(engine is first for engine in engines) else None


def soft_delete_employee(ctx: Any, employee_id: str) -> dict[str, Any]:
    """Soft-delete an employee and everything that hangs off them.

    Raises KeyError if the employee does not exist and ValueError if they are
    already deleted, matching the auth store's own contract.
    """
    engine = cascade_engine(ctx)
    scope = store_transaction(engine) if engine is not None else nullcontext()
    registry = getattr(ctx, "registry", None)
    restore = _registry_snapshot(registry, employee_id)

    try:
        with scope:
            return _cascade(ctx, employee_id)
    except Exception:
        _restore_registry(registry, restore)
        raise


def _cascade(ctx: Any, employee_id: str) -> dict[str, Any]:
    project_store = getattr(ctx, "project_store", None)
    if project_store and project_store.list_projects(
        employee_id, include_archived=True
    ):
        # Project ownership is durable product state. Deleting the employee
        # first would orphan the project and delete the roster agents it still
        # references, so require an explicit archive before cascading.
        raise ValueError("employee_has_projects")
    record = ctx.auth_store.soft_delete_employee(employee_id)
    affected_nodes = ctx.registry.unassign_employee_everywhere(employee_id)

    removed_placements: list[str] = []
    deleted_agents: list[str] = []
    for agent in ctx.agent_store.list_agents(supervisor_employee_id=employee_id):
        for placement in ctx.agent_placement_store.list_placements(agent_id=agent["id"]):
            removed = ctx.agent_placement_store.update_placement(
                placement["id"], {"desiredState": "removed"}
            )
            removed_placements.append(removed["id"])
        deleted = ctx.agent_store.delete_agent(agent["id"])
        remove_agent_from_teams(ctx.team_store, agent["id"], employee_id)
        deleted_agents.append(deleted["id"])

    deleted_managed_nodes: list[str] = []
    for node in ctx.managed_node_store.list_nodes():
        if node.get("employeeId") != employee_id:
            continue
        deleted = ctx.managed_node_store.update_node(
            node["id"], {"desiredState": "deleted"}
        )
        daemon_node_id = deleted.get("activeDaemonNodeId")
        if daemon_node_id and ctx.registry.get(daemon_node_id):
            ctx.registry.fence_managed_node(daemon_node_id)
        deleted_managed_nodes.append(deleted["id"])

    return {
        "employee": record,
        "unassignedNodes": affected_nodes,
        "deletedAgents": deleted_agents,
        "removedPlacements": removed_placements,
        "deletedManagedNodes": deleted_managed_nodes,
    }


def _registry_snapshot(
    registry: Any, employee_id: str
) -> dict[str, dict[str, Any]] | None:
    sandboxes = getattr(registry, "sandboxes", None)
    if sandboxes is None:
        return None
    # Every node is captured, not just this employee's: fencing a managed node
    # can touch one whose employeeId was already cleared.
    return {node_id: dict(node) for node_id, node in sandboxes.items()}


def _restore_registry(registry: Any, snapshot: dict[str, dict[str, Any]] | None) -> None:
    if snapshot is None:
        return
    sandboxes = getattr(registry, "sandboxes", None)
    if sandboxes is None:
        return
    sandboxes.clear()
    sandboxes.update(snapshot)
    logger.warning("Restored in-memory daemon nodes after a failed employee delete")
