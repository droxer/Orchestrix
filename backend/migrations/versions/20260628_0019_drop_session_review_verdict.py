"""drop session review_verdict column

Revision ID: 20260628_0019
Revises: 20260628_0018
Create Date: 2026-06-28 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260628_0019"
down_revision = "20260628_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Review is informational only now; the approve/reject verdict has been
    # removed from the workflow, so the promoted column is no longer written.
    op.drop_column("sessions", "review_verdict")


def downgrade() -> None:
    op.add_column("sessions", sa.Column("review_verdict", sa.Text(), nullable=True))
