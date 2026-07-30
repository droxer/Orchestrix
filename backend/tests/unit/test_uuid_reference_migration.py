from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text

MIGRATION_PATH = (
    Path(__file__).parents[2]
    / "migrations"
    / "versions"
    / "20260730_0047_uuid_entity_reference_columns.py"
)

ALICE = "91c39ac0-97c0-443d-9f47-3742df658a4b"
ADMIN = "5dadd571-0557-4288-8378-90af89b20c6e"
TEAM = "e3360aae-5a08-4324-9b7d-6a989421faeb"


def load_migration():
    spec = importlib.util.spec_from_file_location("uuid_reference_migration", MIGRATION_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_database() -> tuple[object, object]:
    engine = create_engine("sqlite:///:memory:")
    connection = engine.connect()
    connection.execute(
        text("CREATE TABLE employees (id TEXT PRIMARY KEY, display_name TEXT)")
    )
    connection.execute(
        text(
            "CREATE TABLE agents (id TEXT PRIMARY KEY, "
            "supervisor_employee_id TEXT, snapshot TEXT)"
        )
    )
    connection.execute(
        text(
            "CREATE TABLE agent_placements (id TEXT PRIMARY KEY, "
            "supervisor_employee_id TEXT, snapshot TEXT)"
        )
    )
    connection.execute(
        text("CREATE TABLE tasks (id TEXT PRIMARY KEY, assigned_team_id TEXT, snapshot TEXT)")
    )
    connection.execute(
        text(
            "INSERT INTO employees (id, display_name) VALUES "
            f"('{ALICE}', 'alice'), ('{ADMIN}', 'admin')"
        )
    )
    return engine, connection


def run_upgrade(connection) -> None:
    module = load_migration()
    module.op = Operations(MigrationContext.configure(connection))
    module.upgrade()


def test_legacy_employee_handles_become_employee_uuids() -> None:
    engine, connection = build_database()
    try:
        connection.execute(
            text(
                "INSERT INTO agents (id, supervisor_employee_id, snapshot) VALUES "
                "('a1', 'alice', :snap)"
            ),
            {"snap": json.dumps({"supervisorEmployeeId": "alice", "displayName": "Claude"})},
        )
        run_upgrade(connection)

        row = connection.execute(
            text("SELECT supervisor_employee_id, snapshot FROM agents WHERE id='a1'")
        ).mappings().one()
        assert row["supervisor_employee_id"] == ALICE
        assert json.loads(row["snapshot"])["supervisorEmployeeId"] == ALICE
    finally:
        connection.close()
        engine.dispose()


def test_snapshot_wins_over_a_stale_derived_column() -> None:
    engine, connection = build_database()
    try:
        connection.execute(
            text(
                "INSERT INTO tasks (id, assigned_team_id, snapshot) VALUES "
                "('t1', 'team_mrw9fvau_umxm0g', :snap)"
            ),
            {"snap": json.dumps({"assignedTeamId": TEAM})},
        )
        run_upgrade(connection)

        assert (
            connection.execute(
                text("SELECT assigned_team_id FROM tasks WHERE id='t1'")
            ).scalar()
            == TEAM
        )
    finally:
        connection.close()
        engine.dispose()


def test_column_wins_when_the_snapshot_lacks_the_key() -> None:
    engine, connection = build_database()
    try:
        connection.execute(
            text(
                "INSERT INTO agents (id, supervisor_employee_id, snapshot) VALUES "
                "('a2', :owner, :snap)"
            ),
            {"owner": ADMIN, "snap": json.dumps({"displayName": "Designer"})},
        )
        run_upgrade(connection)

        row = connection.execute(
            text("SELECT supervisor_employee_id, snapshot FROM agents WHERE id='a2'")
        ).mappings().one()
        assert row["supervisor_employee_id"] == ADMIN
        # The snapshot is authoritative, so the recovered value is written back.
        assert json.loads(row["snapshot"])["supervisorEmployeeId"] == ADMIN
    finally:
        connection.close()
        engine.dispose()


def test_dangling_optional_reference_is_cleared() -> None:
    engine, connection = build_database()
    try:
        connection.execute(
            text(
                "INSERT INTO tasks (id, assigned_team_id, snapshot) VALUES "
                "('t2', 'team_gone', :snap)"
            ),
            {"snap": json.dumps({})},
        )
        run_upgrade(connection)

        assert (
            connection.execute(
                text("SELECT assigned_team_id FROM tasks WHERE id='t2'")
            ).scalar()
            is None
        )
    finally:
        connection.close()
        engine.dispose()


def test_unresolvable_required_reference_fails_loudly() -> None:
    engine, connection = build_database()
    try:
        connection.execute(
            text(
                "INSERT INTO agents (id, supervisor_employee_id, snapshot) VALUES "
                "('a3', 'ghost', :snap)"
            ),
            {"snap": json.dumps({"supervisorEmployeeId": "ghost"})},
        )
        with pytest.raises(RuntimeError, match="no matching employee"):
            run_upgrade(connection)
    finally:
        connection.close()
        engine.dispose()
