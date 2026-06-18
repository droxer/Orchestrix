"""add daemon node plain token column

Revision ID: 20260618_0009
Revises: 20260616_0008
Create Date: 2026-06-18 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260618_0009"
down_revision = "20260616_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("daemon_nodes", sa.Column("node_token", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("daemon_nodes", "node_token")
