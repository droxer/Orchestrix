from __future__ import annotations

from pathlib import Path

from relay.migrations_runtime.agent_computer_id import migrate_agent_computer_ids
from relay.persistence.agent_placement_store import (
    LocalAgentPlacementStore,
    create_node_placement,
)
from relay.persistence.agent_store import LocalAgentStore


def _node(node_id: str = "node-1") -> dict:
    return {
        "id": node_id,
        "employeeId": "alice",
        "workspaceId": "machine-a",
        "workspacePath": "/w",
    }


def test_migrates_a_compatibility_agent_into_a_plain_agent(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    agent = agents.ensure_compatibility_agent(
        "alice", "claude", "node-1", computer_id="device:alice:machine-a"
    )
    create_node_placement(placements, agent, _node())

    assert migrate_agent_computer_ids(agents, placements) == 1

    migrated = agents.get_agent(agent["id"])
    assert migrated["id"] == agent["id"]          # id 不变，历史不断
    assert migrated["computerId"] == "device:alice:machine-a"
    assert not migrated.get("compatibilityKey")
    assert migrated["defaultRole"] == "implementer"


def test_migration_is_idempotent(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    agent = agents.ensure_compatibility_agent(
        "alice", "claude", "node-1", computer_id="device:alice:machine-a"
    )
    create_node_placement(placements, agent, _node())

    assert migrate_agent_computer_ids(agents, placements) == 1
    assert migrate_agent_computer_ids(agents, placements) == 0


def test_agent_without_a_placement_is_skipped_without_crashing(tmp_path: Path) -> None:
    """历史原因存在无 placement 的记录；跳过而不是崩，之后表现为 computer_gone。"""
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    agent = agents.ensure_compatibility_agent(
        "alice", "claude", "node-1", computer_id="device:alice:machine-a"
    )

    assert migrate_agent_computer_ids(agents, placements) == 0
    assert agents.get_agent(agent["id"])["compatibilityKey"]


def test_legacy_placement_without_computer_id_falls_back_to_the_registry(
    tmp_path: Path,
) -> None:
    """spec ① 只给新建 placement 写了 computerId；存量的靠 registry 换算。"""
    from types import SimpleNamespace

    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    agent = agents.ensure_compatibility_agent(
        "alice", "claude", "node-1", computer_id="device:alice:machine-a"
    )
    placements.create_placement(agent, "node-1")  # 不经 create_node_placement，无 computerId
    registry = SimpleNamespace(monitor_nodes=lambda: [_node()])

    assert migrate_agent_computer_ids(agents, placements, registry) == 1
    assert agents.get_agent(agent["id"])["computerId"] == "device:alice:machine-a"


def test_plain_agents_are_left_alone(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    agents.create_agent(
        "alice",
        {
            "displayName": "Ada",
            "executorKind": "claude",
            "defaultRole": "reviewer",
            "computerId": "device:alice:machine-a",
        },
    )
    assert migrate_agent_computer_ids(agents, placements) == 0
