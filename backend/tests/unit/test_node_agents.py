from pathlib import Path
from types import SimpleNamespace

import pytest

from relay.persistence.agent_placement_store import LocalAgentPlacementStore
from relay.persistence.agent_store import LocalAgentStore
from relay.persistence.team_store import LocalTeamStore
from relay.services.node_agents import remove_node_agents, sync_node_agents


def test_node_capabilities_materialize_agents_and_placements(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    ctx = SimpleNamespace(agent_store=agents, agent_placement_store=placements)
    node = {
        "id": "node_alice",
        "employeeId": "alice",
        "supportedAgents": ["claude", "codex"],
        "agents": {"claude": "ready", "codex": "ready"},
    }

    sync_node_agents(ctx, node)
    sync_node_agents(ctx, node)

    materialized = agents.list_agents(supervisor_employee_id="alice")
    assert {agent["executorKind"] for agent in materialized} == {"claude", "codex"}
    assert all(agent.get("compatibilityKey") for agent in materialized)
    assert len(placements.list_placements(daemon_node_id="node_alice")) == 2


def test_each_computer_gets_its_own_compatibility_agents(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    ctx = SimpleNamespace(agent_store=agents, agent_placement_store=placements)
    first = {"id": "node_one", "displayName": "Box One", "employeeId": "alice", "supportedAgents": ["codex"], "agents": {"codex": "ready"}}
    second = {"id": "node_two", "displayName": "Box Two", "employeeId": "alice", "supportedAgents": ["codex"], "agents": {"codex": "ready"}}

    sync_node_agents(ctx, first)
    sync_node_agents(ctx, second)

    # One agent lives on one computer: each computer materializes its own codex
    # agent rather than sharing a single one across both.
    codex_agents = [agent for agent in agents.list_agents(supervisor_employee_id="alice") if agent["executorKind"] == "codex"]
    assert len(codex_agents) == 2
    assert {agent["compatibilityKey"] for agent in codex_agents} == {"alice:node_one:codex", "alice:node_two:codex"}
    for agent in codex_agents:
        agent_placements = placements.list_placements(agent_id=agent["id"])
        assert len(agent_placements) == 1


def test_deleting_a_computer_removes_only_its_agents(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    ctx = SimpleNamespace(agent_store=agents, agent_placement_store=placements)
    keep = {"id": "node_keep", "displayName": "Keep", "employeeId": "alice", "supportedAgents": ["claude"], "agents": {"claude": "ready"}}
    doomed = {"id": "node_doomed", "displayName": "Doomed", "employeeId": "alice", "supportedAgents": ["claude", "codex"], "agents": {"claude": "ready", "codex": "ready"}}
    sync_node_agents(ctx, keep)
    sync_node_agents(ctx, doomed)

    removed = remove_node_agents(ctx, "node_doomed")

    assert len(removed) == 2
    survivors = agents.list_agents(supervisor_employee_id="alice")
    assert {agent["compatibilityKey"] for agent in survivors} == {"alice:node_keep:claude"}
    assert placements.list_placements(daemon_node_id="node_doomed") == []
    # The surviving computer's agent and placement are untouched.
    assert len(placements.list_placements(daemon_node_id="node_keep")) == 1


def test_removing_agents_sweeps_already_unassigned_node(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    ctx = SimpleNamespace(agent_store=agents, agent_placement_store=placements)
    node = {"id": "node_solo", "displayName": "Solo", "employeeId": "alice", "supportedAgents": ["claude"], "agents": {"claude": "ready"}}
    sync_node_agents(ctx, node)
    # Simulate an unassign that retired the placement but left the agent behind.
    (placement,) = placements.list_placements(daemon_node_id="node_solo")
    placements.update_placement(placement["id"], {"desiredState": "removed"})

    removed = remove_node_agents(ctx, "node_solo")

    assert len(removed) == 1
    assert agents.list_agents(supervisor_employee_id="alice") == []


def test_removing_node_agents_updates_team_membership(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    teams = LocalTeamStore(tmp_path)
    ctx = SimpleNamespace(
        agent_store=agents,
        agent_placement_store=placements,
        team_store=teams,
    )
    node = {
        "id": "node_doomed",
        "employeeId": "alice",
        "supportedAgents": ["codex"],
        "agents": {"codex": "ready"},
    }
    sync_node_agents(ctx, node)
    doomed = agents.list_agents(supervisor_employee_id="alice")[0]
    survivor = agents.create_agent(
        "alice", {"displayName": "Survivor", "executorKind": "claude"}
    )
    team = teams.create_team(
        "alice",
        {
            "name": "Delivery",
            "leadAgentId": doomed["id"],
            "memberAgentIds": [doomed["id"], survivor["id"]],
        },
    )

    remove_node_agents(ctx, "node_doomed")

    updated = teams.get_team(team["id"])
    assert updated["leadAgentId"] == survivor["id"]
    assert updated["memberAgentIds"] == [survivor["id"]]


def test_removing_node_retires_custom_logical_agent_with_no_other_computer(
    tmp_path: Path,
) -> None:
    """One agent = one computer: deleting the computer orphans every agent on
    it — custom agents included — so they must leave the roster too."""
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    ctx = SimpleNamespace(
        agent_store=agents,
        agent_placement_store=placements,
    )
    custom = agents.create_agent(
        "alice", {"displayName": "Researcher", "executorKind": "claude"}
    )
    placement = placements.create_placement(custom, "node_doomed")

    removed = remove_node_agents(ctx, "node_doomed")

    assert removed == [custom["id"]]
    assert agents.get_agent(custom["id"]).get("deletedAt")
    assert placements.get_placement(placement["id"])["desiredState"] == "removed"


def test_removing_old_node_keeps_compatibility_agent_moved_elsewhere(
    tmp_path: Path,
) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    ctx = SimpleNamespace(
        agent_store=agents,
        agent_placement_store=placements,
    )
    agent = agents.ensure_compatibility_agent(
        "alice", "codex", "node_old", node_name="Old computer"
    )
    old_placement = placements.create_placement(agent, "node_old")
    new_placement = placements.create_placement(agent, "node_new")

    removed = remove_node_agents(ctx, "node_old")

    assert removed == []
    assert not agents.get_agent(agent["id"]).get("deletedAt")
    assert placements.get_placement(old_placement["id"])["desiredState"] == "removed"
    assert placements.get_placement(new_placement["id"])["desiredState"] == "active"


def test_removing_node_waits_for_active_agent_runs(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    node = {
        "id": "node_busy",
        "employeeId": "alice",
        "supportedAgents": ["codex"],
        "agents": {"codex": "ready"},
    }
    ctx = SimpleNamespace(
        agent_store=agents,
        agent_placement_store=placements,
        registry=SimpleNamespace(
            daemon_store=SimpleNamespace(
                list_active_run_requests=lambda: [
                    {
                        "nodeId": "node_busy",
                        "assignments": [{"daemonNodeId": "node_busy"}],
                    }
                ]
            )
        ),
    )
    sync_node_agents(ctx, node)
    agent = agents.list_agents(supervisor_employee_id="alice")[0]
    placement = placements.list_placements(agent_id=agent["id"])[0]

    with pytest.raises(ValueError, match="active agent work"):
        remove_node_agents(ctx, "node_busy")

    assert not agents.get_agent(agent["id"]).get("deletedAt")
    assert placements.get_placement(placement["id"])["desiredState"] == "active"
