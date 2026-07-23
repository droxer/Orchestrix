"""backfill local daemon node location

Revision ID: 20260723_0033
Revises: 20260722_0032
"""

from __future__ import annotations

from alembic import op


revision = "20260723_0033"
down_revision = "20260722_0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE daemon_nodes SET node_location = 'employee-device' "
        "WHERE node_location IS NULL "
        "AND employee_id IS NOT NULL "
        "AND managed_node_id IS NULL "
        "AND EXISTS ("
        "SELECT 1 FROM daemon_events "
        "WHERE daemon_events.node_public_id = daemon_nodes.public_id "
        "AND daemon_events.type = 'daemon.node.assigned'"
        ")"
    )


def downgrade() -> None:
    # This is a compatibility data repair. Existing explicit local ownership
    # cannot be distinguished safely from rows repaired by this migration.
    pass
