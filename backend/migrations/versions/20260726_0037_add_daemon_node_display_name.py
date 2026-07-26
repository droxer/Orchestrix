"""add daemon node display name

Revision ID: 20260726_0037
Revises: 20260725_0036
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260726_0037"
down_revision = "20260725_0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("daemon_nodes", sa.Column("display_name", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("daemon_nodes", "display_name")
