"""add managed daemon linkage

Revision ID: 20260710_0023
Revises: 20260628_0022
Create Date: 2026-07-10 00:23:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260710_0023"
down_revision = "20260628_0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("daemon_nodes", sa.Column("managed_node_id", sa.Text(), nullable=True))
    op.add_column("daemon_nodes", sa.Column("provisioning_attempt_id", sa.Text(), nullable=True))
    op.add_column("daemon_nodes", sa.Column("credential_version", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("daemon_nodes", sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True))
    op.alter_column("daemon_nodes", "credential_version", server_default=None)
    op.create_index("ix_daemon_nodes_managed_node_id", "daemon_nodes", ["managed_node_id"])


def downgrade() -> None:
    op.drop_index("ix_daemon_nodes_managed_node_id", table_name="daemon_nodes")
    op.drop_column("daemon_nodes", "retired_at")
    op.drop_column("daemon_nodes", "credential_version")
    op.drop_column("daemon_nodes", "provisioning_attempt_id")
    op.drop_column("daemon_nodes", "managed_node_id")
