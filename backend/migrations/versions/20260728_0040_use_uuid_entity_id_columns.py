"""use native UUID columns for thread, agent, and node ids

Revision ID: 20260728_0040
Revises: 20260728_0039
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260728_0040"
down_revision = "20260728_0039"
branch_labels = None
depends_on = None

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


def upgrade() -> None:
    for table, column, nullable in UUID_COLUMNS:
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
