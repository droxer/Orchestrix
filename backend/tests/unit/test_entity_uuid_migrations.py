from __future__ import annotations

import importlib.util
import json
from io import StringIO
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from relay.persistence.agent_placement_store import DatabaseAgentPlacementStore
from relay.persistence.agent_store import DatabaseAgentStore
from relay.persistence.daemon_store import DatabaseDaemonStore
from relay.persistence.session_store import DatabaseSessionStore
from relay.persistence.task_store import DatabaseTaskStore
from relay.persistence.team_store import DatabaseTeamStore
from sqlalchemy import create_engine, text
from sqlalchemy.dialects import postgresql

MIGRATIONS = Path(__file__).parents[2] / "migrations" / "versions"


def _load_migration(filename: str):
    path = MIGRATIONS / filename
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_database_entities_use_primary_uuid_as_their_only_id() -> None:
    assert "public_id" not in DatabaseSessionStore.sessions.c
    assert "public_id" not in DatabaseAgentStore.agents.c
    assert "public_id" not in DatabaseDaemonStore.nodes.c

    columns = (
        DatabaseSessionStore.sessions.c.id,
        DatabaseAgentStore.agents.c.id,
        DatabaseAgentPlacementStore.placements.c.agent_id,
        DatabaseAgentPlacementStore.placements.c.daemon_node_id,
        DatabaseDaemonStore.nodes.c.id,
        DatabaseDaemonStore.runs.c.session_id,
        DatabaseDaemonStore.runs.c.logical_agent_id,
        DatabaseDaemonStore.run_requests.c.session_id,
        DatabaseTaskStore.tasks.c.assigned_agent_id,
        DatabaseTaskStore.task_sessions.c.session_id,
        DatabaseTeamStore.teams.c.lead_agent_id,
    )

    assert {
        column.type.compile(dialect=postgresql.dialect()) for column in columns
    } == {"UUID"}


def test_uuid_backfill_migration_rewrites_relational_and_json_references() -> None:
    session_uuid = "11111111-1111-4111-8111-111111111111"
    agent_uuid = "22222222-2222-4222-8222-222222222222"
    node_uuid = "33333333-3333-4333-8333-333333333333"
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        for statement in (
            "CREATE TABLE sessions (id TEXT PRIMARY KEY, public_id TEXT UNIQUE, snapshot JSON)",
            "CREATE TABLE agents (id TEXT PRIMARY KEY, public_id TEXT UNIQUE, compatibility_key TEXT, snapshot JSON)",
            "CREATE TABLE daemon_nodes (id TEXT PRIMARY KEY, public_id TEXT UNIQUE)",
            "CREATE TABLE task_sessions (session_public_id TEXT)",
            "CREATE TABLE tasks (id TEXT PRIMARY KEY, assigned_agent_id TEXT, snapshot JSON)",
            "CREATE TABLE agent_placements (id TEXT PRIMARY KEY, agent_public_id TEXT, daemon_node_public_id TEXT, snapshot JSON)",
            "CREATE TABLE daemon_commands (id TEXT PRIMARY KEY, node_public_id TEXT, command JSON)",
        ):
            connection.execute(text(statement))
        connection.execute(
            text(
                "INSERT INTO sessions VALUES (:id, 'ses_legacy', :snapshot)"
            ),
            {
                "id": session_uuid,
                "snapshot": json.dumps(
                    {
                        "id": "ses_legacy",
                        "ownerAgentId": "agent_legacy",
                        "daemonNodeId": "sbx_legacy",
                    }
                ),
            },
        )
        connection.execute(
            text(
                "INSERT INTO agents VALUES "
                "(:id, 'agent_legacy', 'alice:sbx_legacy:codex', :snapshot)"
            ),
            {
                "id": agent_uuid,
                "snapshot": json.dumps(
                    {
                        "id": "agent_legacy",
                        "profileImageUrl": "/profile-images/agents/agent_legacy?v=1",
                        "compatibilityKey": "alice:sbx_legacy:codex",
                    }
                ),
            },
        )
        connection.execute(
            text("INSERT INTO daemon_nodes VALUES (:id, 'sbx_legacy')"),
            {"id": node_uuid},
        )
        connection.execute(text("INSERT INTO task_sessions VALUES ('ses_legacy')"))
        connection.execute(
            text("INSERT INTO tasks VALUES ('task', 'agent_legacy', :snapshot)"),
            {"snapshot": json.dumps({"linkedSessionIds": ["ses_legacy"]})},
        )
        connection.execute(
            text(
                "INSERT INTO agent_placements VALUES "
                "('placement', 'agent_legacy', 'sbx_legacy', :snapshot)"
            ),
            {
                "snapshot": json.dumps(
                    {"agentId": "agent_legacy", "daemonNodeId": "sbx_legacy"}
                )
            },
        )
        connection.execute(
            text("INSERT INTO daemon_commands VALUES ('command', 'sbx_legacy', :command)"),
            {"command": json.dumps({"sessionId": "ses_legacy"})},
        )

        migration = _load_migration("20260728_0039_backfill_entity_uuid_ids.py")
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        assert connection.execute(
            text("SELECT public_id FROM sessions")
        ).scalar_one() == session_uuid
        assert connection.execute(
            text("SELECT public_id FROM agents")
        ).scalar_one() == agent_uuid
        agent = connection.execute(
            text("SELECT compatibility_key, snapshot FROM agents")
        ).mappings().one()
        assert agent["compatibility_key"] == f"alice:{node_uuid}:codex"
        assert json.loads(agent["snapshot"])["profileImageUrl"] == (
            f"/profile-images/agents/{agent_uuid}?v=1"
        )
        assert connection.execute(
            text("SELECT public_id FROM daemon_nodes")
        ).scalar_one() == node_uuid
        assert connection.execute(
            text("SELECT session_public_id FROM task_sessions")
        ).scalar_one() == session_uuid
        task = connection.execute(
            text("SELECT assigned_agent_id, snapshot FROM tasks")
        ).mappings().one()
        assert task["assigned_agent_id"] == agent_uuid
        assert json.loads(task["snapshot"])["linkedSessionIds"] == [session_uuid]
        placement = connection.execute(
            text(
                "SELECT agent_public_id, daemon_node_public_id, snapshot "
                "FROM agent_placements"
            )
        ).mappings().one()
        assert placement["agent_public_id"] == agent_uuid
        assert placement["daemon_node_public_id"] == node_uuid
        assert json.loads(placement["snapshot"]) == {
            "agentId": agent_uuid,
            "daemonNodeId": node_uuid,
        }


def test_uuid_schema_migration_converts_entity_reference_columns() -> None:
    migration = _load_migration("20260728_0040_use_uuid_entity_id_columns.py")
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql",
        opts={"as_sql": True, "output_buffer": output},
    )
    migration.op = Operations(context)

    migration.upgrade()

    sql = output.getvalue()
    assert "ALTER TABLE sessions ALTER COLUMN public_id TYPE UUID" in sql
    assert "ALTER TABLE agents ALTER COLUMN public_id TYPE UUID" in sql
    assert "ALTER TABLE daemon_nodes ALTER COLUMN public_id TYPE UUID" in sql
    assert "ALTER TABLE daemon_runs ALTER COLUMN logical_agent_id TYPE UUID" in sql
    assert "ALTER TABLE task_sessions ALTER COLUMN session_public_id TYPE UUID" in sql


def test_legacy_id_contract_migration_drops_public_ids_and_renames_references() -> None:
    migration = _load_migration("20260729_0041_remove_legacy_entity_ids.py")
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql",
        opts={"as_sql": True, "output_buffer": output},
    )
    migration.op = Operations(context)

    migration.upgrade()

    sql = output.getvalue()
    assert "ALTER TABLE sessions DROP COLUMN public_id" in sql
    assert "ALTER TABLE agents DROP COLUMN public_id" in sql
    assert "ALTER TABLE daemon_nodes DROP COLUMN public_id" in sql
    assert (
        "ALTER TABLE task_sessions RENAME session_public_id TO session_id" in sql
    )
    assert "ALTER TABLE daemon_commands DROP COLUMN node_public_id" in sql
