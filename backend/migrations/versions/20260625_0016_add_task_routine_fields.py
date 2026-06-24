"""add task routine fields

Revision ID: 20260625_0016
Revises: 20260624_0015
Create Date: 2026-06-25 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260625_0016"
down_revision = "20260624_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("is_routine", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("tasks", sa.Column("routine_type", sa.Text(), nullable=True))
    op.add_column("tasks", sa.Column("routine_cadence", sa.Text(), nullable=True))
    op.add_column("tasks", sa.Column("routine_next_run_date", sa.Date(), nullable=True))
    op.add_column("tasks", sa.Column("routine_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index("ix_tasks_is_routine", "tasks", ["is_routine"])
    op.create_index("ix_tasks_routine_next_run_date", "tasks", ["routine_next_run_date"])
    op.create_index("ix_tasks_routine_enabled", "tasks", ["routine_enabled"])


def downgrade() -> None:
    op.drop_index("ix_tasks_routine_enabled", table_name="tasks")
    op.drop_index("ix_tasks_routine_next_run_date", table_name="tasks")
    op.drop_index("ix_tasks_is_routine", table_name="tasks")
    op.drop_column("tasks", "routine_enabled")
    op.drop_column("tasks", "routine_next_run_date")
    op.drop_column("tasks", "routine_cadence")
    op.drop_column("tasks", "routine_type")
    op.drop_column("tasks", "is_routine")
