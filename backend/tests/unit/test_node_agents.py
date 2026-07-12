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
