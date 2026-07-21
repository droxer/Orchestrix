"""add explicit daemon node location

Revision ID: 20260721_0031
Revises: 20260719_0030
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260721_0031"
down_revision = "20260719_0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("daemon_nodes", sa.Column("node_location", sa.Text(), nullable=True))
    op.execute(
        "UPDATE daemon_nodes SET node_location = 'managed' "
        "WHERE node_location IS NULL AND managed_node_id IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_column("daemon_nodes", "node_location")
