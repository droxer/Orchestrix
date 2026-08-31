from __future__ import annotations

import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text

MIGRATION_PATH = (
    Path(__file__).parents[2]
    / "migrations"
    / "versions"
    / "20260831_0064_claim_local_enrollments.py"
)


def load_migration():
    spec = importlib.util.spec_from_file_location(
        "local_enrollment_claim_migration", MIGRATION_PATH
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_retires_only_unlaunched_duplicate_enrollments() -> None:
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE daemon_nodes (
                    id TEXT PRIMARY KEY,
                    employee_id TEXT,
                    workspace_path TEXT,
                    workspace_id TEXT,
                    managed_node_id TEXT,
                    retired_at TIMESTAMP,
                    status TEXT NOT NULL,
                    created_at TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP NOT NULL
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO daemon_nodes VALUES
                    ('ready', 'alice', '/Users/alice/project', 'machine-a', NULL,
                     NULL, 'ready', '2026-01-01', '2026-01-01'),
                    ('orphan', 'alice', '/Users/alice/project', NULL, NULL,
                     NULL, 'provisioning', '2026-01-02', '2026-01-02'),
                    ('other-machine', 'alice', '/Users/alice/project', 'machine-b', NULL,
                     NULL, 'ready', '2026-01-03', '2026-01-03'),
                    ('other-path', 'alice', '/Users/alice/other', NULL, NULL,
                     NULL, 'provisioning', '2026-01-04', '2026-01-04')
                """
            )
        )
        migration = load_migration()
        migration.op = Operations(MigrationContext.configure(connection))

        migration.upgrade()

        rows = {
            row["id"]: row
            for row in connection.execute(
                text(
                    "SELECT id, enrollment_key, retired_at FROM daemon_nodes "
                    "ORDER BY id"
                )
            ).mappings()
        }
        assert rows["ready"]["enrollment_key"]
        assert rows["ready"]["retired_at"] is None
        assert rows["orphan"]["enrollment_key"] is None
        assert rows["orphan"]["retired_at"] is not None
        assert rows["other-machine"]["enrollment_key"] is None
        assert rows["other-machine"]["retired_at"] is None
        assert rows["other-path"]["enrollment_key"]
        assert rows["other-path"]["retired_at"] is None
