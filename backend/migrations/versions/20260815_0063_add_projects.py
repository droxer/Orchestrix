"""add computer-bound projects and project membership

Revision ID: 20260815_0063
Revises: 20260814_0062
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260815_0063"
down_revision = "20260814_0062"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_employee_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("name_key", sa.Text(), nullable=False),
        sa.Column("computer_id", sa.Text(), nullable=False),
        sa.Column("workspace_subpath", sa.Text(), nullable=False),
        sa.Column("lead_agent_id", sa.Uuid(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("event_version", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["owner_employee_id"],
            ["employees.id"],
            name="fk_projects_owner",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_projects_owner_updated",
        "projects",
        ["owner_employee_id", "updated_at"],
    )
    op.create_index(
        "uq_projects_live_owner_name",
        "projects",
        ["owner_employee_id", "name_key"],
        unique=True,
        postgresql_where=sa.text("archived_at IS NULL"),
    )
    op.create_table(
        "project_members",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("function_title", sa.Text(), nullable=False),
        sa.Column("responsibilities", sa.Text(), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "agent_id", name="uq_project_members_agent"),
    )
    op.create_index("ix_project_members_agent", "project_members", ["agent_id"])
    op.create_table(
        "project_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id", "sequence", name="uq_project_events_sequence"
        ),
    )
    op.add_column("tasks", sa.Column("project_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_tasks_project",
        "tasks",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_tasks_project_id", "tasks", ["project_id"])
    op.add_column("sessions", sa.Column("project_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_sessions_project",
        "sessions",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_sessions_project_id", "sessions", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_sessions_project_id", table_name="sessions")
    op.drop_constraint("fk_sessions_project", "sessions", type_="foreignkey")
    op.drop_column("sessions", "project_id")
    op.drop_index("ix_tasks_project_id", table_name="tasks")
    op.drop_constraint("fk_tasks_project", "tasks", type_="foreignkey")
    op.drop_column("tasks", "project_id")
    op.drop_table("project_events")
    op.drop_index("ix_project_members_agent", table_name="project_members")
    op.drop_table("project_members")
    op.drop_index("uq_projects_live_owner_name", table_name="projects")
    op.drop_index("ix_projects_owner_updated", table_name="projects")
    op.drop_table("projects")
