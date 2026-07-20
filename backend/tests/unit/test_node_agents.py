from pathlib import Path
from types import SimpleNamespace

from relay.persistence.agent_placement_store import LocalAgentPlacementStore
from relay.persistence.agent_store import LocalAgentStore
from relay.services.node_agents import sync_node_agents


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
