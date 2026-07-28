from __future__ import annotations

from pathlib import Path

import pytest
from relay.persistence.agent_placement_store import LocalAgentPlacementStore
from relay.persistence.agent_store import LocalAgentStore
from relay.services.agent_routing import AgentRoutingError, resolve_agent_assignments


def node(
    node_id: str,
    executor: str,
    *,
    workspace: str = "/shared/workspace",
    workspace_id: str | None = None,
) -> dict:
    return {
        "id": node_id,
        "online": True,
        "stale": False,
        "status": "ready",
        "agents": {executor: "ready"},
        "workspacePath": workspace,
        **({"workspaceId": workspace_id} if workspace_id else {}),
        "activeRuns": [],
        "maxConcurrentRuns": 1,
    }


def test_rejects_collaboration_across_nodes_even_with_shared_workspace(
    tmp_path: Path,
) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    researcher = agents.create_agent(
        "alice",
        {
            "displayName": "Researcher",
            "executorKind": "claude",
            "instructions": "Compare sources before answering.",
        },
    )
    builder = agents.create_agent(
        "alice", {"displayName": "Builder", "executorKind": "codex"}
    )
    placements.create_placement(
        researcher, "node_a", {"workspacePolicy": {"kind": "shared-path"}}
    )
    placements.create_placement(
        builder, "node_b", {"workspacePolicy": {"kind": "shared-path"}}
    )

    with pytest.raises(AgentRoutingError) as error:
        resolve_agent_assignments(
            [
                {"agentId": researcher["id"], "mode": "ask"},
                {"agentId": builder["id"], "mode": "action"},
            ],
            employee_id="alice",
            is_admin=False,
            agent_store=agents,
            placement_store=placements,
            daemon_nodes=[
                node("node_a", "claude", workspace_id="repo:relay"),
                node("node_b", "codex", workspace_id="repo:relay"),
            ],
        )

    assert error.value.code == "workspace_unavailable"


def test_agents_on_same_computer_resolve_together(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    researcher = agents.create_agent(
        "alice", {"displayName": "Researcher", "executorKind": "claude"}
    )
    builder = agents.create_agent(
        "alice", {"displayName": "Builder", "executorKind": "codex"}
    )
    placements.create_placement(researcher, "node_a")
    placements.create_placement(builder, "node_a")
    computer = {
        **node("node_a", "claude"),
        "agents": {"claude": "ready", "codex": "ready"},
        "maxConcurrentRuns": 2,
    }

    resolved = resolve_agent_assignments(
        [
            {"agentId": researcher["id"], "mode": "ask"},
            {"agentId": builder["id"], "mode": "action"},
        ],
        employee_id="alice",
        is_admin=False,
        agent_store=agents,
        placement_store=placements,
        daemon_nodes=[computer],
    )

    assert [item["daemonNodeId"] for item in resolved] == ["node_a", "node_a"]


def test_employee_cannot_route_another_employees_agent(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    agent = agents.create_agent(
        "alice", {"displayName": "Researcher", "executorKind": "claude"}
    )
    placements.create_placement(agent, "node_a")

    with pytest.raises(AgentRoutingError) as error:
        resolve_agent_assignments(
            [{"agentId": agent["id"], "mode": "ask"}],
            employee_id="bob",
            is_admin=False,
            agent_store=agents,
            placement_store=placements,
            daemon_nodes=[node("node_a", "claude")],
        )

    assert error.value.code == "agent_forbidden"


def test_managed_capacity_does_not_replace_a_healthy_local_placement(
    tmp_path: Path,
) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    agent = agents.create_agent(
        "alice", {"displayName": "Builder", "executorKind": "codex"}
    )
    local_placement = placements.create_placement(agent, "node_local")
    local_node = {**node("node_local", "codex"), "employeeId": "alice"}
    managed_node = {
        **node("node_managed", "codex"),
        "employeeId": "alice",
        "managedNodeId": "managed_alice",
    }

    [resolved] = resolve_agent_assignments(
        [{"agentId": agent["id"], "mode": "action"}],
        employee_id="alice",
        is_admin=False,
        agent_store=agents,
        placement_store=placements,
        daemon_nodes=[local_node, managed_node],
    )

    assert resolved["daemonNodeId"] == "node_local"
    active = placements.list_placements(agent_id=agent["id"])
    assert [placement["id"] for placement in active] == [local_placement["id"]]


def test_legacy_nonempty_policy_blocks_dispatch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    agent = agents.create_agent(
        "alice", {"displayName": "Restricted", "executorKind": "codex"}
    )
    placements.create_placement(agent, "node_a")
    get_agent = agents.get_agent

    def legacy_agent(agent_id: str) -> dict | None:
        current = get_agent(agent_id)
        return (
            {**current, "toolPolicy": {"allowedTools": ["read"]}} if current else None
        )

    monkeypatch.setattr(agents, "get_agent", legacy_agent)

    with pytest.raises(AgentRoutingError) as error:
        resolve_agent_assignments(
            [{"agentId": agent["id"], "mode": "action"}],
            employee_id="alice",
            is_admin=False,
            agent_store=agents,
            placement_store=placements,
            daemon_nodes=[node("node_a", "codex")],
        )

    assert error.value.code == "agent_policy_unsupported"


def test_canonical_workspace_id_does_not_override_node_scope(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    researcher = agents.create_agent(
        "alice", {"displayName": "Researcher", "executorKind": "claude"}
    )
    builder = agents.create_agent(
        "alice", {"displayName": "Builder", "executorKind": "codex"}
    )
    placements.create_placement(
        researcher, "node_a", {"workspacePolicy": {"kind": "shared-path"}}
    )
    placements.create_placement(
        builder, "node_b", {"workspacePolicy": {"kind": "shared-path"}}
    )

    with pytest.raises(AgentRoutingError) as error:
        resolve_agent_assignments(
            [{"agentId": researcher["id"]}, {"agentId": builder["id"]}],
            employee_id="alice",
            is_admin=False,
            agent_store=agents,
            placement_store=placements,
            daemon_nodes=[
                node(
                    "node_a",
                    "claude",
                    workspace="/mnt/a/relay",
                    workspace_id="repo:relay",
                ),
                node(
                    "node_b",
                    "codex",
                    workspace="D:/work/relay",
                    workspace_id="repo:relay",
                ),
            ],
        )

    assert error.value.code == "workspace_unavailable"


def test_node_affine_placements_reject_cross_node_workflow(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    researcher = agents.create_agent(
        "alice", {"displayName": "Researcher", "executorKind": "claude"}
    )
    builder = agents.create_agent(
        "alice", {"displayName": "Builder", "executorKind": "codex"}
    )
    placements.create_placement(researcher, "node_a")
    placements.create_placement(builder, "node_b")

    with pytest.raises(AgentRoutingError) as error:
        resolve_agent_assignments(
            [{"agentId": researcher["id"]}, {"agentId": builder["id"]}],
            employee_id="alice",
            is_admin=False,
            agent_store=agents,
            placement_store=placements,
            daemon_nodes=[
                node("node_a", "claude", workspace_id="repo:relay"),
                node("node_b", "codex", workspace_id="repo:relay"),
            ],
        )

    assert error.value.code == "workspace_unavailable"


def test_different_workspace_ids_reject_cross_node_workflow(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    first = agents.create_agent(
        "alice", {"displayName": "First", "executorKind": "claude"}
    )
    second = agents.create_agent(
        "alice", {"displayName": "Second", "executorKind": "codex"}
    )
    placements.create_placement(first, "node_a")
    placements.create_placement(second, "node_b")

    with pytest.raises(AgentRoutingError) as error:
        resolve_agent_assignments(
            [{"agentId": first["id"]}, {"agentId": second["id"]}],
            employee_id="alice",
            is_admin=False,
            agent_store=agents,
            placement_store=placements,
            daemon_nodes=[
                node("node_a", "claude", workspace_id="repo:first"),
                node("node_b", "codex", workspace_id="repo:second"),
            ],
        )

    assert error.value.code == "workspace_unavailable"


def test_node_affine_session_rejects_followup_on_different_node(
    tmp_path: Path,
) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    first = agents.create_agent(
        "alice", {"displayName": "First", "executorKind": "claude"}
    )
    second = agents.create_agent(
        "alice", {"displayName": "Second", "executorKind": "codex"}
    )
    first_placement = placements.create_placement(first, "node_a")
    placements.create_placement(second, "node_b")
    session = {
        "id": "ses_existing",
        "workspacePath": "/workspace/alice",
        "agentRuns": [
            {
                "logicalAgentId": first["id"],
                "placementId": first_placement["id"],
                "daemonNodeId": "node_a",
            }
        ],
    }

    with pytest.raises(AgentRoutingError) as error:
        resolve_agent_assignments(
            [{"agentId": second["id"], "mode": "action"}],
            employee_id="alice",
            is_admin=False,
            agent_store=agents,
            placement_store=placements,
            daemon_nodes=[
                node("node_a", "claude", workspace_id="repo:relay"),
                node("node_b", "codex", workspace_id="repo:relay"),
            ],
            session=session,
        )

    assert error.value.code == "workspace_unavailable"


def test_session_without_prior_run_does_not_invent_node_affinity(
    tmp_path: Path,
) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    agent = agents.create_agent(
        "alice", {"displayName": "Builder", "executorKind": "codex"}
    )
    placements.create_placement(agent, "node_a")

    resolved = resolve_agent_assignments(
        [{"agentId": agent["id"], "mode": "action"}],
        employee_id="alice",
        is_admin=False,
        agent_store=agents,
        placement_store=placements,
        daemon_nodes=[
            node(
                "node_a",
                "codex",
                workspace="/host/alice",
                workspace_id="employee:alice:home",
            )
        ],
        session={
            "id": "ses_fresh",
            "workspacePath": "/workspace",
            "agentRuns": [],
        },
    )

    assert resolved[0]["daemonNodeId"] == "node_a"


def test_node_affine_session_rejects_workspace_drift_on_same_node_id(
    tmp_path: Path,
) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    agent = agents.create_agent(
        "alice", {"displayName": "Builder", "executorKind": "codex"}
    )
    placement = placements.create_placement(agent, "node_a")
    session = {
        "id": "ses_existing",
        "workspacePath": "/workspace",
        "agentRuns": [
            {
                "logicalAgentId": agent["id"],
                "placementId": placement["id"],
                "daemonNodeId": "node_a",
                "workspaceIdentity": {"kind": "id", "value": "repo:original"},
            }
        ],
    }

    with pytest.raises(AgentRoutingError) as error:
        resolve_agent_assignments(
            [{"agentId": agent["id"], "mode": "action"}],
            employee_id="alice",
            is_admin=False,
            agent_store=agents,
            placement_store=placements,
            daemon_nodes=[node("node_a", "codex", workspace_id="repo:replacement")],
            session=session,
        )

    assert error.value.code == "workspace_unavailable"


def test_managed_runtime_replacement_keeps_existing_session_affinity(
    tmp_path: Path,
) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    agent = agents.create_agent(
        "alice", {"displayName": "Builder", "executorKind": "codex"}
    )
    placement = placements.create_placement(agent, "node_old")
    session = {
        "id": "ses_existing",
        "daemonNodeId": "node_old",
        "workspacePath": "/workspace",
        "agentRuns": [
            {
                "logicalAgentId": agent["id"],
                "placementId": placement["id"],
                "daemonNodeId": "node_old",
                "workspaceIdentity": {
                    "kind": "id",
                    "value": "managed:computer_one",
                },
            }
        ],
    }
    placements.rebind_placement(placement["id"], "node_new")

    resolved = resolve_agent_assignments(
        [{"agentId": agent["id"], "mode": "action"}],
        employee_id="alice",
        is_admin=False,
        agent_store=agents,
        placement_store=placements,
        daemon_nodes=[
            {
                **node(
                    "node_new",
                    "codex",
                    workspace_id="managed:computer_one",
                ),
                "managedNodeId": "computer_one",
                "employeeId": "alice",
            }
        ],
        session=session,
    )

    assert resolved[0]["daemonNodeId"] == "node_new"


def test_shared_path_session_rejects_followup_on_different_node(
    tmp_path: Path,
) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    first = agents.create_agent(
        "alice", {"displayName": "First", "executorKind": "claude"}
    )
    second = agents.create_agent(
        "alice", {"displayName": "Second", "executorKind": "codex"}
    )
    first_placement = placements.create_placement(
        first, "node_a", {"workspacePolicy": {"kind": "shared-path"}}
    )
    placements.create_placement(
        second, "node_b", {"workspacePolicy": {"kind": "shared-path"}}
    )
    session = {
        "id": "ses_existing",
        "workspacePath": "/workspace/alice",
        "agentRuns": [
            {
                "logicalAgentId": first["id"],
                "placementId": first_placement["id"],
                "daemonNodeId": "node_a",
            }
        ],
    }

    with pytest.raises(AgentRoutingError) as error:
        resolve_agent_assignments(
            [{"agentId": second["id"], "mode": "action"}],
            employee_id="alice",
            is_admin=False,
            agent_store=agents,
            placement_store=placements,
            daemon_nodes=[
                node("node_a", "claude", workspace_id="repo:relay"),
                node("node_b", "codex", workspace_id="repo:relay"),
            ],
            session=session,
        )

    assert error.value.code == "workspace_unavailable"


def test_offline_agent_returns_stable_reason(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    agent = agents.create_agent(
        "alice", {"displayName": "Builder", "executorKind": "codex"}
    )
    placements.create_placement(agent, "node_a")

    with pytest.raises(AgentRoutingError) as error:
        resolve_agent_assignments(
            [{"agentId": agent["id"], "mode": "action"}],
            employee_id="alice",
            is_admin=False,
            agent_store=agents,
            placement_store=placements,
            daemon_nodes=[{**node("node_a", "codex"), "online": False}],
        )

    assert error.value.code == "node_offline"


def test_saturated_placement_returns_capacity_exhausted(tmp_path: Path) -> None:
    agents = LocalAgentStore(tmp_path)
    placements = LocalAgentPlacementStore(tmp_path)
    agent = agents.create_agent(
        "alice", {"displayName": "Builder", "executorKind": "codex"}
    )
    placements.create_placement(agent, "node_a")
    saturated = {
        **node("node_a", "codex"),
        "status": "running",
        "activeRuns": [{"sessionId": "ses_other", "mode": "action"}],
    }

    with pytest.raises(AgentRoutingError) as error:
        resolve_agent_assignments(
            [{"agentId": agent["id"], "mode": "action"}],
            employee_id="alice",
            is_admin=False,
            agent_store=agents,
            placement_store=placements,
            daemon_nodes=[saturated],
        )

    assert error.value.code == "capacity_exhausted"
