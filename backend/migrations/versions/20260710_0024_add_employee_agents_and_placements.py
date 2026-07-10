"""add employee agents and placements

Revision ID: 20260710_0024
Revises: 20260710_0023
Create Date: 2026-07-10 15:45:00.000000

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260710_0024"
down_revision = "20260710_0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "employee_agents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("public_id", sa.Text(), nullable=False),
        sa.Column("employee_public_id", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("executor_kind", sa.Text(), nullable=False),
        sa.Column("compatibility_key", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("agent_version", sa.BigInteger(), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("event_version", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
        sa.UniqueConstraint("compatibility_key"),
    )
    op.create_index(
        "ix_employee_agents_employee_public_id",
        "employee_agents",
        ["employee_public_id"],
    )
    op.create_table(
        "employee_agent_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("public_id", sa.Text(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["agent_id"], ["employee_agents.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
        sa.UniqueConstraint(
            "agent_id", "sequence", name="uq_employee_agent_events_sequence"
        ),
    )
    op.create_table(
        "agent_placements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("public_id", sa.Text(), nullable=False),
        sa.Column("agent_public_id", sa.Text(), nullable=False),
        sa.Column("employee_public_id", sa.Text(), nullable=False),
        sa.Column("daemon_node_public_id", sa.Text(), nullable=False),
        sa.Column("executor_kind", sa.Text(), nullable=False),
        sa.Column("desired_state", sa.Text(), nullable=False),
        sa.Column("priority", sa.BigInteger(), nullable=False),
        sa.Column("agent_version", sa.BigInteger(), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("event_version", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
    )
    op.create_index(
        "ix_agent_placements_agent_public_id", "agent_placements", ["agent_public_id"]
    )
    op.create_index(
        "ix_agent_placements_employee_public_id",
        "agent_placements",
        ["employee_public_id"],
    )
    op.create_index(
        "ix_agent_placements_daemon_node_public_id",
        "agent_placements",
        ["daemon_node_public_id"],
    )
    op.create_table(
        "agent_placement_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("public_id", sa.Text(), nullable=False),
        sa.Column("placement_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["placement_id"], ["agent_placements.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
        sa.UniqueConstraint(
            "placement_id", "sequence", name="uq_agent_placement_events_sequence"
        ),
    )


def downgrade() -> None:
    op.drop_table("agent_placement_events")
    op.drop_index(
        "ix_agent_placements_daemon_node_public_id", table_name="agent_placements"
    )
    op.drop_index(
        "ix_agent_placements_employee_public_id", table_name="agent_placements"
    )
    op.drop_index("ix_agent_placements_agent_public_id", table_name="agent_placements")
    op.drop_table("agent_placements")
    op.drop_table("employee_agent_events")
    op.drop_index("ix_employee_agents_employee_public_id", table_name="employee_agents")
    op.drop_table("employee_agents")
