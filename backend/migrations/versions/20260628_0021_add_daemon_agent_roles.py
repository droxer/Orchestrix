"""add daemon agent role maps

Revision ID: 20260628_0021
Revises: 20260628_0020
Create Date: 2026-06-28 00:21:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260628_0021"
down_revision = "20260628_0020"
branch_labels = None
depends_on = None


def jsonb() -> postgresql.JSONB:
    return postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.add_column("daemon_nodes", sa.Column("agent_role_defaults", jsonb(), nullable=False, server_default=sa.text("'{}'::jsonb")))
    op.add_column("daemon_nodes", sa.Column("agent_role_overrides", jsonb(), nullable=False, server_default=sa.text("'{}'::jsonb")))
    op.alter_column("daemon_nodes", "agent_role_defaults", server_default=None)
    op.alter_column("daemon_nodes", "agent_role_overrides", server_default=None)


def downgrade() -> None:
    op.drop_column("daemon_nodes", "agent_role_overrides")
    op.drop_column("daemon_nodes", "agent_role_defaults")
