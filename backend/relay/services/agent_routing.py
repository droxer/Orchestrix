from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ..core.computer_identity import computer_id
from ..daemon_registry.scheduling import node_accepts_run
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


def placement_node(
    placement: Mapping[str, Any], nodes: Mapping[str, dict[str, Any]]
) -> dict[str, Any] | None:
    """找到当前承载该 placement 所属 Computer 的在线 node。

    placement 记的是 computerId（稳定），不是 node id（会变）。老 placement
    没有 computerId，退回按 node id 直查，行为等同改造前。
    """
    identity = placement.get("computerId")
    if not identity:
        return nodes.get(placement.get("daemonNodeId"))
    candidates = [node for node in nodes.values() if computer_id(node) == identity]
    if not candidates:
        return None
    return min(
        candidates,
        key=lambda node: (
            0
            if node.get("online")
            and not node.get("stale")
            and node.get("status") in ("ready", "busy", "running")
            else 1,
            node["id"],
        ),
    )


def resolve_session_daemon_node_id(
    session: dict[str, Any] | None,
    daemon_nodes: list[dict[str, Any]],
) -> str | None:
    """把 thread 钉住的 Computer 解析到它当前的 runtime node。

    Computer 离线时返回 None —— 不改派到别的机器。thread 的产物在那台机器
    的目录里，换机器执行等于给 agent 一个空目录：看着在干活，实际上下文已丢。

    身份优先级：
    1. `session["computerId"]`（Task 5 起，session.created / session.runtime_affinity
       事件 replay 后物化的稳定身份）。
    2. 没有 `computerId` 但有 `managedNodeId`（Task 5 之前创建、尚未回填的 session）——
       派生 `managed:{managedNodeId}`，与 `_apply_session_runtime_affinity` 在 replay
       层做的兼容派生完全一致，理由同样成立：老 session 不该因为身份模型升级就无法
       跟着托管节点换 id 后继续解析。
    3. 都没有——落回 `session["daemonNodeId"]` 字面值。这是 `POST /tasks` 产生的
       pending thread（尚未选定任何 node）唯一能解析出节点的路径，必须保留。
    """
    if not session:
        return None
    identity = session.get("computerId")
    if not identity:
        managed_node_id = session.get("managedNodeId")
        if isinstance(managed_node_id, str) and managed_node_id:
            identity = f"managed:{managed_node_id}"
    if not identity:
        recorded = session.get("daemonNodeId")
        return recorded if isinstance(recorded, str) and recorded else None
    candidates = [
        node
        for node in daemon_nodes
        if computer_id(node) == identity and not node.get("retiredAt")
    ]
    if not candidates:
        return None
    return min(
        candidates,
        key=lambda node: (
            0
            if node.get("online")
            and not node.get("stale")
            and node.get("status") in ("ready", "busy", "running")
            else 1,
            node["id"],
        ),
    )["id"]


def resolve_agent_assignments(
    assignments: list[dict[str, Any]],
    *,
    employee_id: str,
    is_admin: bool,
    agent_store: Any,
    placement_store: Any,
    daemon_nodes: list[dict[str, Any]],
    session: dict[str, Any] | None = None,
    required_node_id: str | None = None,
    daemon_store: Any | None = None,
) -> list[dict[str, Any]]:
    nodes = {node["id"]: node for node in daemon_nodes}
    resolved: list[dict[str, Any]] = []
    selected_node_ids = _session_affinity(session, placement_store, nodes, daemon_store)
    if required_node_id:
        required_node = nodes.get(required_node_id)
        if not required_node:
            raise AgentRoutingError(
                "node_offline", "Selected thread computer is not available."
            )
        if selected_node_ids and required_node_id not in selected_node_ids:
            raise AgentRoutingError(
                "workspace_unavailable",
                "Selected computer does not match the thread runtime.",
            )
        selected_node_ids.add(required_node_id)
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
        placements = placement_store.list_placements(agent_id=agent["id"])
        candidates = []
        rejection_reasons: set[str] = set()
        for placement in placements:
            node = placement_node(placement, nodes)
            view = placement_status(placement, agent, node)
            if view["status"] not in ("ready", "busy"):
                rejection_reasons.update(
                    condition["reason"] for condition in view.get("conditions", [])
                )
                continue
            if not node_accepts_run(
                node,
                active_runs=node.get("activeRuns") or [],
            ):
                rejection_reasons.add("capacity_exhausted")
                continue
            if selected_node_ids and node["id"] not in selected_node_ids:
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
        resolved.append(
            {
                **assignment,
                "agentId": agent_id,
                "agent": agent["executorKind"],
                "agentDisplayName": agent["displayName"],
                "executorKind": agent["executorKind"],
                "agentVersion": agent["version"],
                **(
                    {"agentInstructions": agent["instructions"]}
                    if agent.get("instructions")
                    else {}
                ),
                "placementId": placement["id"],
                "daemonNodeId": node["id"],
            }
        )
    return resolved


def resolve_legacy_session_computer_id(
    session: Mapping[str, Any],
    placement_store: Any,
    nodes: Mapping[str, dict[str, Any]],
    daemon_store: Any | None,
) -> str | None:
    """Recover a pre-Task-5 session's Computer identity, read-only.

    `resolve_session_daemon_node_id` only reads what's already on the
    session (`computerId`, then `managedNodeId`, then a literal
    `daemonNodeId`). Sessions created before Task 5 wired up
    `session.runtime_affinity` may carry none of the first two — their only
    trace of identity is the daemon node they last ran on. Two call paths
    never go through `_backfill_runtime_affinity`
    (`collaboration/service.py`), which persists that recovery for the
    request-response dispatch path: the TaskScheduler's continuation
    dispatch (`tasks/scheduler.py`) and the read-only workspace-browse route
    (`api/agent_workspace_routes.py`). This gives them the same recovery
    in-memory, once per call, without writing anything — so the write-once
    guard in `SessionController.record_runtime_affinity` (raises
    `ValueError` on a conflicting identity) can never fire here, which
    matters because one of the two paths is read-only and must not 500.

    Priority mirrors `_backfill_runtime_affinity`: the node currently
    registered under the session's last known `daemonNodeId` may itself
    carry a `managedNodeId`; failing that, the daemon registry's history of
    that runtime id is consulted; failing that, a placement rebind (a
    managed Computer redeployed under a new node id after the session's
    last run) is followed only when the destination is itself managed.
    """
    if session.get("computerId"):
        return session["computerId"]
    if session.get("managedNodeId"):
        return f"managed:{session['managedNodeId']}"
    session_node_id = session.get("daemonNodeId")
    managed_node_id = None
    if isinstance(session_node_id, str) and session_node_id:
        managed_node_id = (nodes.get(session_node_id) or {}).get("managedNodeId")
        if not managed_node_id:
            historical_managed_node_id = getattr(
                daemon_store, "historical_managed_node_id", None
            )
            if historical_managed_node_id:
                managed_node_id = historical_managed_node_id(session_node_id)
    if managed_node_id:
        return f"managed:{managed_node_id}"
    prior_run = next(
        (
            run
            for run in reversed(session.get("agentRuns") or [])
            if run.get("daemonNodeId")
        ),
        None,
    )
    node_id = session_node_id or (prior_run or {}).get("daemonNodeId")
    if not prior_run or not prior_run.get("placementId"):
        return None
    placement = placement_store.get_placement(prior_run["placementId"])
    rebound_node_id = (placement or {}).get("daemonNodeId")
    if not isinstance(rebound_node_id, str) or rebound_node_id == node_id:
        return None
    rebound_node = nodes.get(rebound_node_id)
    if not rebound_node or not rebound_node.get("managedNodeId"):
        return None
    previous_node = nodes.get(node_id) if isinstance(node_id, str) else None
    if previous_node and previous_node.get("managedNodeId") != rebound_node.get(
        "managedNodeId"
    ):
        return None
    return f"managed:{rebound_node['managedNodeId']}"


def _session_affinity(
    session: dict[str, Any] | None,
    placement_store: Any,
    nodes: dict[str, dict[str, Any]],
    daemon_store: Any | None = None,
) -> set[str]:
    if not session:
        return set()
    identity = resolve_legacy_session_computer_id(
        session, placement_store, nodes, daemon_store
    )
    if identity and identity != session.get("computerId"):
        session = {**session, "computerId": identity}
    prior_run = next(
        (
            run
            for run in reversed(session.get("agentRuns") or [])
            if run.get("daemonNodeId")
        ),
        None,
    )
    session_node_id = resolve_session_daemon_node_id(session, list(nodes.values()))
    if not prior_run:
        if isinstance(session_node_id, str) and session_node_id:
            return {session_node_id}
        if session.get("computerId"):
            # The thread is pinned to a Computer (directly or recovered by
            # resolve_legacy_session_computer_id above) but that Computer has
            # no reachable node right now. An empty constraint set here would
            # let dispatch silently pick a different machine — the thread's
            # workspace lives on the pinned one, so refuse explicitly instead
            # of quietly running somewhere the work was never done.
            raise AgentRoutingError(
                "node_offline",
                "This thread's computer is not currently online.",
            )
        # Legacy sessions acquire runtime affinity after their first agent run.
        return set()
    node_id = session_node_id or prior_run["daemonNodeId"]
    return {node_id}


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
