from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from relay.persistence.agent_placement_store import DatabaseAgentPlacementStore
from relay.persistence.agent_store import DatabaseAgentStore
from relay.persistence.daemon_store import DatabaseDaemonStore
from relay.persistence.team_store import DatabaseTeamStore
from relay.security.auth import DatabaseUserAuthStore
from relay.services.employee_lifecycle import cascade_engine, soft_delete_employee


class RaisingManagedNodeStore:
    """Stands in for the managed-node store failing mid-cascade."""

    def __init__(self, error: Exception | None = None):
        self.error = error

    def list_nodes(self) -> list[dict]:
        if self.error:
            raise self.error
        return []

    def update_node(self, node_id: str, patch: dict) -> dict:  # pragma: no cover
        raise AssertionError("not reached")


def build_context(tmp_path: Path, managed_node_store: object) -> SimpleNamespace:
    url = f"sqlite:///{tmp_path}/relay.db"
    auth_store = DatabaseUserAuthStore(url, create_schema=True)
    agent_store = DatabaseAgentStore(url)
    placement_store = DatabaseAgentPlacementStore(url)
    team_store = DatabaseTeamStore(url)
    daemon_store = DatabaseDaemonStore(url)
    registry = SimpleNamespace(
        daemon_store=daemon_store,
        sandboxes={},
        unassign_employee_everywhere=lambda employee_id: [],
        get=lambda node_id: None,
        fence_managed_node=lambda node_id: None,
    )
    return SimpleNamespace(
        auth_store=auth_store,
        agent_store=agent_store,
        agent_placement_store=placement_store,
        team_store=team_store,
        registry=registry,
        managed_node_store=managed_node_store,
    )


def seed_employee(ctx: SimpleNamespace) -> tuple[str, str]:
    user = ctx.auth_store.create_user("alice", "userpass", display_name="Alice")
    employee_id = user["employeeId"]
    agent = ctx.agent_store.create_agent(
        employee_id, {"displayName": "Planner", "executorKind": "claude", "defaultRole": "implementer"}
    )
    return employee_id, agent["id"]


def test_cascade_stores_share_one_engine(tmp_path: Path) -> None:
    ctx = build_context(tmp_path, RaisingManagedNodeStore())

    assert cascade_engine(ctx) is ctx.auth_store.engine


def test_successful_cascade_deletes_employee_and_agents(tmp_path: Path) -> None:
    ctx = build_context(tmp_path, RaisingManagedNodeStore())
    employee_id, agent_id = seed_employee(ctx)

    result = soft_delete_employee(ctx, employee_id)

    assert result["deletedAgents"] == [agent_id]
    assert ctx.auth_store.list_employees() == []
    assert ctx.agent_store.list_agents(supervisor_employee_id=employee_id) == []


def test_failure_midway_leaves_the_employee_and_agents_intact(tmp_path: Path) -> None:
    """The whole cascade is one transaction.

    Without it, the employee was already marked deleted and their agents gone
    by the time the managed-node step failed, leaving no way to finish or undo.
    """
    ctx = build_context(tmp_path, RaisingManagedNodeStore(RuntimeError("provider down")))
    employee_id, agent_id = seed_employee(ctx)

    with pytest.raises(RuntimeError, match="provider down"):
        soft_delete_employee(ctx, employee_id)

    assert [item["id"] for item in ctx.auth_store.list_employees()] == [employee_id]
    live_agents = ctx.agent_store.list_agents(supervisor_employee_id=employee_id)
    assert [agent["id"] for agent in live_agents] == [agent_id]


def test_failure_restores_in_memory_registry_nodes(tmp_path: Path) -> None:
    ctx = build_context(tmp_path, RaisingManagedNodeStore(RuntimeError("provider down")))
    employee_id, _ = seed_employee(ctx)
    ctx.registry.sandboxes["node_a"] = {"id": "node_a", "employeeId": employee_id}

    def drop_employee(_employee_id: str) -> list[str]:
        ctx.registry.sandboxes["node_a"] = {"id": "node_a"}
        return ["node_a"]

    ctx.registry.unassign_employee_everywhere = drop_employee

    with pytest.raises(RuntimeError, match="provider down"):
        soft_delete_employee(ctx, employee_id)

    assert ctx.registry.sandboxes["node_a"]["employeeId"] == employee_id


def test_file_backed_stores_have_no_shared_engine(tmp_path: Path) -> None:
    ctx = SimpleNamespace(
        auth_store=SimpleNamespace(),
        agent_store=SimpleNamespace(),
        agent_placement_store=SimpleNamespace(),
        team_store=SimpleNamespace(),
        registry=SimpleNamespace(daemon_store=SimpleNamespace()),
    )

    assert cascade_engine(ctx) is None
