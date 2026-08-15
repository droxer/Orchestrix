from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from relay.migrations_runtime.agent_computer_id import migrate_agent_computer_ids
from relay.persistence.agent_placement_store import (
    DatabaseAgentPlacementStore,
    LocalAgentPlacementStore,
    create_node_placement,
)
from relay.persistence.agent_store import DatabaseAgentStore, LocalAgentStore


def _node(node_id: str = "node-1") -> dict:
    return {
        "id": node_id,
        "employeeId": "alice",
        "workspaceId": "machine-a",
        "workspacePath": "/w",
    }


def _stores(tmp_path: Path, store_kind: str, db_name: str = "migration.db"):
    if store_kind == "database":
        database_url = f"sqlite:///{tmp_path}/{db_name}"
        agents = DatabaseAgentStore(database_url, create_schema=True)
        placements = DatabaseAgentPlacementStore(database_url, create_schema=True)
    else:
        agents = LocalAgentStore(tmp_path)
        placements = LocalAgentPlacementStore(tmp_path)
    return agents, placements


@pytest.mark.parametrize("store_kind", ["local", "database"])
def test_migrates_a_compatibility_agent_into_a_plain_agent(
    tmp_path: Path, store_kind: str
) -> None:
    agents, placements = _stores(tmp_path, store_kind)
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


@pytest.mark.parametrize("store_kind", ["local", "database"])
def test_migration_is_idempotent(tmp_path: Path, store_kind: str) -> None:
    agents, placements = _stores(tmp_path, store_kind)
    agent = agents.ensure_compatibility_agent(
        "alice", "claude", "node-1", computer_id="device:alice:machine-a"
    )
    create_node_placement(placements, agent, _node())

    assert migrate_agent_computer_ids(agents, placements) == 1
    assert migrate_agent_computer_ids(agents, placements) == 0


@pytest.mark.parametrize("store_kind", ["local", "database"])
def test_agent_without_a_placement_is_skipped_without_crashing(
    tmp_path: Path, store_kind: str
) -> None:
    """历史原因存在无 placement 的记录；跳过而不是崩，之后表现为 computer_gone。"""
    agents, placements = _stores(tmp_path, store_kind)
    agent = agents.ensure_compatibility_agent(
        "alice", "claude", "node-1", computer_id="device:alice:machine-a"
    )

    assert migrate_agent_computer_ids(agents, placements) == 0
    assert agents.get_agent(agent["id"])["compatibilityKey"]


@pytest.mark.parametrize("store_kind", ["local", "database"])
def test_legacy_placement_without_computer_id_falls_back_to_the_registry(
    tmp_path: Path, store_kind: str
) -> None:
    """spec ① 只给新建 placement 写了 computerId；存量的靠 registry 换算。"""
    agents, placements = _stores(tmp_path, store_kind)
    agent = agents.ensure_compatibility_agent(
        "alice", "claude", "node-1", computer_id="device:alice:machine-a"
    )
    placements.create_placement(agent, "node-1")  # 不经 create_node_placement，无 computerId
    registry = SimpleNamespace(monitor_nodes=lambda: [_node()])

    assert migrate_agent_computer_ids(agents, placements, registry) == 1
    assert agents.get_agent(agent["id"])["computerId"] == "device:alice:machine-a"


@pytest.mark.parametrize("store_kind", ["local", "database"])
def test_plain_agents_are_left_alone(tmp_path: Path, store_kind: str) -> None:
    agents, placements = _stores(tmp_path, store_kind)
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


@pytest.mark.parametrize("store_kind", ["local", "database"])
def test_migration_picks_the_active_placement_over_a_removed_one(
    tmp_path: Path, store_kind: str
) -> None:
    """Critical regression: an agent that has switched computers carries one
    active placement and at least one removed (superseded) placement. Both
    stores sort placements by (priority, id) where id is a random uuid, so
    picking "the first placement with a computerId" without filtering out
    removed placements is a coin flip between the current and a retired
    computer. The migration must always land on the *active* placement's
    computer id, regardless of how the placements happen to sort.
    """
    old_node = _node("node-old")
    new_node = {**_node("node-new"), "workspaceId": "machine-b"}

    for attempt in range(5):
        agents, placements = _stores(
            tmp_path, store_kind, db_name=f"active-pick-{attempt}.db"
        )
        agent = agents.ensure_compatibility_agent(
            "alice", "claude", "node-old", computer_id="device:alice:machine-a"
        )
        # First placement, then move the agent to a new computer: the store
        # marks the old placement "removed" and creates a new active one.
        create_node_placement(placements, agent, old_node)
        create_node_placement(placements, agent, new_node)

        active = placements.list_placements(agent_id=agent["id"])
        assert [p["daemonNodeId"] for p in active] == ["node-new"]

        assert migrate_agent_computer_ids(agents, placements) == 1

        migrated = agents.get_agent(agent["id"])
        assert migrated["computerId"] == "device:alice:machine-b", (
            f"attempt {attempt}: migrated to {migrated['computerId']!r} instead "
            "of the active computer's id"
        )
