"""创建 Agent 的校验。员工路由与 admin 路由共用同一条路径。"""

from __future__ import annotations

from typing import Any

from ..core.computer_identity import computer_id
from ..core.models import AGENT_ROLES


class AgentCreationError(ValueError):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.status = status


def computer_nodes(ctx: Any, target_computer_id: str, employee_id: str) -> list[dict[str, Any]]:
    """该员工名下、属于这台 computer 的全部 node 记录（在线与否不限）。"""
    return [
        node
        for node in ctx.registry.monitor_nodes()
        if computer_id(node) == target_computer_id
        and node.get("employeeId") == employee_id
    ]


def available_runtimes(nodes: list[dict[str, Any]]) -> set[str]:
    """这台 computer 当前可用的 runtime 集合。"""
    supported: set[str] = set()
    disabled: set[str] = set()
    for node in nodes:
        supported |= set(node.get("supportedAgents") or [])
        supported |= {
            kind
            for kind, status in (node.get("agents") or {}).items()
            if status == "ready"
        }
        disabled |= set(node.get("disabledAgents") or [])
    return supported - disabled


def create_agent_for_employee(
    ctx: Any, supervisor_employee_id: str, body: dict[str, Any]
) -> dict[str, Any]:
    target_computer_id = (body.get("computerId") or "").strip()
    if not target_computer_id:
        raise AgentCreationError("computer_required", "computerId is required.")
    nodes = computer_nodes(ctx, target_computer_id, supervisor_employee_id)
    if not nodes:
        raise AgentCreationError(
            "computer_not_found", "Computer not found.", status=404
        )
    executor_kind = (body.get("executorKind") or "").strip()
    if executor_kind not in available_runtimes(nodes):
        raise AgentCreationError(
            "runtime_unavailable",
            f"This computer does not have the {executor_kind or '(missing)'} runtime.",
        )
    default_role = (body.get("defaultRole") or "").strip()
    if default_role not in AGENT_ROLES:
        raise AgentCreationError(
            "role_invalid",
            f"defaultRole must be one of: {', '.join(AGENT_ROLES)}.",
        )
    agent = ctx.agent_store.create_agent(
        supervisor_employee_id,
        {
            **{
                key: value
                for key, value in body.items()
                if key
                in (
                    "displayName",
                    "instructions",
                    "toolPolicy",
                    "skillPolicy",
                    "modelPolicy",
                )
            },
            "computerId": target_computer_id,
            "executorKind": executor_kind,
            "defaultRole": default_role,
        },
    )
    _place_on_a_live_node(ctx, agent, nodes)
    return agent


def _place_on_a_live_node(ctx: Any, agent: dict[str, Any], nodes: list[dict[str, Any]]) -> None:
    """有在线 node 就落 placement；没有就留空，等它上线时由 sync_node_agents 补。"""
    from ..persistence.agent_placement_store import create_node_placement

    live = next(
        (
            node
            for node in nodes
            if node.get("online") and not node.get("stale")
            and node.get("status") in ("ready", "busy", "running")
        ),
        None,
    )
    if live:
        create_node_placement(ctx.agent_placement_store, agent, live)
