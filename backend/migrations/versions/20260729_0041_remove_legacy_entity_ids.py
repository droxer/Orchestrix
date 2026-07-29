"""remove legacy public ids for threads, agents, and nodes

Revision ID: 20260729_0041
Revises: 20260728_0040
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260729_0041"
down_revision = "20260728_0040"
branch_labels = None
depends_on = None

RENAMED_COLUMNS = (
    ("task_sessions", "session_public_id", "session_id"),
    ("agent_placements", "agent_public_id", "agent_id"),
    ("agent_placements", "daemon_node_public_id", "daemon_node_id"),
    ("daemon_runs", "session_public_id", "session_id"),
    ("daemon_run_requests", "session_public_id", "session_id"),
)

REDUNDANT_COLUMNS = (
    ("session_run_token_usage", "session_public_id", False),
    ("daemon_commands", "node_public_id", False),
    ("daemon_runs", "node_public_id", False),
    ("daemon_run_requests", "node_public_id", False),
    ("daemon_events", "node_public_id", True),
)

ENTITY_PUBLIC_ID_COLUMNS = ("sessions", "agents", "daemon_nodes")

RENAMED_INDEXES = (
    ("ix_agent_placements_agent_public_id", "ix_agent_placements_agent_id"),
    (
        "ix_agent_placements_daemon_node_public_id",
        "ix_agent_placements_daemon_node_id",
    ),
    ("ix_daemon_runs_session_public_id", "ix_daemon_runs_session_id"),
    (
        "ix_daemon_run_requests_session_public_id",
        "ix_daemon_run_requests_session_id",
    ),
)


def upgrade() -> None:
    for table, old_name, new_name in RENAMED_COLUMNS:
        op.alter_column(table, old_name, new_column_name=new_name)

    for old_name, new_name in RENAMED_INDEXES:
        op.execute(f'ALTER INDEX "{old_name}" RENAME TO "{new_name}"')
    op.execute(
        'ALTER TABLE task_sessions RENAME CONSTRAINT '
        '"uq_task_sessions_task_session_public" TO '
        '"uq_task_sessions_task_session"'
    )

    for table, column, _nullable in REDUNDANT_COLUMNS:
        op.drop_column(table, column)
    for table in ENTITY_PUBLIC_ID_COLUMNS:
        op.drop_column(table, "public_id")


def downgrade() -> None:
    for table in ENTITY_PUBLIC_ID_COLUMNS:
        op.add_column(table, sa.Column("public_id", sa.Uuid(), nullable=True))
        op.execute(f'UPDATE "{table}" SET public_id = id')
        op.alter_column(table, "public_id", nullable=False)
        op.create_unique_constraint(f"uq_{table}_public_id", table, ["public_id"])

    for table, column, nullable in REDUNDANT_COLUMNS:
        op.add_column(table, sa.Column(column, sa.Uuid(), nullable=True))
        source = "session_id" if column == "session_public_id" else "node_id"
        op.execute(f'UPDATE "{table}" SET "{column}" = "{source}"')
        if not nullable:
            op.alter_column(table, column, nullable=False)

    op.execute(
        'ALTER TABLE task_sessions RENAME CONSTRAINT '
        '"uq_task_sessions_task_session" TO '
        '"uq_task_sessions_task_session_public"'
    )
    for old_name, new_name in reversed(RENAMED_INDEXES):
        op.execute(f'ALTER INDEX "{new_name}" RENAME TO "{old_name}"')
    for table, old_name, new_name in reversed(RENAMED_COLUMNS):
        op.alter_column(table, new_name, new_column_name=old_name)
