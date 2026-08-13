"""一台 Computer 的稳定身份。

daemon node id 每次重新 provision 都会变，因此绝不能作为身份持久化。
本模块是全代码库唯一解析 computer 身份的地方 —— 不要在别处内联重写这个
优先级顺序。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def _clean(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def computer_id(node: Mapping[str, Any]) -> str:
    """返回 node 所属 Computer 的稳定身份。

    带前缀是为了让命名空间不可能相撞：某个 managedNodeId 与某台机器的
    machine-id 恰好取值相同时，不能被解析成同一台 computer。
    """
    managed_node_id = _clean(node.get("managedNodeId"))
    if managed_node_id:
        return f"managed:{managed_node_id}"
    employee_id = _clean(node.get("employeeId"))
    machine_id = _clean(node.get("machineId")) or _clean(node.get("workspaceId"))
    if employee_id and machine_id:
        return f"device:{employee_id}:{machine_id}"
    return f"node:{node['id']}"
