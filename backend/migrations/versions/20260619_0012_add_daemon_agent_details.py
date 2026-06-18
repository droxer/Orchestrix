"""add daemon node agent details

Revision ID: 20260619_0012
Revises: 20260619_0011
Create Date: 2026-06-19 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260619_0012"
down_revision = "20260619_0011"
branch_labels = None
depends_on = None


def jsonb() -> postgresql.JSONB:
    return postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.add_column(
        "daemon_nodes",
        sa.Column("agent_details", jsonb(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.alter_column("daemon_nodes", "agent_details", server_default=None)


def downgrade() -> None:
    op.drop_column("daemon_nodes", "agent_details")
