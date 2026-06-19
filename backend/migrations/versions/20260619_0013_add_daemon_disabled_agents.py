"""add daemon node disabled agents

Revision ID: 20260619_0013
Revises: 20260619_0012
Create Date: 2026-06-19 10:15:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260619_0013"
down_revision = "20260619_0012"
branch_labels = None
depends_on = None


def jsonb() -> postgresql.JSONB:
    return postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.add_column(
        "daemon_nodes",
        sa.Column("disabled_agents", jsonb(), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    op.alter_column("daemon_nodes", "disabled_agents", server_default=None)


def downgrade() -> None:
    op.drop_column("daemon_nodes", "disabled_agents")
