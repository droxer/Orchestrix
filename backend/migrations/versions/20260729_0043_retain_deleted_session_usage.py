"""retain token usage and tombstones for deleted sessions

Revision ID: 20260729_0043
Revises: 20260729_0042
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260729_0043"
down_revision = "20260729_0042"
branch_labels = None
depends_on = None


def timestamp() -> sa.DateTime:
    return sa.DateTime(timezone=True)


def uuid_pk() -> sa.Column:
    return sa.Column(
        "id",
        postgresql.UUID(as_uuid=False),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    )


def upgrade() -> None:
    op.create_table(
        "session_tombstones",
        uuid_pk(),
        sa.Column("session_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("task_goal", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("owner_employee_id", sa.Text(), nullable=True),
        sa.Column("deleted_by", sa.Text(), nullable=True),
        sa.Column("deleted_at", timestamp(), nullable=False),
        sa.UniqueConstraint("session_id", name="uq_session_tombstones_session"),
    )
    with op.batch_alter_table("session_run_token_usage") as batch:
        batch.add_column(sa.Column("task_goal", sa.Text(), nullable=True))
        batch.drop_constraint(
            "session_run_token_usage_session_id_fkey", type_="foreignkey"
        )
    op.execute(
        """
        UPDATE session_run_token_usage
        SET task_goal = (
            SELECT sessions.task_goal
            FROM sessions
            WHERE sessions.id = session_run_token_usage.session_id
        )
        """
    )


def downgrade() -> None:
    with op.batch_alter_table("session_run_token_usage") as batch:
        batch.create_foreign_key(
            "session_run_token_usage_session_id_fkey",
            "sessions",
            ["session_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch.drop_column("task_goal")
    op.drop_table("session_tombstones")
