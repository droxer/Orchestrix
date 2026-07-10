from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import UniqueConstraint

from relay.persistence.employee_agent_store import (
    DatabaseEmployeeAgentStore,
    LocalEmployeeAgentStore,
)


def test_employee_can_own_multiple_agents_of_the_same_executor_kind(
    tmp_path: Path,
) -> None:
    store = LocalEmployeeAgentStore(tmp_path)

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
    assert {
        agent["displayName"] for agent in store.list_agents(employee_id="alice")
    } == {"Researcher", "Reviewer"}


def test_agent_names_are_unique_within_an_employee(tmp_path: Path) -> None:
    store = LocalEmployeeAgentStore(tmp_path)
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
    store = LocalEmployeeAgentStore(tmp_path)
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


def test_compatibility_agents_are_idempotent_per_employee_and_executor(
    tmp_path: Path,
) -> None:
    store = LocalEmployeeAgentStore(tmp_path)

    first = store.ensure_compatibility_agent("alice", "codex")
    second = store.ensure_compatibility_agent("alice", "codex")

    assert first["id"] == second["id"]
    assert first["compatibilityKey"] == "alice:codex"


def test_compatibility_agent_does_not_repurpose_an_existing_named_agent(
    tmp_path: Path,
) -> None:
    store = LocalEmployeeAgentStore(tmp_path)
    named = store.create_agent(
        "alice", {"displayName": "Builder", "executorKind": "codex"}
    )

    compatibility = store.ensure_compatibility_agent("alice", "codex")

    assert compatibility["id"] != named["id"]
    assert "compatibilityKey" not in store.get_agent(named["id"])


def test_database_employee_agent_store_matches_local_contract(tmp_path: Path) -> None:
    database_url = f"sqlite:///{tmp_path}/agents.db"
    store = DatabaseEmployeeAgentStore(database_url, create_schema=True)

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
        DatabaseEmployeeAgentStore(database_url).get_agent(agent["id"])["instructions"]
        == "Cite primary sources."
    )
    assert [event["type"] for event in store.events(agent["id"])] == [
        "agent.created",
        "agent.updated",
    ]


def test_database_enforces_employee_scoped_normalized_agent_names() -> None:
    unique_columns = {
        tuple(sorted(column.name for column in constraint.columns))
        for constraint in DatabaseEmployeeAgentStore.agents.constraints
        if isinstance(constraint, UniqueConstraint)
    }

    assert ("display_name_key", "employee_public_id") in unique_columns
