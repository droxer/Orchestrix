from __future__ import annotations

from typing import Any

from ..daemon_registry.registry import node_accepts_run, workspace_identity
from ..persistence.agent_placement_store import placement_status


class AgentRoutingError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def dispatch_reason_code(code: str) -> str:
    return {
        "agent_configuration_pending": "configuration_pending",
        "executor_not_ready": "agent_offline",
        "node_offline": "agent_offline",
    }.get(code, code)


def dispatch_failure_code(error: Exception) -> str:
    if isinstance(error, AgentRoutingError):
        return dispatch_reason_code(error.code)
    if isinstance(error, PermissionError):
        return "agent_forbidden"
    message = str(error)
    for code in (
        "capacity_exhausted",
        "workspace_unavailable",
        "configuration_pending",
        "agent_offline",
        "agent_forbidden",
    ):
        if code in message:
            return code
    return "dispatch_failed"


def select_workspace_node(
    agent: dict[str, Any],
    placement_store: Any,
    daemon_nodes: list[dict[str, Any]],
    *,
    capability: str = "workspace-read",
) -> dict[str, Any] | None:
    """Return the highest-priority live placement whose node has the read capability."""
    nodes = {node["id"]: node for node in daemon_nodes}
    candidates: list[tuple[int, str, dict[str, Any]]] = []
    for placement in placement_store.list_placements(agent_id=agent["id"]):
        node = nodes.get(placement["daemonNodeId"])
        if not node or capability not in (node.get("capabilities") or []):
            continue
        if placement_status(placement, agent, node)["status"] in ("ready", "busy"):
            candidates.append((int(placement.get("priority") or 100), placement["id"], node))
    return sorted(candidates, key=lambda item: (item[0], item[1]))[0][2] if candidates else None


def resolve_agent_assignments(
    assignments: list[dict[str, Any]],
    *,
    employee_id: str,
    is_admin: bool,
    agent_store: Any,
    placement_store: Any,
    daemon_nodes: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    nodes = {node["id"]: node for node in daemon_nodes}
    resolved: list[dict[str, Any]] = []
    selected_node_ids: set[str] = set()
    selected_workspace: tuple[str, str] | None = None
    selected_workspace_policy: str | None = None
    for assignment in assignments:
        agent_id = assignment.get("agentId")
        if not isinstance(agent_id, str) or not agent_id:
            raise AgentRoutingError(
                "agent_not_found", "agentId is required for agent-first dispatch."
            )
        agent = agent_store.get_agent(agent_id)
        if not agent or agent.get("deletedAt"):
            raise AgentRoutingError(
                "agent_not_found", f"Agent {agent_id} was not found."
            )
        if not is_admin and agent.get("supervisorEmployeeId") != employee_id:
            raise AgentRoutingError(
                "agent_forbidden",
                f"Agent {agent_id} is not available to this employee.",
            )
        if not agent.get("enabled", True):
            raise AgentRoutingError(
                "agent_disabled", f"Agent {agent['displayName']} is disabled."
            )
        requested_kind = assignment.get("executorKind")
        if requested_kind and requested_kind != agent["executorKind"]:
            raise AgentRoutingError(
                "executor_mismatch",
                f"Agent {agent['displayName']} uses {agent['executorKind']}, not {requested_kind}.",
            )
        candidates = []
        rejection_reasons: set[str] = set()
        for placement in placement_store.list_placements(agent_id=agent_id):
            node = nodes.get(placement["daemonNodeId"])
            view = placement_status(placement, agent, node)
            if view["status"] not in ("ready", "busy"):
                rejection_reasons.update(
                    condition["reason"] for condition in view.get("conditions", [])
                )
                continue
            if not node_accepts_run(
                node,
                assignments=[assignment],
                active_runs=node.get("activeRuns") or [],
            ):
                rejection_reasons.add("capacity_exhausted")
                continue
            node_workspace = workspace_identity(node) if node else None
            if (
                selected_node_ids
                and node["id"] not in selected_node_ids
                and (
                    selected_workspace_policy != "shared-path"
                    or (placement.get("workspacePolicy") or {}).get("kind") != "shared-path"
                    or selected_workspace is None
                    or selected_workspace[0] != "id"
                    or node_workspace != selected_workspace
                )
            ):
                rejection_reasons.add("workspace_unavailable")
                continue
            candidates.append((placement, node))
        if not candidates:
            code = _best_rejection_code(rejection_reasons)
            raise AgentRoutingError(
                code,
                f"Agent {agent['displayName']} has no eligible runtime placement ({code}).",
            )
        placement, node = sorted(
            candidates,
            key=lambda item: (
                0 if item[1].get("status") != "running" else 1,
                int(item[0].get("priority") or 100),
                -(
                    int(item[1].get("maxConcurrentRuns") or 1)
                    - len(item[1].get("activeRuns") or [])
                ),
                item[0]["id"],
            ),
        )[0]
        selected_node_ids.add(node["id"])
        selected_workspace = selected_workspace or workspace_identity(node)
        selected_workspace_policy = selected_workspace_policy or (
            placement.get("workspacePolicy") or {}
        ).get("kind", "node-affine")
        resolved.append(
            {
                **assignment,
                "agentId": agent_id,
                "executorKind": agent["executorKind"],
                "agentVersion": agent["version"],
                **(
                    {"agentInstructions": agent["instructions"]}
                    if agent.get("instructions")
                    else {}
                ),
                "placementId": placement["id"],
                "daemonNodeId": node["id"],
                "workspacePolicy": placement.get("workspacePolicy")
                or {"kind": "node-affine"},
            }
        )
    return resolved


def _best_rejection_code(reasons: set[str]) -> str:
    for reason in (
        "agent_configuration_pending",
        "workspace_unavailable",
        "executor_not_ready",
        "capacity_exhausted",
        "node_offline",
    ):
        if reason in reasons:
            return reason
    return "agent_offline"
