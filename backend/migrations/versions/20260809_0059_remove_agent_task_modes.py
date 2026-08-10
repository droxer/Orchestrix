"""remove agent task modes

Revision ID: 20260809_0059
Revises: 20260807_0058
"""

from __future__ import annotations

from alembic import op

revision = "20260809_0059"
down_revision = "20260807_0058"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("daemon_run_requests", "current_mode")
    op.drop_column("daemon_runs", "mode")
    op.drop_column("daemon_nodes", "run_capacity_by_mode")


def downgrade() -> None:
    raise RuntimeError(
        "Agent task modes were removed without a compatibility schema; "
        "this migration is intentionally irreversible."
    )
