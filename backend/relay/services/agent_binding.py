"""An agent's binding status to its Computer.

Derived live, never persisted: it's fully computable from the registry, and
persisting it would only add a synchronization burden.
"""

from __future__ import annotations

from typing import Any

from ..core.computer_identity import computer_id

AVAILABLE = "available"
COMPUTER_GONE = "computer_gone"
COMPUTER_OFFLINE = "computer_offline"
RUNTIME_MISSING = "runtime_missing"


def binding_status(agent: dict[str, Any], nodes: list[dict[str, Any]]) -> str:
    target = agent.get("computerId")
    if not target:
        return COMPUTER_GONE
    own = [node for node in nodes if computer_id(node) == target]
    if not own:
        return COMPUTER_GONE
    supported: set[str] = set()
    disabled: set[str] = set()
    for node in own:
        # node["agents"] always carries every AGENT_NAMES key regardless of
        # what's actually installed (see registry.py / node_backend.py), so a
        # raw key union of that dict would always report every runtime as
        # available. Only entries whose status is "ready" indicate a runtime
        # this node can actually run; supportedAgents is a convenience field
        # some callers (and older node records) supply directly instead.
        # Mirrors available_runtimes() in agent_creation.py and
        # sync_node_agents() in node_agents.py.
        supported |= set(node.get("supportedAgents") or []) | {
            kind
            for kind, status in (node.get("agents") or {}).items()
            if status == "ready"
        }
        disabled |= set(node.get("disabledAgents") or [])
    if agent["executorKind"] not in supported - disabled:
        return RUNTIME_MISSING
    if not any(
        node.get("online")
        and not node.get("stale")
        and node.get("status") in ("ready", "busy", "running")
        for node in own
    ):
        return COMPUTER_OFFLINE
    return AVAILABLE
