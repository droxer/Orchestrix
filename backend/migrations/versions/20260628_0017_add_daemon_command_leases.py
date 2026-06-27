"""add daemon command leases

Revision ID: 20260628_0017
Revises: 20260625_0016
Create Date: 2026-06-28 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260628_0017"
down_revision = "20260625_0016"
branch_labels = None
depends_on = None


def timestamp() -> sa.DateTime:
    return sa.DateTime(timezone=True)


def upgrade() -> None:
    op.add_column("daemon_commands", sa.Column("lease_id", sa.Text(), nullable=True))
    op.add_column("daemon_commands", sa.Column("lease_expires_at", timestamp(), nullable=True))
    op.add_column("daemon_commands", sa.Column("attempt", sa.Integer(), nullable=False, server_default="0"))
    op.create_index("ix_daemon_commands_lease_expires_at", "daemon_commands", ["lease_expires_at"])


def downgrade() -> None:
    op.drop_index("ix_daemon_commands_lease_expires_at", table_name="daemon_commands")
    op.drop_column("daemon_commands", "attempt")
    op.drop_column("daemon_commands", "lease_expires_at")
    op.drop_column("daemon_commands", "lease_id")
