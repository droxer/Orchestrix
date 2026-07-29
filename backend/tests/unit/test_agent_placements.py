from __future__ import annotations

from pathlib import Path

import pytest
from relay.persistence.agent_placement_store import (
    DatabaseAgentPlacementStore,
    LocalAgentPlacementStore,
    _new_placement,
    _placement_row,
    placement_status,
    reconcile_single_active_placement,
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


def test_moving_an_agent_to_a_new_computer_supersedes_the_old_placement(
    tmp_path: Path,
) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    agent = agents.create_agent(
        "alice", {"displayName": "Researcher", "executorKind": "claude"}
    )

    first = placements.create_placement(agent, "node_a")
    second = placements.create_placement(agent, "node_b")

    # One agent lives on exactly one computer: the second assignment moves it.
    active = placements.list_placements(agent_id=agent["id"])
    assert [placement["daemonNodeId"] for placement in active] == ["node_b"]
    assert placements.get_placement(first["id"])["desiredState"] == "removed"
    assert second["daemonNodeId"] == "node_b"


def test_reassigning_the_same_computer_is_rejected(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    agent = agents.create_agent(
        "alice", {"displayName": "Researcher", "executorKind": "claude"}
    )
    placements.create_placement(agent, "node_a")

    try:
        placements.create_placement(agent, "node_a")
    except ValueError as error:
        assert "already" in str(error)
    else:  # pragma: no cover - guard
        raise AssertionError("expected a rejection for a duplicate placement")


def test_database_store_moves_an_agent_between_computers(tmp_path: Path) -> None:
    database_url = f"sqlite:///{tmp_path}/move.db"
    agents = DatabaseAgentStore(database_url, create_schema=True)
    placements = DatabaseAgentPlacementStore(database_url, create_schema=True)
    agent = agents.create_agent(
        "alice", {"displayName": "Researcher", "executorKind": "claude"}
    )

    placements.create_placement(agent, "node_a")
    placements.create_placement(agent, "node_b")

    active = placements.list_placements(agent_id=agent["id"])
    assert [placement["daemonNodeId"] for placement in active] == ["node_b"]


@pytest.mark.parametrize("database", [False, True])
def test_runtime_rebind_preserves_placement_identity(
    tmp_path: Path, database: bool
) -> None:
    if database:
        database_url = f"sqlite:///{tmp_path}/rebind.db"
        agents = DatabaseAgentStore(database_url, create_schema=True)
        placements = DatabaseAgentPlacementStore(database_url, create_schema=True)
    else:
        agents = LocalAgentStore(tmp_path)
        placements = LocalAgentPlacementStore(tmp_path)
    agent = agents.create_agent(
        "alice", {"displayName": "Builder", "executorKind": "codex"}
    )
    original = placements.create_placement(agent, "runtime_old")

    rebound = placements.rebind_placement(
        original["id"], "runtime_new", managed_node_id="computer_one"
    )

    assert rebound["id"] == original["id"]
    assert rebound["daemonNodeId"] == "runtime_new"
    assert rebound["managedNodeId"] == "computer_one"
    assert rebound["desiredState"] == "active"
    assert placements.list_placements(agent_id=agent["id"]) == [rebound]


def test_database_move_keeps_old_placement_when_insert_fails(tmp_path: Path) -> None:
    database_url = f"sqlite:///{tmp_path}/atomic-move.db"
    agents = DatabaseAgentStore(database_url, create_schema=True)
    placements = DatabaseAgentPlacementStore(database_url, create_schema=True)
    agent = agents.create_agent(
        "alice", {"displayName": "Researcher", "executorKind": "claude"}
    )
    placements.create_placement(agent, "node_a")
    with placements.engine.begin() as conn:
        conn.exec_driver_sql(
            """
            CREATE TRIGGER reject_node_b
            BEFORE INSERT ON agent_placements
            WHEN NEW.daemon_node_public_id = 'node_b'
            BEGIN
                SELECT RAISE(ABORT, 'node_b rejected');
            END
            """
        )

    with pytest.raises(Exception, match="node_b rejected"):
        placements.create_placement(agent, "node_b")

    active = placements.list_placements(agent_id=agent["id"])
    assert [placement["daemonNodeId"] for placement in active] == ["node_a"]


def test_local_move_keeps_old_placement_when_create_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    agent = agents.create_agent(
        "alice", {"displayName": "Researcher", "executorKind": "claude"}
    )
    placements.create_placement(agent, "node_a")
    append = placements._append

    def reject_new_placement(
        placement_id: str, event_type: str, placement: dict
    ) -> None:
        if event_type == "placement.created" and placement["daemonNodeId"] == "node_b":
            raise OSError("node_b rejected")
        append(placement_id, event_type, placement)

    monkeypatch.setattr(placements, "_append", reject_new_placement)

    with pytest.raises(OSError, match="node_b rejected"):
        placements.create_placement(agent, "node_b")

    active = placements.list_placements(agent_id=agent["id"])
    assert [placement["daemonNodeId"] for placement in active] == ["node_a"]


def test_reconcile_collapses_pre_invariant_multi_placements(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    agent = agents.create_agent(
        "alice", {"displayName": "Researcher", "executorKind": "claude"}
    )
    # Simulate data created before the one-agent-one-computer invariant by
    # appending a second active placement straight to the event log (bypassing
    # create_placement's guard).
    placements.create_placement(agent, "node_low", {"priority": 200})
    extra = _new_placement(agent, "node_top", {"priority": 50})
    placements._append(extra["id"], "placement.created", extra)
    assert len(placements.list_placements(agent_id=agent["id"])) == 2

    superseded = reconcile_single_active_placement(placements)

    active = placements.list_placements(agent_id=agent["id"])
    # The top-priority (lowest number) placement survives; the rest are removed.
    assert [placement["daemonNodeId"] for placement in active] == ["node_top"]
    assert superseded  # the priority-200 placement was moved to removed
    # Idempotent: a second pass has nothing left to collapse.
    assert reconcile_single_active_placement(placements) == []


def test_database_reconcile_collapses_pre_invariant_multi_placements(
    tmp_path: Path,
) -> None:
    database_url = f"sqlite:///{tmp_path}/reconcile.db"
    agents = DatabaseAgentStore(database_url, create_schema=True)
    placements = DatabaseAgentPlacementStore(database_url, create_schema=True)
    agent = agents.create_agent(
        "alice", {"displayName": "Researcher", "executorKind": "claude"}
    )
    placements.create_placement(agent, "node_low", {"priority": 200})
    extra = _new_placement(agent, "node_top", {"priority": 50})
    with placements.engine.begin() as conn:
        conn.execute(
            placements.placements.insert().values(
                **_placement_row(extra, event_version=1)
            )
        )
    assert len(placements.list_placements(agent_id=agent["id"])) == 2

    reconcile_single_active_placement(placements)

    active = placements.list_placements(agent_id=agent["id"])
    assert [placement["daemonNodeId"] for placement in active] == ["node_top"]
    assert reconcile_single_active_placement(placements) == []


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
    assert result["status"] == "ready"
    assert result["conditions"] == []


@pytest.mark.parametrize("database", [False, True])
def test_realized_agent_versions_never_move_backward(
    tmp_path: Path, database: bool
) -> None:
    if database:
        database_url = f"sqlite:///{tmp_path}/version.db"
        agents = DatabaseAgentStore(database_url, create_schema=True)
        placements = DatabaseAgentPlacementStore(database_url, create_schema=True)
    else:
        agents = LocalAgentStore(tmp_path)
        placements = LocalAgentPlacementStore(tmp_path)
    agent = agents.create_agent(
        "alice", {"displayName": "Builder", "executorKind": "codex"}
    )
    placement = placements.create_placement(agent, "node_a")

    placements.realize_agent_version(placement["id"], 3)
    placements.realize_agent_version(placement["id"], 2)

    assert placements.get_placement(placement["id"])["agentVersion"] == 3


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


def test_database_placement_store_normalizes_legacy_owner_snapshot(
    tmp_path: Path,
) -> None:
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

    assert placements.get_placement(placement["id"])["supervisorEmployeeId"] == "alice"
