"""The stable identity of one Computer.

A daemon node id changes on every reprovision, so it must never be persisted
as an identity. This module is the only place in the codebase that resolves a
computer identity — do not reimplement this priority order anywhere else.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def _clean(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def computer_id(node: Mapping[str, Any]) -> str:
    """Return the stable identity of the Computer this node belongs to.

    The prefix makes a namespace collision impossible: a managedNodeId that
    happens to equal some machine's machine-id must never resolve to the same
    computer.
    """
    managed_node_id = _clean(node.get("managedNodeId"))
    if managed_node_id:
        return f"managed:{managed_node_id}"
    employee_id = _clean(node.get("employeeId"))
    # The field name is historical: `workspaceId` holds the host machine-id
    # (the daemon's `ensureMachineId()`), not anything about a directory.
    # Do not read it as related to `workspacePath`.
    machine_id = _clean(node.get("workspaceId"))
    if employee_id and machine_id:
        return f"device:{employee_id}:{machine_id}"
    return f"node:{node['id']}"
