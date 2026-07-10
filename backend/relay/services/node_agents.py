from __future__ import annotations

from typing import Any

from loguru import logger


def sync_node_agents(ctx: Any, node: dict[str, Any]) -> None:
    """Materialize stable employee-facing agents from daemon capabilities."""
    employee_id = node.get("employeeId")
    if not employee_id:
        return
    capabilities = node.get("agents") or {}
    supported = set(node.get("supportedAgents") or []) | set(capabilities)
    disabled = set(node.get("disabledAgents") or [])
    for executor_kind in sorted(supported - disabled):
        try:
            agent = ctx.employee_agent_store.ensure_compatibility_agent(employee_id, executor_kind)
        except Exception as error:
            # Database deployments upgrade through migrations. Keep node
            # assignment available during a rolling upgrade where the new
            # agent tables have not been created yet.
            if "no such table" in str(error) or "does not exist" in str(error):
                logger.warning(
                    "Skipping agent sync during rolling upgrade: agent tables not yet migrated",
                    node_id=node.get("id"),
                    employee_id=employee_id,
                    error=str(error),
                )
                return
            raise
        placement = next(
            (
                item
                for item in ctx.agent_placement_store.list_placements(agent_id=agent["id"])
                if item["daemonNodeId"] == node["id"]
            ),
            None,
        )
        if placement is None:
            ctx.agent_placement_store.create_placement(agent, node["id"])
        elif placement.get("desiredState") == "removed":
            ctx.agent_placement_store.update_placement(placement["id"], {"desiredState": "active"})
