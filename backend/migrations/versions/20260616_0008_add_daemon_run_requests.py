"""add daemon run requests

Revision ID: 20260616_0008
Revises: 20260614_0007
Create Date: 2026-06-16 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260616_0008"
down_revision = "20260614_0007"
branch_labels = None
depends_on = None


def jsonb() -> postgresql.JSONB:
    return postgresql.JSONB(astext_type=sa.Text())


def timestamp() -> sa.DateTime:
    return sa.DateTime(timezone=True)


def uuid_pk() -> sa.Column:
    return sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True, server_default=sa.text("gen_random_uuid()"))


def upgrade() -> None:
    op.create_table(
        "daemon_run_requests",
        uuid_pk(),
        sa.Column("public_id", sa.Text(), nullable=False, unique=True),
        sa.Column("node_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("daemon_nodes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("node_public_id", sa.Text(), nullable=False),
        sa.Column("session_public_id", sa.Text(), nullable=False),
        sa.Column("task_goal", sa.Text(), nullable=False),
        sa.Column("assignments", jsonb(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("current_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("state", jsonb(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("current_command_public_id", sa.Text(), nullable=True),
        sa.Column("current_run_public_id", sa.Text(), nullable=True),
        sa.Column("current_agent", sa.Text(), nullable=True),
        sa.Column("current_mode", sa.Text(), nullable=True),
        sa.Column("current_started_at", timestamp(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", timestamp(), nullable=False),
        sa.Column("updated_at", timestamp(), nullable=False),
        sa.Column("completed_at", timestamp(), nullable=True),
    )
    op.create_index("ix_daemon_run_requests_status", "daemon_run_requests", ["status"])
    op.create_index("ix_daemon_run_requests_node_status", "daemon_run_requests", ["node_id", "status"])
    op.create_index("ix_daemon_run_requests_session_public_id", "daemon_run_requests", ["session_public_id"])


def downgrade() -> None:
    op.drop_index("ix_daemon_run_requests_session_public_id", table_name="daemon_run_requests")
    op.drop_index("ix_daemon_run_requests_node_status", table_name="daemon_run_requests")
    op.drop_index("ix_daemon_run_requests_status", table_name="daemon_run_requests")
    op.drop_table("daemon_run_requests")
