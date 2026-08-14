from pathlib import Path
from types import SimpleNamespace

import pytest
from relay.persistence.agent_placement_store import (
    LocalAgentPlacementStore,
    create_node_placement,
)
from relay.persistence.agent_store import LocalAgentStore
from relay.persistence.team_store import LocalTeamStore
from relay.services.agent_routing import placement_node
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


def test_managed_agent_sync_tolerates_missing_placement_table(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    ctx = SimpleNamespace(agent_store=agents, agent_placement_store=placements)
    node = {
        "id": "runtime_alice",
        "managedNodeId": "computer_alice",
        "employeeId": "alice",
        "supportedAgents": ["codex"],
        "agents": {"codex": "ready"},
    }

    def missing_table(*_args, **_kwargs):
        raise RuntimeError("no such table: agent_placements")

    monkeypatch.setattr(placements, "list_placements", missing_table)

    sync_node_agents(ctx, node)

    assert agents.list_agents(supervisor_employee_id="alice") == []


def test_each_computer_gets_its_own_compatibility_agents(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    ctx = SimpleNamespace(agent_store=agents, agent_placement_store=placements)
    first = {
        "id": "node_one",
        "displayName": "Box One",
        "employeeId": "alice",
        "supportedAgents": ["codex"],
        "agents": {"codex": "ready"},
    }
    second = {
        "id": "node_two",
        "displayName": "Box Two",
        "employeeId": "alice",
        "supportedAgents": ["codex"],
        "agents": {"codex": "ready"},
    }

    sync_node_agents(ctx, first)
    sync_node_agents(ctx, second)

    # One agent lives on one computer: each computer materializes its own codex
    # agent rather than sharing a single one across both.
    codex_agents = [
        agent
        for agent in agents.list_agents(supervisor_employee_id="alice")
        if agent["executorKind"] == "codex"
    ]
    assert len(codex_agents) == 2
    assert {agent["compatibilityKey"] for agent in codex_agents} == {
        "alice:node:node_one:codex",
        "alice:node:node_two:codex",
    }
    for agent in codex_agents:
        agent_placements = placements.list_placements(agent_id=agent["id"])
        assert len(agent_placements) == 1


def test_existing_legacy_named_agent_is_renamed_to_runtime_name(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    ctx = SimpleNamespace(agent_store=agents, agent_placement_store=placements)
    legacy = agents.create_agent(
        "alice", {"displayName": "Codex · node_alice", "executorKind": "codex", "defaultRole": "implementer"}
    )
    legacy = agents.update_agent(
        legacy["id"], {"compatibilityKey": "alice:node_alice:codex"}
    )
    renamed = agents.create_agent(
        "alice", {"displayName": "Renamed By User", "executorKind": "claude", "defaultRole": "implementer"}
    )
    renamed = agents.update_agent(
        renamed["id"], {"compatibilityKey": "alice:node_alice:claude"}
    )
    node = {
        "id": "node_alice",
        "employeeId": "alice",
        "supportedAgents": ["claude", "codex"],
        "agents": {"claude": "ready", "codex": "ready"},
    }

    sync_node_agents(ctx, node)

    assert agents.get_agent(legacy["id"])["displayName"] == "Codex"
    # A user-renamed agent keeps its custom name.
    assert agents.get_agent(renamed["id"])["displayName"] == "Renamed By User"


def test_deleting_a_computer_removes_only_its_agents(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    ctx = SimpleNamespace(agent_store=agents, agent_placement_store=placements)
    keep = {
        "id": "node_keep",
        "displayName": "Keep",
        "employeeId": "alice",
        "supportedAgents": ["claude"],
        "agents": {"claude": "ready"},
    }
    doomed = {
        "id": "node_doomed",
        "displayName": "Doomed",
        "employeeId": "alice",
        "supportedAgents": ["claude", "codex"],
        "agents": {"claude": "ready", "codex": "ready"},
    }
    sync_node_agents(ctx, keep)
    sync_node_agents(ctx, doomed)

    removed = remove_node_agents(ctx, "node_doomed")

    assert len(removed) == 2
    survivors = agents.list_agents(supervisor_employee_id="alice")
    assert {agent["compatibilityKey"] for agent in survivors} == {
        "alice:node:node_keep:claude"
    }
    assert placements.list_placements(daemon_node_id="node_doomed") == []
    # The surviving computer's agent and placement are untouched.
    assert len(placements.list_placements(daemon_node_id="node_keep")) == 1


def test_removing_agents_sweeps_already_unassigned_node(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    ctx = SimpleNamespace(agent_store=agents, agent_placement_store=placements)
    node = {
        "id": "node_solo",
        "displayName": "Solo",
        "employeeId": "alice",
        "supportedAgents": ["claude"],
        "agents": {"claude": "ready"},
    }
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
        "alice", {"displayName": "Survivor", "executorKind": "claude", "defaultRole": "implementer"}
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
        "alice", {"displayName": "Researcher", "executorKind": "claude", "defaultRole": "implementer"}
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
    agent = agents.ensure_compatibility_agent("alice", "codex", "node_old")
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


def _registry_ctx(
    tmp_path: Path,
    nodes: list[dict],
    active_requests: list[dict] | None = None,
    historical_runtime_ids: set[str] | None = None,
):
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    ctx = SimpleNamespace(
        agent_store=agents,
        agent_placement_store=placements,
        registry=SimpleNamespace(
            monitor_nodes=lambda: nodes,
            dispatch_lock=None,
            daemon_store=SimpleNamespace(
                list_active_run_requests=lambda: active_requests or [],
                historical_managed_runtime_ids=lambda _managed_node_id: (
                    historical_runtime_ids or set()
                ),
            ),
        ),
    )
    return ctx, agents, placements


def test_reregistration_retires_superseded_compatibility_agent(tmp_path: Path) -> None:
    old_node = {
        "id": "node_old",
        "employeeId": "alice",
        "workspacePath": "/home/alice/proj",
        "workspaceId": "machine-a",
        "online": False,
    }
    new_node = {
        "id": "node_new",
        "employeeId": "alice",
        "workspacePath": "/home/alice/proj",
        "workspaceId": "machine-a",
        "supportedAgents": ["claude"],
        "agents": {"claude": "ready"},
        "online": True,
    }
    ctx, agents, placements = _registry_ctx(tmp_path, [old_node, new_node])
    stale = agents.ensure_compatibility_agent("alice", "claude", "node_old")
    placements.create_placement(stale, "node_old")

    sync_node_agents(ctx, new_node)

    survivors = agents.list_agents(supervisor_employee_id="alice")
    assert {agent["compatibilityKey"] for agent in survivors} == {
        "alice:device:alice:machine-a:claude"
    }
    assert agents.get_agent(stale["id"]).get("deletedAt")
    assert placements.list_placements(daemon_node_id="node_old") == []
    assert len(placements.list_placements(daemon_node_id="node_new")) == 1


def test_reregistration_without_workspace_id_keeps_both_agents(
    tmp_path: Path,
) -> None:
    """Pre-machine-id daemons that only ever reported ``workspacePath`` don't
    get retired across a re-registration.

    Without a ``workspaceId``, `computer_id` falls back to ``node:{id}`` — so
    each node id counts as its own Computer and two nodes can never be
    recognized as "the same machine, re-provisioned under a new id". That is
    a real loss of dedup for such very old daemons (see
    `test_reregistration_retires_superseded_compatibility_agent` for the
    current, `workspaceId`-reporting case that still retires correctly), but
    retiring an agent is destructive — wrongly treating two distinct
    computers as one would delete a compatibility agent that is still in
    use. The conservative direction is the safe one, so both agents survive.
    """
    old_node = {
        "id": "node_old",
        "employeeId": "alice",
        "workspacePath": "/home/alice/proj",
        "online": False,
    }
    new_node = {
        "id": "node_new",
        "employeeId": "alice",
        "workspacePath": "/home/alice/proj",
        "supportedAgents": ["claude"],
        "agents": {"claude": "ready"},
        "online": True,
    }
    ctx, agents, placements = _registry_ctx(tmp_path, [old_node, new_node])
    stale = agents.ensure_compatibility_agent("alice", "claude", "node_old")
    placements.create_placement(stale, "node_old")

    sync_node_agents(ctx, new_node)

    survivors = agents.list_agents(supervisor_employee_id="alice")
    assert {agent["compatibilityKey"] for agent in survivors} == {
        "alice:node_old:claude",
        "alice:node:node_new:claude",
    }
    assert agents.get_agent(stale["id"]).get("deletedAt") is None


def test_sync_keeps_agent_on_a_different_computer(tmp_path: Path) -> None:
    other_node = {
        "id": "node_other",
        "employeeId": "alice",
        "workspacePath": "/home/alice/other",
        "online": False,
    }
    new_node = {
        "id": "node_new",
        "employeeId": "alice",
        "workspacePath": "/home/alice/proj",
        "supportedAgents": ["claude"],
        "agents": {"claude": "ready"},
        "online": True,
    }
    ctx, agents, placements = _registry_ctx(tmp_path, [other_node, new_node])
    other = agents.ensure_compatibility_agent("alice", "claude", "node_other")
    placements.create_placement(other, "node_other")

    sync_node_agents(ctx, new_node)

    survivors = agents.list_agents(supervisor_employee_id="alice")
    assert {agent["compatibilityKey"] for agent in survivors} == {
        "alice:node:node_new:claude",
        "alice:node_other:claude",
    }
    assert not agents.get_agent(other["id"]).get("deletedAt")


def test_sync_keeps_agent_while_the_old_node_is_online(tmp_path: Path) -> None:
    old_node = {
        "id": "node_old",
        "employeeId": "alice",
        "workspacePath": "/home/alice/proj",
        "online": True,
    }
    new_node = {
        "id": "node_new",
        "employeeId": "alice",
        "workspacePath": "/home/alice/proj",
        "supportedAgents": ["claude"],
        "agents": {"claude": "ready"},
        "online": True,
    }
    ctx, agents, placements = _registry_ctx(tmp_path, [old_node, new_node])
    stale = agents.ensure_compatibility_agent("alice", "claude", "node_old")
    placements.create_placement(stale, "node_old")

    sync_node_agents(ctx, new_node)

    assert not agents.get_agent(stale["id"]).get("deletedAt")
    assert len(placements.list_placements(daemon_node_id="node_old")) == 1


def test_sync_keeps_agent_when_old_node_has_active_work(tmp_path: Path) -> None:
    old_node = {
        "id": "node_old",
        "employeeId": "alice",
        "workspacePath": "/home/alice/proj",
        "online": False,
    }
    new_node = {
        "id": "node_new",
        "employeeId": "alice",
        "workspacePath": "/home/alice/proj",
        "supportedAgents": ["claude"],
        "agents": {"claude": "ready"},
        "online": True,
    }
    ctx, agents, placements = _registry_ctx(
        tmp_path,
        [old_node, new_node],
        active_requests=[{"nodeId": "node_old", "assignments": []}],
    )
    stale = agents.ensure_compatibility_agent("alice", "claude", "node_old")
    placements.create_placement(stale, "node_old")

    sync_node_agents(ctx, new_node)

    assert not agents.get_agent(stale["id"]).get("deletedAt")


def test_managed_nodes_share_workspace_path_without_being_the_same_computer(
    tmp_path: Path,
) -> None:
    old_node = {
        "id": "node_old",
        "employeeId": "alice",
        "workspacePath": "/workspace",
        "managedNodeId": "managed_old",
        "online": False,
    }
    new_node = {
        "id": "node_new",
        "employeeId": "alice",
        "workspacePath": "/workspace",
        "managedNodeId": "managed_new",
        "supportedAgents": ["claude"],
        "agents": {"claude": "ready"},
        "online": True,
    }
    ctx, agents, placements = _registry_ctx(tmp_path, [old_node, new_node])
    stale = agents.ensure_compatibility_agent("alice", "claude", "node_old")
    placements.create_placement(stale, "node_old")

    sync_node_agents(ctx, new_node)

    assert not agents.get_agent(stale["id"]).get("deletedAt")


def test_sync_retires_legacy_two_segment_agent_on_same_node(tmp_path: Path) -> None:
    """A pre-node-scoped ``<employee>:<kind>`` agent placed on the same computer
    as its node-scoped replacement is a duplicate and must be retired."""
    node = {
        "id": "node_local",
        "employeeId": "alice",
        "workspacePath": "/home/alice/proj",
        "supportedAgents": ["claude"],
        "agents": {"claude": "ready"},
        "online": True,
    }
    ctx, agents, placements = _registry_ctx(tmp_path, [node])
    legacy = agents.create_agent(
        "alice", {"displayName": "Captain America", "executorKind": "claude", "defaultRole": "implementer"}
    )
    legacy = agents.update_agent(legacy["id"], {"compatibilityKey": "alice:claude"})
    placements.create_placement(legacy, "node_local")

    sync_node_agents(ctx, node)

    survivors = agents.list_agents(supervisor_employee_id="alice")
    assert {agent["compatibilityKey"] for agent in survivors} == {
        "alice:node:node_local:claude"
    }
    assert agents.get_agent(legacy["id"]).get("deletedAt")


def test_sync_keeps_legacy_agent_on_a_different_node(tmp_path: Path) -> None:
    """A legacy agent placed on a different computer is not a duplicate of the
    registering node's agent and must survive."""
    other = {
        "id": "node_other",
        "employeeId": "alice",
        "workspacePath": "/home/alice/other",
        "online": True,
    }
    node = {
        "id": "node_local",
        "employeeId": "alice",
        "workspacePath": "/home/alice/proj",
        "supportedAgents": ["claude"],
        "agents": {"claude": "ready"},
        "online": True,
    }
    ctx, agents, placements = _registry_ctx(tmp_path, [other, node])
    legacy = agents.create_agent(
        "alice", {"displayName": "Captain America", "executorKind": "claude", "defaultRole": "implementer"}
    )
    legacy = agents.update_agent(legacy["id"], {"compatibilityKey": "alice:claude"})
    placements.create_placement(legacy, "node_other")

    sync_node_agents(ctx, node)

    assert not agents.get_agent(legacy["id"]).get("deletedAt")


def test_reprovisioned_managed_node_retires_old_runtime_identity(tmp_path: Path) -> None:
    new_node = {
        "id": "node_new",
        "employeeId": "alice",
        "workspacePath": "/workspace",
        "managedNodeId": "managed_one",
        "supportedAgents": ["claude"],
        "agents": {"claude": "ready"},
        "online": True,
    }
    ctx, agents, placements = _registry_ctx(
        tmp_path,
        [new_node],
        historical_runtime_ids={"node_old", "node_new"},
    )
    stale = agents.ensure_compatibility_agent("alice", "claude", "node_old")
    placements.create_placement(stale, "node_old")

    sync_node_agents(ctx, new_node)

    [current] = agents.list_agents(supervisor_employee_id="alice")
    assert current["id"] != stale["id"]
    assert current["compatibilityKey"] == "alice:managed:managed_one:claude"
    assert agents.get_agent(stale["id"]).get("deletedAt")
    [placement] = placements.list_placements(agent_id=current["id"])
    assert placement["daemonNodeId"] == "node_new"


def test_agent_stays_routable_after_a_new_node_id_without_rebinding(
    tmp_path: Path,
) -> None:
    old_node = {
        "id": "node-old",
        "employeeId": "alice",
        "workspaceId": "machine-a",
        "supportedAgents": ["claude"],
        "workspacePath": "/w",
    }
    ctx, _agents, placements_store = _registry_ctx(tmp_path, [old_node])
    sync_node_agents(ctx, old_node)
    [placement] = placements_store.list_placements()

    new_node = {**old_node, "id": "node-new", "online": True, "status": "ready"}

    assert placement_node(placement, {"node-new": new_node})["id"] == "node-new"
    assert placement["daemonNodeId"] == "node-old"


def test_reprovisioned_managed_computer_preserves_agent_and_placement_identity(
    tmp_path: Path,
) -> None:
    old_node = {
        "id": "runtime_old",
        "employeeId": "alice",
        "workspacePath": "/workspace",
        "managedNodeId": "computer_one",
        "supportedAgents": ["claude"],
        "agents": {"claude": "ready"},
        "online": False,
    }
    new_node = {
        **old_node,
        "id": "runtime_new",
        "online": True,
    }
    nodes = [old_node]
    ctx, agents, placements = _registry_ctx(tmp_path, nodes)

    sync_node_agents(ctx, old_node)
    original_agent = agents.list_agents(supervisor_employee_id="alice")[0]
    original_placement = placements.list_placements(agent_id=original_agent["id"])[0]
    nodes[:] = [new_node]

    sync_node_agents(ctx, new_node)

    current_agents = agents.list_agents(supervisor_employee_id="alice")
    assert [agent["id"] for agent in current_agents] == [original_agent["id"]]
    assert current_agents[0]["compatibilityKey"] == "alice:managed:computer_one:claude"
    current_placement = placements.list_placements(agent_id=original_agent["id"])[0]
    assert current_placement["id"] == original_placement["id"]
    assert current_placement["daemonNodeId"] == "runtime_old"
    assert placement_node(current_placement, {"runtime_new": new_node}) == new_node


def test_reprovisioned_managed_computer_keeps_custom_agent_placement(
    tmp_path: Path,
) -> None:
    old_node = {
        "id": "runtime_old",
        "employeeId": "alice",
        "workspacePath": "/workspace",
        "managedNodeId": "computer_one",
        "supportedAgents": ["codex"],
        "agents": {"codex": "ready"},
        "online": False,
    }
    new_node = {**old_node, "id": "runtime_new", "online": True}
    nodes = [old_node]
    ctx, agents, placements = _registry_ctx(
        tmp_path,
        nodes,
        historical_runtime_ids={"runtime_old", "runtime_new"},
    )
    custom = agents.create_agent(
        "alice", {"displayName": "Release Builder", "executorKind": "codex", "defaultRole": "implementer"}
    )
    original = create_node_placement(placements, custom, old_node)

    sync_node_agents(ctx, old_node)
    nodes[:] = [new_node]
    sync_node_agents(ctx, new_node)

    assert not agents.get_agent(custom["id"]).get("deletedAt")
    [preserved] = placements.list_placements(agent_id=custom["id"])
    assert preserved["id"] == original["id"]
    assert preserved["daemonNodeId"] == "runtime_old"
    assert preserved["managedNodeId"] == "computer_one"
    assert placement_node(preserved, {"runtime_new": new_node}) == new_node


def test_managed_sync_does_not_retire_agent_from_another_managed_computer(
    tmp_path: Path,
) -> None:
    current = {
        "id": "runtime_current",
        "employeeId": "alice",
        "workspacePath": "/workspace/current",
        "managedNodeId": "computer_current",
        "supportedAgents": ["codex"],
        "agents": {"codex": "ready"},
        "online": True,
    }
    ctx, agents, placements = _registry_ctx(
        tmp_path,
        [current],
        historical_runtime_ids={"runtime_current"},
    )
    other = agents.ensure_compatibility_agent(
        "alice",
        "codex",
        "runtime_other",
        computer_id="computer_other",
    )
    other_placement = placements.create_placement(
        other,
        "runtime_other",
        {"managedNodeId": "computer_other"},
    )

    sync_node_agents(ctx, current)

    assert not agents.get_agent(other["id"]).get("deletedAt")
    assert placements.get_placement(other_placement["id"])["desiredState"] == "active"


def test_managed_reprovision_keeps_placement_for_missing_old_runtime(
    tmp_path: Path,
) -> None:
    old_node = {
        "id": "runtime_missing",
        "employeeId": "alice",
        "workspacePath": "/workspace",
        "managedNodeId": "computer_one",
        "supportedAgents": ["claude"],
        "agents": {"claude": "ready"},
        "online": False,
    }
    new_node = {
        **old_node,
        "id": "runtime_new",
        "online": True,
    }
    nodes = [old_node]
    ctx, agents, placements = _registry_ctx(tmp_path, nodes)
    sync_node_agents(ctx, old_node)
    original_agent_id = agents.list_agents(supervisor_employee_id="alice")[0]["id"]
    nodes[:] = [new_node]

    sync_node_agents(ctx, new_node)

    survivors = agents.list_agents(supervisor_employee_id="alice")
    assert [agent["id"] for agent in survivors] == [original_agent_id]
    [preserved] = placements.list_placements(agent_id=original_agent_id)
    assert preserved["daemonNodeId"] == "runtime_missing"
    assert placement_node(preserved, {"runtime_new": new_node}) == new_node


def test_managed_runtime_replacement_keeps_placement_routable(
    tmp_path: Path,
) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    ctx = SimpleNamespace(agent_store=agents, agent_placement_store=placements)
    first = {
        "id": "runtime_one",
        "managedNodeId": "computer_managed",
        "employeeId": "alice",
        "supportedAgents": ["claude"],
        "agents": {"claude": "ready"},
    }
    sync_node_agents(ctx, first)

    replacement = {**first, "id": "runtime_two"}
    sync_node_agents(ctx, replacement)

    agent = next(
        agent
        for agent in agents.list_agents(supervisor_employee_id="alice")
        if agent["compatibilityKey"] == "alice:managed:computer_managed:claude"
    )
    [placement] = placements.list_placements(agent_id=agent["id"])
    assert placement["daemonNodeId"] == "runtime_one"
    assert placement["managedNodeId"] == "computer_managed"
    assert placement_node(placement, {"runtime_two": replacement}) == replacement


def test_soft_deleted_employee_does_not_get_agents_rematerialized(
    tmp_path: Path,
) -> None:
    """Deleting an employee deletes their agents; the next node registration
    must not resurrect them."""
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    auth_store = SimpleNamespace(
        list_employees=lambda: [{"id": "bob"}],  # alice was soft-deleted
    )
    ctx = SimpleNamespace(
        agent_store=agents,
        agent_placement_store=placements,
        auth_store=auth_store,
    )
    node = {
        "id": "node_alice",
        "employeeId": "alice",
        "supportedAgents": ["claude"],
        "agents": {"claude": "ready"},
    }

    sync_node_agents(ctx, node)

    assert agents.list_agents(supervisor_employee_id="alice") == []
    assert placements.list_placements(daemon_node_id="node_alice") == []


def test_live_employee_still_gets_agents_materialized(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    auth_store = SimpleNamespace(list_employees=lambda: [{"id": "alice"}])
    ctx = SimpleNamespace(
        agent_store=agents,
        agent_placement_store=placements,
        auth_store=auth_store,
    )
    node = {
        "id": "node_alice",
        "employeeId": "alice",
        "supportedAgents": ["claude"],
        "agents": {"claude": "ready"},
    }

    sync_node_agents(ctx, node)

    assert len(agents.list_agents(supervisor_employee_id="alice")) == 1
