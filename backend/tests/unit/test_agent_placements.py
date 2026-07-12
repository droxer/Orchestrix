from __future__ import annotations

from pathlib import Path

from relay.persistence.agent_placement_store import (
    DatabaseAgentPlacementStore,
    LocalAgentPlacementStore,
    placement_status,
)
from relay.persistence.agent_store import (
    DatabaseAgentStore,
    LocalAgentStore,
)


def test_agents_can_be_placed_on_different_nodes(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    researcher = agents.create_agent(
        "alice", {"displayName": "Researcher", "executorKind": "claude"}
    )
    builder = agents.create_agent(
        "alice", {"displayName": "Builder", "executorKind": "codex"}
    )

    first = placements.create_placement(researcher, "node_a")
    second = placements.create_placement(builder, "node_b")

    assert first["daemonNodeId"] == "node_a"
    assert second["daemonNodeId"] == "node_b"


def test_placement_availability_is_derived_from_agent_and_node_health(
    tmp_path: Path,
) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    agent = agents.create_agent(
        "alice", {"displayName": "Builder", "executorKind": "codex"}
    )
    placement = placements.create_placement(agent, "node_a")
    node = {
        "id": "node_a",
        "online": True,
        "stale": False,
        "status": "ready",
        "agents": {"codex": "ready"},
    }

    assert placement_status(placement, agent, node)["status"] == "ready"
    assert (
        placement_status(placement, agent, {**node, "online": False})["status"]
        == "offline"
    )

    updated_agent = agents.update_agent(agent["id"], {"instructions": "Use tests."})
    result = placement_status(placement, updated_agent, node)
    assert result["status"] == "incompatible"
    assert result["conditions"][0]["reason"] == "agent_configuration_pending"


def test_database_agent_placement_store_matches_local_contract(tmp_path: Path) -> None:
    database_url = f"sqlite:///{tmp_path}/placements.db"
    agents = DatabaseAgentStore(database_url, create_schema=True)
    placements = DatabaseAgentPlacementStore(database_url, create_schema=True)
    agent = agents.create_agent(
        "alice", {"displayName": "Builder", "executorKind": "codex"}
    )

    placement = placements.create_placement(agent, "node_a", {"priority": 20})
    updated = placements.update_placement(placement["id"], {"desiredState": "draining"})

    assert updated["desiredState"] == "draining"
    assert (
        DatabaseAgentPlacementStore(database_url).get_placement(placement["id"])[
            "priority"
        ]
        == 20
    )
    assert [event["type"] for event in placements.events(placement["id"])] == [
        "placement.created",
        "placement.draining",
    ]


def test_database_placement_store_normalizes_legacy_owner_snapshot(tmp_path: Path) -> None:
    database_url = f"sqlite:///{tmp_path}/legacy-placements.db"
    agents = DatabaseAgentStore(database_url, create_schema=True)
    placements = DatabaseAgentPlacementStore(database_url, create_schema=True)
    agent = agents.create_agent(
        "alice", {"displayName": "Builder", "executorKind": "codex"}
    )
    placement = placements.create_placement(agent, "node_a")
    legacy = {**placement, "employeeId": "alice"}
    legacy.pop("supervisorEmployeeId")
    with placements.engine.begin() as conn:
        conn.execute(
            placements.placements.update()
            .where(placements.placements.c.public_id == placement["id"])
            .values(snapshot=legacy)
        )

    assert (
        placements.get_placement(placement["id"])["supervisorEmployeeId"]
        == "alice"
    )
