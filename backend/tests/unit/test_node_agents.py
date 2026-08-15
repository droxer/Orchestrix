from pathlib import Path
from types import SimpleNamespace

import pytest
from relay.core.computer_identity import computer_id
from relay.persistence.agent_placement_store import (
    LocalAgentPlacementStore,
    create_node_placement,
)
from relay.persistence.agent_store import LocalAgentStore
from relay.persistence.team_store import LocalTeamStore
from relay.services.agent_routing import placement_node
from relay.services.node_agents import remove_node_agents, sync_node_agents


def test_managed_agent_sync_tolerates_missing_agent_table(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """During a rolling upgrade the agents table may not exist yet on this
    replica; sync must not crash the node registration path."""
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    ctx = SimpleNamespace(agent_store=agents, agent_placement_store=placements)
    node = {
        "id": "runtime_alice",
        "managedNodeId": "computer_alice",
        "employeeId": "alice",
        "supportedAgents": ["codex"],
    }

    def missing_table(*_args, **_kwargs):
        raise RuntimeError("no such table: agents")

    monkeypatch.setattr(agents, "list_agents", missing_table)

    sync_node_agents(ctx, node)  # must not raise

    assert placements.list_placements(daemon_node_id="runtime_alice") == []


def test_deleting_a_computer_removes_only_its_agents(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    ctx = SimpleNamespace(agent_store=agents, agent_placement_store=placements)
    keep = {
        "id": "node_keep",
        "displayName": "Keep",
        "employeeId": "alice",
        "supportedAgents": ["claude"],
    }
    doomed = {
        "id": "node_doomed",
        "displayName": "Doomed",
        "employeeId": "alice",
        "supportedAgents": ["claude", "codex"],
    }
    keep_agent = agents.create_agent(
        "alice",
        {
            "displayName": "Keep Agent",
            "executorKind": "claude",
            "defaultRole": "implementer",
            "computerId": computer_id(keep),
        },
    )
    doomed_claude = agents.create_agent(
        "alice",
        {
            "displayName": "Doomed Claude",
            "executorKind": "claude",
            "defaultRole": "implementer",
            "computerId": computer_id(doomed),
        },
    )
    doomed_codex = agents.create_agent(
        "alice",
        {
            "displayName": "Doomed Codex",
            "executorKind": "codex",
            "defaultRole": "implementer",
            "computerId": computer_id(doomed),
        },
    )
    sync_node_agents(ctx, keep)
    sync_node_agents(ctx, doomed)

    removed = remove_node_agents(ctx, "node_doomed")

    assert set(removed) == {doomed_claude["id"], doomed_codex["id"]}
    survivors = agents.list_agents(supervisor_employee_id="alice")
    assert [agent["id"] for agent in survivors] == [keep_agent["id"]]
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
    }
    agent = agents.create_agent(
        "alice",
        {
            "displayName": "Solo Agent",
            "executorKind": "claude",
            "defaultRole": "implementer",
            "computerId": computer_id(node),
        },
    )
    sync_node_agents(ctx, node)
    # Simulate an unassign that retired the placement but left the agent behind.
    (placement,) = placements.list_placements(daemon_node_id="node_solo")
    placements.update_placement(placement["id"], {"desiredState": "removed"})

    removed = remove_node_agents(ctx, "node_solo")

    assert removed == [agent["id"]]
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
    }
    doomed = agents.create_agent(
        "alice",
        {
            "displayName": "Doomed",
            "executorKind": "codex",
            "defaultRole": "implementer",
            "computerId": computer_id(node),
        },
    )
    sync_node_agents(ctx, node)
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
    agents.create_agent(
        "alice",
        {
            "displayName": "Busy",
            "executorKind": "codex",
            "defaultRole": "implementer",
            "computerId": computer_id(node),
        },
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


def test_agent_stays_routable_after_a_new_node_id_without_rebinding(
    tmp_path: Path,
) -> None:
    """A declared agent's placement stays keyed to the node id it landed on;
    routing to whatever node currently answers for that id is a lookup at
    read time (`placement_node`), not a rebind on every sync."""
    old_node = {
        "id": "node-old",
        "employeeId": "alice",
        "workspaceId": "machine-a",
        "supportedAgents": ["claude"],
        "workspacePath": "/w",
    }
    ctx, agents, placements_store = _registry_ctx(tmp_path, [old_node])
    agents.create_agent(
        "alice",
        {
            "displayName": "Ada",
            "executorKind": "claude",
            "defaultRole": "implementer",
            "computerId": computer_id(old_node),
        },
    )
    sync_node_agents(ctx, old_node)
    [placement] = placements_store.list_placements()

    new_node = {**old_node, "id": "node-new", "online": True, "status": "ready"}

    assert placement_node(placement, {"node-new": new_node})["id"] == "node-new"
    assert placement["daemonNodeId"] == "node-old"


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
        "online": False,
    }
    new_node = {
        **old_node,
        "id": "runtime_new",
        "online": True,
    }
    nodes = [old_node]
    ctx, agents, placements = _registry_ctx(tmp_path, nodes)
    agents.create_agent(
        "alice",
        {
            "displayName": "Ada",
            "executorKind": "claude",
            "defaultRole": "implementer",
            "computerId": computer_id(old_node),
        },
    )
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
    }
    agent = agents.create_agent(
        "alice",
        {
            "displayName": "Ada",
            "executorKind": "claude",
            "defaultRole": "implementer",
            "computerId": computer_id(first),
        },
    )
    sync_node_agents(ctx, first)

    replacement = {**first, "id": "runtime_two"}
    sync_node_agents(ctx, replacement)

    [placement] = placements.list_placements(agent_id=agent["id"])
    assert placement["daemonNodeId"] == "runtime_one"
    assert placement["managedNodeId"] == "computer_managed"
    assert placement_node(placement, {"runtime_two": replacement}) == replacement


def test_soft_deleted_employee_does_not_get_a_placement_backfilled(
    tmp_path: Path,
) -> None:
    """Deleting an employee must stop their already-declared agents from
    getting a placement backfilled by a node that keeps registering."""
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
    }
    agent = agents.create_agent(
        "alice",
        {
            "displayName": "Ada",
            "executorKind": "claude",
            "defaultRole": "implementer",
            "computerId": computer_id(node),
        },
    )

    sync_node_agents(ctx, node)

    assert placements.list_placements(agent_id=agent["id"]) == []
    assert placements.list_placements(daemon_node_id="node_alice") == []


def test_live_employee_still_gets_a_placement_backfilled(tmp_path: Path) -> None:
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
    }
    agent = agents.create_agent(
        "alice",
        {
            "displayName": "Ada",
            "executorKind": "claude",
            "defaultRole": "implementer",
            "computerId": computer_id(node),
        },
    )

    sync_node_agents(ctx, node)

    assert len(placements.list_placements(agent_id=agent["id"])) == 1


def test_registration_no_longer_conjures_agents(tmp_path) -> None:
    """Registering a computer no longer conjures an agent — agents are only declared by employees."""
    ctx, agents, _ = _registry_ctx(tmp_path, nodes=[])
    node = {
        "id": "node-1",
        "employeeId": "alice",
        "workspaceId": "machine-a",
        "supportedAgents": ["claude", "codex"],
        "workspacePath": "/w",
    }
    sync_node_agents(ctx, node)
    assert agents.list_agents(supervisor_employee_id="alice") == []


def test_sync_backfills_a_placement_for_a_declared_agent(tmp_path) -> None:
    """An agent an employee declared while its computer was offline gets picked up once the computer comes online."""
    ctx, agents, placements = _registry_ctx(tmp_path, nodes=[])
    agent = agents.create_agent(
        "alice",
        {
            "displayName": "Ada",
            "executorKind": "claude",
            "defaultRole": "implementer",
            "computerId": "device:alice:machine-a",
        },
    )
    assert placements.list_placements(agent_id=agent["id"]) == []

    node = {
        "id": "node-1",
        "employeeId": "alice",
        "workspaceId": "machine-a",
        "supportedAgents": ["claude"],
        "workspacePath": "/w",
        "online": True,
        "status": "ready",
    }
    sync_node_agents(ctx, node)
    placed = placements.list_placements(agent_id=agent["id"])
    assert len(placed) == 1
    assert placed[0]["daemonNodeId"] == "node-1"


def test_sync_does_not_backfill_across_computers(tmp_path) -> None:
    ctx, agents, placements = _registry_ctx(tmp_path, nodes=[])
    agent = agents.create_agent(
        "alice",
        {
            "displayName": "Ada",
            "executorKind": "claude",
            "defaultRole": "implementer",
            "computerId": "device:alice:machine-OTHER",
        },
    )
    node = {
        "id": "node-1",
        "employeeId": "alice",
        "workspaceId": "machine-a",
        "supportedAgents": ["claude"],
        "workspacePath": "/w",
        "online": True,
        "status": "ready",
    }
    sync_node_agents(ctx, node)
    assert placements.list_placements(agent_id=agent["id"]) == []


def test_sync_only_backfills_runtimes_with_ready_status(tmp_path) -> None:
    """`node["agents"]` always carries every AGENT_NAMES key regardless of
    what's actually installed, so `available` must be built from entries
    whose status is "ready" — not from a raw key union of that dict. This
    node has no `supportedAgents` at all, so the only way to (incorrectly)
    consider "codex" available is to fold in every key of `agents`
    regardless of status."""
    ctx, agents, placements = _registry_ctx(tmp_path, nodes=[])
    node = {
        "id": "node-1",
        "employeeId": "alice",
        "workspaceId": "machine-a",
        "workspacePath": "/w",
        "agents": {"claude": "ready", "codex": "unknown"},
        "online": True,
        "status": "ready",
    }
    agent = agents.create_agent(
        "alice",
        {
            "displayName": "Codex Runner",
            "executorKind": "codex",
            "defaultRole": "implementer",
            "computerId": computer_id(node),
        },
    )

    sync_node_agents(ctx, node)

    assert placements.list_placements(agent_id=agent["id"]) == []
