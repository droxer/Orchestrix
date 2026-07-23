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
    / "20260723_0033_backfill_local_daemon_node_location.py"
)


def load_migration():
    spec = importlib.util.spec_from_file_location(
        "daemon_node_location_migration", MIGRATION_PATH
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_backfills_only_control_plane_assignments() -> None:
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE daemon_nodes (
                    public_id TEXT PRIMARY KEY,
                    employee_id TEXT,
                    managed_node_id TEXT,
                    node_location TEXT
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE daemon_events (
                    node_public_id TEXT,
                    type TEXT NOT NULL
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO daemon_nodes
                    (public_id, employee_id, managed_node_id, node_location)
                VALUES
                    ('assigned', 'alice', NULL, NULL),
                    ('self_reported', 'alice', NULL, NULL),
                    ('managed', 'alice', 'managed_alice', 'managed'),
                    ('explicit_local', 'alice', NULL, 'employee-device')
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO daemon_events (node_public_id, type)
                VALUES ('assigned', 'daemon.node.assigned')
                """
            )
        )
        migration = load_migration()
        migration.op = Operations(MigrationContext.configure(connection))

        migration.upgrade()

        locations = dict(
            connection.execute(
                text(
                    "SELECT public_id, node_location FROM daemon_nodes "
                    "ORDER BY public_id"
                )
            ).all()
        )
        assert locations == {
            "assigned": "employee-device",
            "explicit_local": "employee-device",
            "managed": "managed",
            "self_reported": None,
        }
