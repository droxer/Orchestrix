"""add backlog task fields

Revision ID: 20260624_0015
Revises: 20260620_0014
Create Date: 2026-06-24 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260624_0015"
down_revision = "20260620_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("assignee_employee_id", sa.Text(), nullable=True))
    op.add_column("tasks", sa.Column("due_date", sa.Date(), nullable=True))
    op.create_index("ix_tasks_assignee_employee_id", "tasks", ["assignee_employee_id"])
    op.create_index("ix_tasks_due_date", "tasks", ["due_date"])
    op.create_index("ix_tasks_priority", "tasks", ["priority"])
    op.add_column("daemon_run_requests", sa.Column("task_public_id", sa.Text(), nullable=True))
    op.create_index("ix_daemon_run_requests_task_public_id", "daemon_run_requests", ["task_public_id"])


def downgrade() -> None:
    op.drop_index("ix_daemon_run_requests_task_public_id", table_name="daemon_run_requests")
    op.drop_column("daemon_run_requests", "task_public_id")
    op.drop_index("ix_tasks_priority", table_name="tasks")
    op.drop_index("ix_tasks_due_date", table_name="tasks")
    op.drop_index("ix_tasks_assignee_employee_id", table_name="tasks")
    op.drop_column("tasks", "due_date")
    op.drop_column("tasks", "assignee_employee_id")
