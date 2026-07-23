from __future__ import annotations

import os
from typing import Any

from ..core.models import AGENT_NAMES, AGENT_ROLES

AGENT_TASK_MODES = ("action", "review", "ask")


def normalize_agent_role_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ValueError("agent role map must be an object keyed by agent name.")
    invalid_agents = [name for name in value if name not in AGENT_NAMES]
    if invalid_agents:
        raise ValueError(f"Unknown agent name(s): {', '.join(invalid_agents)}.")
    invalid_roles = [role for role in value.values() if role not in AGENT_ROLES]
    if invalid_roles:
        raise ValueError(
            f"Unknown agent role(s): {', '.join(str(role) for role in invalid_roles)}."
        )
    return {agent: value[agent] for agent in AGENT_NAMES if agent in value}


def effective_role_for_assignment(
    node: dict[str, Any], assignment: dict[str, Any], _mode: str
) -> str | None:
    explicit_role = assignment.get("role")
    if explicit_role in AGENT_ROLES:
        return explicit_role
    agent = assignment.get("executorKind") or assignment["agent"]
    overrides = (
        node.get("agentRoleOverrides")
        if isinstance(node.get("agentRoleOverrides"), dict)
        else {}
    )
    defaults = (
        node.get("agentRoleDefaults")
        if isinstance(node.get("agentRoleDefaults"), dict)
        else {}
    )
    return overrides.get(agent) or defaults.get(agent)


def normalize_run_capacity(payload: dict[str, Any]) -> tuple[int, dict[str, int]]:
    raw_by_mode = (
        payload.get("runCapacityByMode")
        if isinstance(payload.get("runCapacityByMode"), dict)
        else {}
    )
    by_mode: dict[str, int] = {}
    for mode in AGENT_TASK_MODES:
        raw = raw_by_mode.get(mode)
        by_mode[mode] = raw if isinstance(raw, int) and raw > 0 else 1
    raw_max = payload.get("maxConcurrentRuns")
    max_concurrent = (
        raw_max if isinstance(raw_max, int) and raw_max > 0 else max(by_mode.values())
    )
    return max(1, max_concurrent), by_mode


def node_accepts_run(
    node: dict[str, Any],
    *,
    assignments: list[dict[str, Any]],
    active_runs: list[dict[str, Any]],
    session_id: str | None = None,
) -> bool:
    if node.get("retiredAt"):
        return False
    if session_id and any(run.get("sessionId") == session_id for run in active_runs):
        return False
    requested_modes = [assignment.get("mode") or "action" for assignment in assignments]
    exclusive_request = any(mode != "ask" for mode in requested_modes)
    active_exclusive = any(run.get("mode") != "ask" for run in active_runs)
    if exclusive_request:
        return not active_runs
    if active_exclusive:
        return False
    max_concurrent, by_mode = normalize_run_capacity(node)
    active_ask = sum(1 for run in active_runs if run.get("mode") == "ask")
    return len(active_runs) < max_concurrent and active_ask < by_mode["ask"]


def node_status_for_active_runs(
    node: dict[str, Any], active_runs: list[dict[str, Any]]
) -> str:
    if node.get("status") in ("stopped", "failed", "provisioning"):
        return node["status"]
    return "running" if active_runs else "ready"


def workspace_paths_match(left: str | None, right: str | None) -> bool:
    return bool(
        left
        and right
        and os.path.normcase(os.path.abspath(left))
        == os.path.normcase(os.path.abspath(right))
    )


def workspace_identity(node: dict[str, Any]) -> tuple[str, str] | None:
    workspace_id = node.get("workspaceId")
    if isinstance(workspace_id, str) and workspace_id.strip():
        return ("id", workspace_id.strip())
    workspace_path = node.get("workspacePath")
    if isinstance(workspace_path, str) and workspace_path.strip():
        return ("path", os.path.normcase(os.path.abspath(workspace_path)))
    return None


def workspace_identity_record(node: dict[str, Any]) -> dict[str, str] | None:
    identity = workspace_identity(node)
    return {"kind": identity[0], "value": identity[1]} if identity else None
