"""track the last progress a daemon run reported

Revision ID: 20260806_0057
Revises: 20260806_0056
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260806_0057"
down_revision = "20260806_0056"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable by design: a run that has not streamed anything yet is judged
    # by its dispatch time, exactly as it was before this column existed.
    op.add_column(
        "daemon_run_requests",
        sa.Column("current_progress_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("daemon_run_requests", "current_progress_at")
