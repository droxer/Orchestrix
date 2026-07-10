"""add task logical agent assignment

Revision ID: 20260710_0025
Revises: 20260710_0024
Create Date: 2026-07-10 16:00:00.000000

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260710_0025"
down_revision = "20260710_0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("assigned_agent_id", sa.Text(), nullable=True))
    op.create_index("ix_tasks_assigned_agent_id", "tasks", ["assigned_agent_id"])


def downgrade() -> None:
    op.drop_index("ix_tasks_assigned_agent_id", table_name="tasks")
    op.drop_column("tasks", "assigned_agent_id")
