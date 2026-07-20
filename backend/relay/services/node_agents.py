from __future__ import annotations

from typing import Any

from loguru import logger

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
