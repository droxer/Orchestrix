"""index daemon workspace responses by command

Revision ID: 20260801_0054
Revises: 20260730_0053
"""

from __future__ import annotations

from alembic import op

revision = "20260801_0054"
down_revision = "20260730_0053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_daemon_events_command_id", "daemon_events", ["command_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_daemon_events_command_id", table_name="daemon_events")
