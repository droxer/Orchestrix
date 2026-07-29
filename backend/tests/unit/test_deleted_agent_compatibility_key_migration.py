from __future__ import annotations

import importlib.util
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

MIGRATIONS = Path(__file__).parents[2] / "migrations" / "versions"
DELETED_AGENT_ID = "00000000-0000-4000-8000-000000000001"
ACTIVE_AGENT_ID = "00000000-0000-4000-8000-000000000002"


def _load_migration(filename: str) -> Any:
    spec = importlib.util.spec_from_file_location(
        filename.removesuffix(".py"), MIGRATIONS / filename
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_releases_only_deleted_agent_compatibility_keys() -> None:
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    agents = sa.Table(
        "agents",
        metadata,
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("compatibility_key", sa.Text(), unique=True),
        sa.Column("event_version", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
    )
    agent_events = sa.Table(
        "agent_events",
        metadata,
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("agent_id", sa.Text(), nullable=False),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.UniqueConstraint("agent_id", "sequence"),
    )
    metadata.create_all(engine)
    with engine.begin() as connection:
        deleted_at = datetime(2026, 7, 29, tzinfo=UTC)
        connection.execute(
            agents.insert(),
            [
                {
                    "id": DELETED_AGENT_ID,
                    "snapshot": {
                        "id": DELETED_AGENT_ID,
                        "compatibilityKey": "alice:computer-1:claude",
                        "deletedAt": "2026-07-29T00:00:00Z",
                    },
                    "compatibility_key": "alice:computer-1:claude",
                    "event_version": 1,
                    "updated_at": deleted_at,
                    "deleted_at": deleted_at,
                },
                {
                    "id": ACTIVE_AGENT_ID,
                    "snapshot": {
                        "id": ACTIVE_AGENT_ID,
                        "compatibilityKey": "alice:computer-2:claude",
                    },
                    "compatibility_key": "alice:computer-2:claude",
                    "event_version": 1,
                    "updated_at": deleted_at,
                    "deleted_at": None,
                },
            ],
        )
        connection.execute(
            agent_events.insert(),
            [
                {
                    "id": "deleted-event",
                    "agent_id": DELETED_AGENT_ID,
                    "sequence": 0,
                    "type": "agent.deleted",
                    "timestamp": deleted_at,
                    "payload": {
                        "agent": {
                            "id": DELETED_AGENT_ID,
                            "compatibilityKey": "alice:computer-1:claude",
                            "deletedAt": "2026-07-29T00:00:00Z",
                        }
                    },
                },
                {
                    "id": "active-event",
                    "agent_id": ACTIVE_AGENT_ID,
                    "sequence": 0,
                    "type": "agent.created",
                    "timestamp": deleted_at,
                    "payload": {
                        "agent": {
                            "id": ACTIVE_AGENT_ID,
                            "compatibilityKey": "alice:computer-2:claude",
                        }
                    },
                },
            ],
        )
        migration = _load_migration(
            "20260729_0044_release_deleted_agent_compatibility_keys.py"
        )
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        rows = {
            row.id: row
            for row in connection.execute(sa.select(agents)).mappings().all()
        }
        events = (
            connection.execute(
                sa.select(agent_events)
                .where(agent_events.c.agent_id == DELETED_AGENT_ID)
                .order_by(agent_events.c.sequence)
            )
            .mappings()
            .all()
        )

    assert rows[DELETED_AGENT_ID]["compatibility_key"] is None
    assert "compatibilityKey" not in rows[DELETED_AGENT_ID]["snapshot"]
    assert rows[DELETED_AGENT_ID]["event_version"] == 2
    assert events[-1]["type"] == "agent.compatibility_released"
    assert events[-1]["payload"]["agent"] == rows[DELETED_AGENT_ID]["snapshot"]
    assert rows[ACTIVE_AGENT_ID]["compatibility_key"] == "alice:computer-2:claude"
    assert (
        rows[ACTIVE_AGENT_ID]["snapshot"]["compatibilityKey"]
        == "alice:computer-2:claude"
    )


def test_forward_repair_records_event_for_previously_applied_snapshot_repair() -> None:
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    agents = sa.Table(
        "agents",
        metadata,
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("compatibility_key", sa.Text(), unique=True),
        sa.Column("event_version", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
    )
    agent_events = sa.Table(
        "agent_events",
        metadata,
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("agent_id", sa.Text(), nullable=False),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.UniqueConstraint("agent_id", "sequence"),
    )
    metadata.create_all(engine)
    deleted_at = datetime(2026, 7, 29, tzinfo=UTC)
    with engine.begin() as connection:
        connection.execute(
            agents.insert().values(
                id=DELETED_AGENT_ID,
                snapshot={"id": DELETED_AGENT_ID, "deletedAt": "2026-07-29T00:00:00Z"},
                compatibility_key=None,
                event_version=1,
                updated_at=deleted_at,
                deleted_at=deleted_at,
            )
        )
        connection.execute(
            agent_events.insert().values(
                id="deleted-event",
                agent_id=DELETED_AGENT_ID,
                sequence=0,
                type="agent.deleted",
                timestamp=deleted_at,
                payload={
                    "agent": {
                        "id": DELETED_AGENT_ID,
                        "compatibilityKey": "alice:computer-1:claude",
                        "deletedAt": "2026-07-29T00:00:00Z",
                    }
                },
            )
        )
        migration = _load_migration(
            "20260729_0045_record_agent_compatibility_release_events.py"
        )
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        repaired = connection.execute(sa.select(agents)).mappings().one()
        events = (
            connection.execute(
                sa.select(agent_events).order_by(agent_events.c.sequence)
            )
            .mappings()
            .all()
        )

    assert repaired["event_version"] == 2
    assert events[-1]["type"] == "agent.compatibility_released"
    assert events[-1]["payload"]["agent"] == repaired["snapshot"]
