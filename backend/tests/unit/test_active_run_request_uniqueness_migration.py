from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError


MIGRATION_PATH = (
    Path(__file__).parents[2]
    / "migrations"
    / "versions"
    / "20260719_0030_enforce_active_session_run_request.py"
)


def load_migration():
    spec = importlib.util.spec_from_file_location(
        "active_run_request_uniqueness_migration", MIGRATION_PATH
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_reconciles_existing_active_duplicates_before_index() -> None:
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE daemon_run_requests (
                    id TEXT PRIMARY KEY,
                    session_public_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    current_command_public_id TEXT,
                    current_run_public_id TEXT,
                    error TEXT,
                    created_at TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP NOT NULL,
                    completed_at TIMESTAMP
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE daemon_commands (
                    public_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    error TEXT,
                    updated_at TIMESTAMP NOT NULL,
                    completed_at TIMESTAMP,
                    lease_id TEXT,
                    lease_expires_at TIMESTAMP
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE daemon_runs (
                    public_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    error TEXT,
                    completed_at TIMESTAMP
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO daemon_commands
                    (public_id, status, updated_at, lease_id, lease_expires_at)
                VALUES
                    ('cmd_second', 'dispatched', '2026-01-02', 'lease', '2026-01-03')
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO daemon_runs (public_id, status)
                VALUES ('run_second', 'running')
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO daemon_run_requests
                    (
                        id,
                        session_public_id,
                        status,
                        current_command_public_id,
                        current_run_public_id,
                        created_at,
                        updated_at
                    )
                VALUES
                    (
                        'first', 'ses_shared', 'running', NULL, NULL,
                        '2026-01-01', '2026-01-01'
                    ),
                    (
                        'second', 'ses_shared', 'dispatching',
                        'cmd_second', 'run_second', '2026-01-02', '2026-01-02'
                    )
                """
            )
        )
        migration = load_migration()
        migration.op = Operations(MigrationContext.configure(connection))

        migration.upgrade()

        rows = connection.execute(
            text(
                """
                SELECT id, status, error, completed_at
                FROM daemon_run_requests
                ORDER BY id
                """
            )
        ).mappings().all()
        assert rows[0]["status"] == "running"
        assert rows[1]["status"] == "failed"
        assert rows[1]["error"]
        assert rows[1]["completed_at"] is not None
        command = connection.execute(
            text(
                """
                SELECT status, error, completed_at, lease_id, lease_expires_at
                FROM daemon_commands
                WHERE public_id = 'cmd_second'
                """
            )
        ).mappings().one()
        assert command["status"] == "cancelled"
        assert command["error"]
        assert command["completed_at"] is not None
        assert command["lease_id"] is None
        assert command["lease_expires_at"] is None
        run = connection.execute(
            text(
                """
                SELECT status, error, completed_at
                FROM daemon_runs
                WHERE public_id = 'run_second'
                """
            )
        ).mappings().one()
        assert run["status"] == "cancelled"
        assert run["error"]
        assert run["completed_at"] is not None
        with pytest.raises(IntegrityError):
            connection.execute(
                text(
                    """
                    INSERT INTO daemon_run_requests
                        (id, session_public_id, status, created_at, updated_at)
                    VALUES
                        ('third', 'ses_shared', 'running', '2026-01-03', '2026-01-03')
                    """
                )
            )
