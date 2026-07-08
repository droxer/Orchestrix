"""add daemon sandbox mode

Revision ID: 20260628_0022
Revises: 20260628_0021
Create Date: 2026-06-28 00:22:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260628_0022"
down_revision = "20260628_0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("daemon_nodes", sa.Column("sandbox_mode", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("daemon_nodes", "sandbox_mode")
