from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from relay.persistence.agent_placement_store import LocalAgentPlacementStore
from relay.persistence.agent_store import LocalAgentStore
from relay.persistence.team_store import LocalTeamStore
from relay.services.team_placement import (
    TeamPlacementError,
    assert_teams_stay_colocated,
    move_team,
    teams_blocking_placement_change,
)


def _node(node_id: str, *agents: str) -> dict[str, Any]:
    return {"id": node_id, "supportedAgents": list(agents) or ["claude", "codex"]}


@pytest.fixture()
def stores(tmp_path: Path):
    return (
        LocalTeamStore(tmp_path),
        LocalAgentPlacementStore(tmp_path),
        LocalAgentStore(tmp_path),
    )


def _team_of_two(stores, lead_node: str = "node_a", support_node: str = "node_a"):
    teams, placements, agents = stores
    lead = agents.create_agent(
        "alice", {"displayName": "Lead", "executorKind": "codex"}
    )
    support = agents.create_agent(
        "alice", {"displayName": "Support", "executorKind": "claude"}
    )
    placements.create_placement(lead, lead_node)
    placements.create_placement(support, support_node)
    team = teams.create_team(
        "alice",
        {
            "name": "Delivery",
            "leadAgentId": lead["id"],
            "memberAgentIds": [lead["id"], support["id"]],
        },
    )
    return team, lead, support


def test_moving_a_team_member_to_another_computer_is_refused(stores) -> None:
    teams, placements, _agents = stores
    _team, lead, _support = _team_of_two(stores)

    with pytest.raises(TeamPlacementError) as error:
        assert_teams_stay_colocated(teams, placements, lead, "node_b")

    assert error.value.code == "team_members_different_nodes"


def test_unplacing_a_team_member_is_refused(stores) -> None:
    teams, placements, _agents = stores
    _team, _lead, support = _team_of_two(stores)

    with pytest.raises(TeamPlacementError) as error:
        assert_teams_stay_colocated(teams, placements, support, None)

    assert error.value.code == "team_member_unplaced"


def test_the_only_member_of_a_team_may_move(stores) -> None:
    teams, placements, agents = stores
    solo = agents.create_agent(
        "alice", {"displayName": "Solo", "executorKind": "codex"}
    )
    placements.create_placement(solo, "node_a")
    teams.create_team(
        "alice",
        {
            "name": "Solo crew",
            "leadAgentId": solo["id"],
            "memberAgentIds": [solo["id"]],
        },
    )

    assert_teams_stay_colocated(teams, placements, solo, "node_b")


def test_a_drifted_member_may_move_back_onto_its_team_computer(stores) -> None:
    teams, placements, _agents = stores
    _team, _lead, support = _team_of_two(stores, support_node="node_b")

    assert_teams_stay_colocated(teams, placements, support, "node_a")


def test_an_agent_on_no_team_may_move_freely(stores) -> None:
    teams, placements, agents = stores
    loner = agents.create_agent(
        "alice", {"displayName": "Loner", "executorKind": "codex"}
    )
    placements.create_placement(loner, "node_a")

    assert_teams_stay_colocated(teams, placements, loner, "node_b")
    assert_teams_stay_colocated(teams, placements, loner, None)


def test_a_deleted_team_no_longer_constrains_its_members(stores) -> None:
    teams, placements, _agents = stores
    team, lead, _support = _team_of_two(stores)
    teams.delete_team(team["id"])

    assert_teams_stay_colocated(teams, placements, lead, "node_b")


def test_teams_blocking_placement_change_ignores_solo_teams(stores) -> None:
    teams, _placements, agents = stores
    solo = agents.create_agent(
        "alice", {"displayName": "Solo", "executorKind": "codex"}
    )
    teams.create_team(
        "alice",
        {
            "name": "Solo crew",
            "leadAgentId": solo["id"],
            "memberAgentIds": [solo["id"]],
        },
    )
    _team, lead, _support = _team_of_two(stores)

    assert teams_blocking_placement_change(teams, solo) == []
    assert [team["name"] for team in teams_blocking_placement_change(teams, lead)] == [
        "Delivery"
    ]


def test_move_team_relocates_every_member(stores) -> None:
    teams, placements, agents = stores
    team, lead, support = _team_of_two(stores)

    move_team(teams, placements, agents, team, _node("node_b"))

    assert [
        placement["daemonNodeId"]
        for placement in placements.list_placements(agent_id=lead["id"])
    ] == ["node_b"]
    assert [
        placement["daemonNodeId"]
        for placement in placements.list_placements(agent_id=support["id"])
    ] == ["node_b"]


def test_move_team_refuses_a_computer_a_member_cannot_run_on(stores) -> None:
    teams, placements, agents = stores
    team, lead, _support = _team_of_two(stores)

    with pytest.raises(TeamPlacementError) as error:
        move_team(teams, placements, agents, team, _node("node_b", "codex"))

    assert error.value.code == "team_member_executor_unavailable"
    assert [
        placement["daemonNodeId"]
        for placement in placements.list_placements(agent_id=lead["id"])
    ] == ["node_a"]


def test_move_team_restores_every_member_when_a_move_fails(stores) -> None:
    teams, placements, agents = stores
    team, lead, support = _team_of_two(stores)
    original = placements.create_placement

    def fail_on_second(agent: dict[str, Any], node_id: str, payload=None):
        if agent["id"] == support["id"]:
            raise RuntimeError("placement store is unavailable")
        return original(agent, node_id, payload)

    placements.create_placement = fail_on_second  # type: ignore[method-assign]
    with pytest.raises(RuntimeError):
        move_team(teams, placements, agents, team, _node("node_b"))
    placements.create_placement = original  # type: ignore[method-assign]

    assert [
        placement["daemonNodeId"]
        for placement in placements.list_placements(agent_id=lead["id"])
    ] == ["node_a"]
    assert [
        placement["daemonNodeId"]
        for placement in placements.list_placements(agent_id=support["id"])
    ] == ["node_a"]
