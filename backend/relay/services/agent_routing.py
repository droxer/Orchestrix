from __future__ import annotations

from typing import Any

from ..daemon_registry.scheduling import (
    node_accepts_run,
    workspace_identity,
    workspace_identity_record,
)
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
        "agent_policy_unsupported",
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
    if not candidates:
        return None
    return min(candidates, key=lambda item: (item[0], item[1]))[2]


def resolve_agent_assignments(
    assignments: list[dict[str, Any]],
    *,
    employee_id: str,
    is_admin: bool,
    agent_store: Any,
    placement_store: Any,
    daemon_nodes: list[dict[str, Any]],
    session: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    nodes = {node["id"]: node for node in daemon_nodes}
    resolved: list[dict[str, Any]] = []
    (
        selected_node_ids,
        selected_workspace,
        selected_workspace_policy,
    ) = _session_affinity(session, placement_store, nodes)
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
        policy_fields = [
            field
            for field in ("skillPolicy", "toolPolicy", "modelPolicy")
            if agent.get(field)
        ]
        if policy_fields:
            raise AgentRoutingError(
                "agent_policy_unsupported",
                f"Agent {agent['displayName']} has policy metadata that this runtime cannot enforce.",
            )
        requested_kind = assignment.get("executorKind")
        if requested_kind and requested_kind != agent["executorKind"]:
            raise AgentRoutingError(
                "executor_mismatch",
                f"Agent {agent['displayName']} uses {agent['executorKind']}, not {requested_kind}.",
            )
        placements = _agent_placements_with_managed_capacity(
            agent, placement_store, nodes
        )
        candidates = []
        rejection_reasons: set[str] = set()
        for placement in placements:
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
            if (
                (selected_node_ids or selected_workspace is not None)
                and not _workspace_candidate_allowed(
                    node,
                    placement.get("workspacePolicy") or {"kind": "node-affine"},
                    selected_node_ids,
                    selected_workspace,
                    selected_workspace_policy,
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
        placement, node = min(
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
        )
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
                "workspaceIdentity": workspace_identity_record(node),
                "workspacePolicy": placement.get("workspacePolicy")
                or {"kind": "node-affine"},
            }
        )
    return resolved


def _agent_placements_with_managed_capacity(
    agent: dict[str, Any], placement_store: Any, nodes: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    placements = placement_store.list_placements(agent_id=agent["id"])
    if any(
        placement_status(
            placement, agent, nodes.get(placement["daemonNodeId"])
        )["status"]
        in ("ready", "busy")
        for placement in placements
    ):
        return placements
    placed_node_ids = {placement["daemonNodeId"] for placement in placements}
    managed_candidate = min(
        (
            node
            for node in nodes.values()
            if node.get("managedNodeId")
            and node.get("employeeId") == agent.get("supervisorEmployeeId")
            and node.get("status") in ("ready", "running")
            and agent["executorKind"]
            in (set(node.get("supportedAgents") or []) | set(node.get("agents") or {}))
            and agent["executorKind"] not in set(node.get("disabledAgents") or [])
            and node["id"] not in placed_node_ids
        ),
        key=lambda node: node["id"],
        default=None,
    )
    if managed_candidate:
        placement_store.create_placement(agent, managed_candidate["id"])
        return placement_store.list_placements(agent_id=agent["id"])
    return placements


def validate_session_workspace_assignments(
    assignments: list[dict[str, Any]],
    *,
    session: dict[str, Any],
    placement_store: Any,
    daemon_nodes: list[dict[str, Any]],
) -> None:
    nodes = {node["id"]: node for node in daemon_nodes}
    selected_node_ids, selected_workspace, selected_policy = _session_affinity(
        session, placement_store, nodes
    )
    for assignment in assignments:
        node = nodes.get(assignment.get("daemonNodeId"))
        if not node:
            raise AgentRoutingError(
                "node_offline", "Assigned runtime node is no longer registered."
            )
        if (
            (selected_node_ids or selected_workspace is not None)
            and not _workspace_candidate_allowed(
                node,
                assignment.get("workspacePolicy") or {"kind": "node-affine"},
                selected_node_ids,
                selected_workspace,
                selected_policy,
            )
        ):
            raise AgentRoutingError(
                "workspace_unavailable",
                "Selected agent placement cannot access the existing session workspace.",
            )
        selected_node_ids.add(node["id"])
        selected_workspace = selected_workspace or workspace_identity(node)
        selected_policy = selected_policy or (
            assignment.get("workspacePolicy") or {}
        ).get("kind", "node-affine")


def _workspace_candidate_allowed(
    node: dict[str, Any],
    workspace_policy: dict[str, Any],
    selected_node_ids: set[str],
    selected_workspace: tuple[str, str] | None,
    selected_workspace_policy: str | None,
) -> bool:
    node_workspace = workspace_identity(node)
    if node["id"] in selected_node_ids:
        return selected_workspace is None or node_workspace == selected_workspace
    if not selected_node_ids and selected_workspace == node_workspace:
        return True
    return bool(
        selected_workspace_policy == "shared-path"
        and workspace_policy.get("kind") == "shared-path"
        and selected_workspace is not None
        and selected_workspace[0] == "id"
        and node_workspace == selected_workspace
    )


def _session_affinity(
    session: dict[str, Any] | None,
    placement_store: Any,
    nodes: dict[str, dict[str, Any]],
) -> tuple[set[str], tuple[str, str] | None, str | None]:
    if not session:
        return set(), None, None
    prior_run = next(
        (
            run
            for run in reversed(session.get("agentRuns") or [])
            if run.get("daemonNodeId")
        ),
        None,
    )
    if not prior_run:
        # A session acquires runtime affinity only after its first agent run.
        # Session workspacePath is the in-guest working directory and is not a
        # canonical daemon workspace identity, so comparing it with a node's
        # host path or workspaceId would reject otherwise valid first runs.
        return set(), None, None
    node_id = prior_run["daemonNodeId"]
    node = nodes.get(node_id)
    recorded_workspace = prior_run.get("workspaceIdentity")
    workspace = (
        (recorded_workspace.get("kind"), recorded_workspace.get("value"))
        if isinstance(recorded_workspace, dict)
        and recorded_workspace.get("kind") in ("id", "path")
        and isinstance(recorded_workspace.get("value"), str)
        else workspace_identity(node)
        if node
        else workspace_identity({"workspacePath": session.get("workspacePath")})
    )
    placement = (
        placement_store.get_placement(prior_run.get("placementId"))
        if prior_run.get("placementId")
        else None
    )
    policy = ((placement or {}).get("workspacePolicy") or {}).get(
        "kind", "node-affine"
    )
    return {node_id}, workspace, policy


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
