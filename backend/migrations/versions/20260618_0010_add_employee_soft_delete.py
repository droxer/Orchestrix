"""add employee soft-delete column

Revision ID: 20260618_0010
Revises: 20260618_0009
Create Date: 2026-06-18 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260618_0010"
down_revision = "20260618_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("employees", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("employees", "deleted_at")
