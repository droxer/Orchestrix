"""release compatibility identities held by deleted agents

Revision ID: 20260729_0044
Revises: 20260729_0043

Deleted agents cannot be restored, so retaining their unique compatibility key
prevents a recovered Computer from materializing a replacement Logical Agent.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "20260729_0044"
down_revision = "20260729_0043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    uuid_type = sa.Uuid(as_uuid=False).with_variant(sa.Text(), "sqlite")
    agents = sa.table(
        "agents",
        sa.column("id", uuid_type),
        sa.column("snapshot", sa.JSON()),
        sa.column("compatibility_key", sa.Text()),
        sa.column("event_version", sa.BigInteger()),
        sa.column("updated_at", sa.DateTime(timezone=True)),
        sa.column("deleted_at", sa.DateTime(timezone=True)),
    )
    events = sa.table(
        "agent_events",
        sa.column("id", uuid_type),
        sa.column("agent_id", uuid_type),
        sa.column("sequence", sa.BigInteger()),
        sa.column("type", sa.Text()),
        sa.column("timestamp", sa.DateTime(timezone=True)),
        sa.column("payload", sa.JSON()),
    )
    rows = (
        connection.execute(
            sa.select(agents.c.id, agents.c.snapshot, agents.c.event_version).where(
                agents.c.deleted_at.is_not(None),
                agents.c.compatibility_key.is_not(None),
            )
        )
        .mappings()
        .all()
    )
    for row in rows:
        timestamp = datetime.now(UTC)
        snapshot = _snapshot_dict(row["snapshot"])
        snapshot.pop("compatibilityKey", None)
        snapshot["updatedAt"] = _format_timestamp(timestamp)
        connection.execute(
            sa.insert(events).values(
                id=str(uuid.uuid4()),
                agent_id=row["id"],
                sequence=row["event_version"],
                type="agent.compatibility_released",
                timestamp=timestamp,
                payload={
                    "patch": {"compatibilityKey": None},
                    "agent": snapshot,
                },
            )
        )
        connection.execute(
            sa.update(agents)
            .where(agents.c.id == row["id"])
            .values(
                compatibility_key=None,
                snapshot=snapshot,
                event_version=row["event_version"] + 1,
                updated_at=timestamp,
            )
        )


def downgrade() -> None:
    # Irreversible data repair: a deleted agent's former compatibility identity
    # may already belong to its live replacement and must not be reclaimed.
    pass


def _snapshot_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        value = json.loads(value)
    return dict(value) if isinstance(value, dict) else {}


def _format_timestamp(value: datetime) -> str:
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")
