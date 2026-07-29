from __future__ import annotations

from pathlib import Path
from uuid import UUID

import pytest
from relay.persistence.agent_store import (
    DatabaseAgentStore,
    LocalAgentStore,
)
from sqlalchemy import UniqueConstraint


@pytest.mark.parametrize("store_kind", ["local", "database"])
def test_agent_stores_create_uuid_agent_ids(tmp_path: Path, store_kind: str) -> None:
    store = (
        LocalAgentStore(tmp_path / "local")
        if store_kind == "local"
        else DatabaseAgentStore(
            f"sqlite:///{tmp_path}/agents.db", create_schema=True
        )
    )

    agent = store.create_agent(
        "alice", {"displayName": "Researcher", "executorKind": "claude"}
    )

    assert str(UUID(agent["id"])) == agent["id"]


def test_employee_can_own_multiple_agents_of_the_same_executor_kind(
    tmp_path: Path,
) -> None:
    store = LocalAgentStore(tmp_path)

    researcher = store.create_agent(
        "alice", {"displayName": "Researcher", "executorKind": "claude"}
    )
    reviewer = store.create_agent(
        "alice",
        {
            "displayName": "Reviewer",
            "executorKind": "claude",
            "defaultRole": "reviewer",
        },
    )

    assert researcher["executorKind"] == reviewer["executorKind"] == "claude"
    assert "defaultRole" not in researcher
    assert reviewer["defaultRole"] == "reviewer"
    assert {
        agent["displayName"] for agent in store.list_agents(supervisor_employee_id="alice")
    } == {"Researcher", "Reviewer"}


def test_agent_names_are_unique_within_an_employee(tmp_path: Path) -> None:
    store = LocalAgentStore(tmp_path)
    store.create_agent("alice", {"displayName": "Researcher", "executorKind": "claude"})

    with pytest.raises(ValueError, match="already has an agent named"):
        store.create_agent(
            "alice", {"displayName": "researcher", "executorKind": "codex"}
        )

    assert store.create_agent(
        "bob", {"displayName": "Researcher", "executorKind": "codex"}
    )


def test_agent_updates_are_event_sourced_and_configuration_increments_version(
    tmp_path: Path,
) -> None:
    store = LocalAgentStore(tmp_path)
    agent = store.create_agent(
        "alice", {"displayName": "Builder", "executorKind": "codex"}
    )

    renamed = store.update_agent(agent["id"], {"displayName": "Implementer"})
    configured = store.update_agent(agent["id"], {"instructions": "Work test-first."})

    assert renamed["version"] == 1
    assert configured["version"] == 2
    assert [event["type"] for event in store.events(agent["id"])] == [
        "agent.created",
        "agent.updated",
        "agent.updated",
    ]


def test_database_agent_store_matches_local_contract(tmp_path: Path) -> None:
    database_url = f"sqlite:///{tmp_path}/agents.db"
    store = DatabaseAgentStore(database_url, create_schema=True)

    agent = store.create_agent(
        "alice",
        {
            "displayName": "Researcher",
            "executorKind": "claude",
            "instructions": "Cite sources.",
        },
    )
    updated = store.update_agent(agent["id"], {"instructions": "Cite primary sources."})

    assert updated["version"] == 2
    assert (
        DatabaseAgentStore(database_url).get_agent(agent["id"])["instructions"]
        == "Cite primary sources."
    )
    assert [event["type"] for event in store.events(agent["id"])] == [
        "agent.created",
        "agent.updated",
    ]


def test_database_agent_store_normalizes_legacy_owner_snapshot(tmp_path: Path) -> None:
    database_url = f"sqlite:///{tmp_path}/legacy-agents.db"
    store = DatabaseAgentStore(database_url, create_schema=True)
    agent = store.create_agent(
        "alice", {"displayName": "Builder", "executorKind": "codex"}
    )
    legacy = {**agent, "employeeId": "alice"}
    legacy.pop("supervisorEmployeeId")
    with store.engine.begin() as conn:
        conn.execute(
            store.agents.update()
            .where(store.agents.c.id == agent["id"])
            .values(snapshot=legacy)
        )

    assert store.get_agent(agent["id"])["supervisorEmployeeId"] == "alice"


def test_database_enforces_employee_scoped_normalized_agent_names() -> None:
    unique_columns = {
        tuple(sorted(column.name for column in constraint.columns))
        for constraint in DatabaseAgentStore.agents.constraints
        if isinstance(constraint, UniqueConstraint)
    }

    assert ("display_name_key", "supervisor_employee_public_id") in unique_columns
