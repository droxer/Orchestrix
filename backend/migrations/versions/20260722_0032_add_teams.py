"""add teams and task team assignment

Revision ID: 20260722_0032
Revises: 20260721_0031
Create Date: 2026-07-22 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260722_0032"
down_revision = "20260721_0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "teams",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("public_id", sa.Text(), nullable=False),
        sa.Column("owner_employee_public_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("name_key", sa.Text(), nullable=True),
        sa.Column("lead_agent_id", sa.Text(), nullable=True),
        sa.Column("member_agent_ids", sa.JSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("event_version", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
        sa.UniqueConstraint(
            "owner_employee_public_id",
            "name_key",
            name="uq_teams_owner_name_key",
        ),
    )
    op.create_index(
        "ix_teams_owner_employee_public_id",
        "teams",
        ["owner_employee_public_id"],
    )
    op.create_table(
        "team_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("public_id", sa.Text(), nullable=False),
        sa.Column("team_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
        sa.UniqueConstraint("team_id", "sequence", name="uq_team_events_sequence"),
    )
    op.add_column("tasks", sa.Column("assigned_team_id", sa.Text(), nullable=True))
    op.create_index("ix_tasks_assigned_team_id", "tasks", ["assigned_team_id"])


def downgrade() -> None:
    op.drop_index("ix_tasks_assigned_team_id", table_name="tasks")
    op.drop_column("tasks", "assigned_team_id")
    op.drop_table("team_events")
    op.drop_index(
        "ix_teams_owner_employee_public_id", table_name="teams"
    )
    op.drop_table("teams")
