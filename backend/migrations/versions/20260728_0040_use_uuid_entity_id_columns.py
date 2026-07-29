"""use native UUID columns for thread, agent, and node ids

Revision ID: 20260728_0040
Revises: 20260728_0039
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "20260728_0040"
down_revision = "20260728_0039"
branch_labels = None
depends_on = None

logger = logging.getLogger(__name__)

UUID_COLUMNS = (
    ("sessions", "public_id", False),
    ("agents", "public_id", False),
    ("daemon_nodes", "public_id", False),
    ("task_sessions", "session_public_id", False),
    ("session_run_token_usage", "session_public_id", False),
    ("agent_placements", "agent_public_id", False),
    ("agent_placements", "daemon_node_public_id", False),
    ("tasks", "assigned_agent_id", True),
    ("teams", "lead_agent_id", True),
    ("daemon_commands", "node_public_id", False),
    ("daemon_runs", "node_public_id", False),
    ("daemon_runs", "session_public_id", False),
    ("daemon_runs", "logical_agent_id", True),
    ("daemon_run_requests", "node_public_id", False),
    ("daemon_run_requests", "session_public_id", False),
    ("daemon_events", "node_public_id", True),
)

LOCK_TIMEOUT = "10s"


def upgrade() -> None:
    if not getattr(op.get_context(), "as_sql", False):
        connection = op.get_bind()
        _prepare_values(connection)
        if connection.dialect.name == "postgresql":
            op.execute(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'")
    for table, column, nullable in UUID_COLUMNS:
        logger.info("0040: converting %s.%s to UUID", table, column)
        op.alter_column(
            table,
            column,
            existing_type=sa.Text(),
            type_=sa.Uuid(as_uuid=False),
            existing_nullable=nullable,
            postgresql_using=f'"{column}"::uuid',
        )


def downgrade() -> None:
    for table, column, nullable in reversed(UUID_COLUMNS):
        op.alter_column(
            table,
            column,
            existing_type=sa.Uuid(as_uuid=False),
            type_=sa.Text(),
            existing_nullable=nullable,
            postgresql_using=f'"{column}"::text',
        )


def _prepare_values(connection: Any) -> None:
    inspector = sa.inspect(connection)
    table_names = set(inspector.get_table_names())
    for table, column, nullable in UUID_COLUMNS:
        if table not in table_names:
            continue
        values = connection.execute(
            sa.text(
                f'SELECT DISTINCT "{column}" FROM "{table}" '
                f'WHERE "{column}" IS NOT NULL'
            )
        ).scalars().all()
        invalid = [str(value) for value in values if not _is_uuid(value)]
        if not invalid:
            continue
        sample = ", ".join(sorted(invalid)[:5])
        if not nullable:
            raise RuntimeError(
                f"Cannot convert {table}.{column} to UUID: {len(invalid)} "
                f"invalid value(s) remain ({sample}). Re-run backfill "
                "20260728_0039 or repair the rows first."
            )
        logger.warning(
            "0040: nulling %d invalid UUID value(s) in %s.%s (%s)",
            len(invalid),
            table,
            column,
            sample,
        )
        placeholders = ", ".join(f":value_{index}" for index in range(len(invalid)))
        connection.execute(
            sa.text(
                f'UPDATE "{table}" SET "{column}" = NULL '
                f'WHERE "{column}" IN ({placeholders})'
            ),
            {f"value_{index}": value for index, value in enumerate(invalid)},
        )


def _is_uuid(value: Any) -> bool:
    try:
        uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return False
    return True
