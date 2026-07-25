"""add logical agent and placement to daemon runs

Revision ID: 20260725_0036
Revises: 20260725_0035
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260725_0036"
down_revision = "20260725_0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "daemon_runs", sa.Column("logical_agent_id", sa.Text(), nullable=True)
    )
    op.add_column("daemon_runs", sa.Column("placement_id", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("daemon_runs", "placement_id")
    op.drop_column("daemon_runs", "logical_agent_id")
