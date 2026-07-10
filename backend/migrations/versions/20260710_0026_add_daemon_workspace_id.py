"""add canonical daemon workspace identity

Revision ID: 20260710_0026
Revises: 20260710_0025
Create Date: 2026-07-10 17:00:00.000000

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260710_0026"
down_revision = "20260710_0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("daemon_nodes", sa.Column("workspace_id", sa.Text(), nullable=True))
    op.create_index("ix_daemon_nodes_workspace_id", "daemon_nodes", ["workspace_id"])


def downgrade() -> None:
    op.drop_index("ix_daemon_nodes_workspace_id", table_name="daemon_nodes")
    op.drop_column("daemon_nodes", "workspace_id")
