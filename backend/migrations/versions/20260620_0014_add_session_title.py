"""add session title column

Revision ID: 20260620_0014
Revises: 20260619_0013
Create Date: 2026-06-20 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260620_0014"
down_revision = "20260619_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sessions", sa.Column("title", sa.Text(), nullable=True))
    # Backfill the promoted column from the materialized snapshot for any
    # sessions that were already renamed before this column existed.
    op.execute("UPDATE sessions SET title = snapshot->>'title' WHERE snapshot ? 'title'")


def downgrade() -> None:
    op.drop_column("sessions", "title")
