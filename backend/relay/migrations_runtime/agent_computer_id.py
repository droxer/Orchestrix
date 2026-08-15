"""把自动生成的 compatibility agent 就地转成显式声明的普通 agent。

一次性、幂等。走 store 自身的更新路径，使事件与快照同步演进 —— 不要改成
Alembic 原生 SQL，agents 的读取取自 snapshot 列，直接改写会绕开写入路径。
"""

from __future__ import annotations

from typing import Any

from loguru import logger

from ..core.computer_identity import computer_id

DEFAULT_ROLE = "implementer"


def migrate_agent_computer_ids(
    agent_store: Any, placement_store: Any, registry: Any | None = None
) -> int:
    """返回本次迁移的 agent 条数。已迁移过的不再计入。

    registry 可选，用于给 spec ① 之前创建、因而没有 computerId 的老 placement
    兜底：拿它的 daemonNodeId 去注册表里换算身份。
    """
    migrated = 0
    for agent in agent_store.list_agents():
        if agent.get("deletedAt") or not agent.get("compatibilityKey"):
            continue
        agent_computer_id = _computer_id_from_placements(
            placement_store, agent["id"], registry
        )
        if not agent_computer_id:
            logger.warning(
                "Skipping agent migration: no placement to read a computer id from",
                agent_id=agent["id"],
            )
            continue
        agent_store.set_birth_certificate(
            agent["id"],
            computer_id=agent_computer_id,
            default_role=agent.get("defaultRole") or DEFAULT_ROLE,
        )
        migrated += 1
    return migrated


def _computer_id_from_placements(
    placement_store: Any, agent_id: str, registry: Any | None
) -> str | None:
    """从 placement 读 computerId。

    不解析 compatibilityKey：spec ① 之后 key 的中段是带前缀的身份
    （形如 alice:device:alice:machine-a:claude），按冒号切分无法无歧义还原。

    spec ① 只给**新建**的 placement 写了 computerId，所以生产库里绝大多数
    存量 placement 没有这个字段 —— 只读它会让迁移在真实数据上几乎全部空转。
    因此对没有该字段的 placement，用它的 daemonNodeId 去注册表换算身份。
    """
    placements = placement_store.list_placements(agent_id=agent_id, include_removed=True)
    for placement in placements:
        computer_id_value = placement.get("computerId")
        if computer_id_value:
            return computer_id_value
    if registry is None:
        return None
    nodes = {node["id"]: node for node in registry.monitor_nodes()}
    for placement in placements:
        node = nodes.get(placement.get("daemonNodeId"))
        if node:
            return computer_id(node)
    return None
