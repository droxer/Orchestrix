"""add daemon run capacity

Revision ID: 20260628_0020
Revises: 20260628_0019
Create Date: 2026-06-28 00:20:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260628_0020"
down_revision = "20260628_0019"
branch_labels = None
depends_on = None


def jsonb() -> postgresql.JSONB:
    return postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.add_column("daemon_nodes", sa.Column("max_concurrent_runs", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("daemon_nodes", sa.Column("run_capacity_by_mode", jsonb(), nullable=False, server_default=sa.text("'{}'::jsonb")))


def downgrade() -> None:
    op.drop_column("daemon_nodes", "run_capacity_by_mode")
    op.drop_column("daemon_nodes", "max_concurrent_runs")
