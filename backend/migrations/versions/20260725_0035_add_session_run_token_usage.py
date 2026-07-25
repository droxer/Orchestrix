"""add per-run session token usage stats

Revision ID: 20260725_0035
Revises: 20260724_0034
Create Date: 2026-07-25 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260725_0035"
down_revision = "20260724_0034"
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
        "session_run_token_usage",
        uuid_pk(),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("session_public_id", sa.Text(), nullable=False),
        sa.Column("run_id", sa.Text(), nullable=False),
        sa.Column("owner_employee_id", sa.Text(), nullable=True),
        sa.Column("input_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("cache_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("total_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("completed_at", timestamp(), nullable=False),
        sa.UniqueConstraint(
            "session_id",
            "run_id",
            name="uq_session_run_token_usage_session_run",
        ),
    )
    op.create_index(
        "ix_session_run_token_usage_completed_at",
        "session_run_token_usage",
        ["completed_at"],
    )
    op.create_index(
        "ix_session_run_token_usage_owner_employee_id",
        "session_run_token_usage",
        ["owner_employee_id"],
    )

    op.execute(
        """
        INSERT INTO session_run_token_usage (
            id, session_id, session_public_id, run_id, owner_employee_id,
            input_tokens, output_tokens, cache_tokens, total_tokens, completed_at
        )
        SELECT
            gen_random_uuid(),
            sessions.id,
            sessions.public_id,
            run.value->>'id',
            sessions.owner_employee_id,
            COALESCE((run.value->'tokenUsage'->>'input')::bigint, 0),
            COALESCE((run.value->'tokenUsage'->>'output')::bigint, 0),
            COALESCE((run.value->'tokenUsage'->>'cache')::bigint, 0),
            COALESCE((run.value->'tokenUsage'->>'total')::bigint, 0),
            (run.value->>'completedAt')::timestamptz
        FROM sessions
        CROSS JOIN LATERAL jsonb_array_elements(
            COALESCE(sessions.snapshot->'agentRuns', '[]'::jsonb)
        ) AS run(value)
        WHERE run.value ? 'tokenUsage'
          AND run.value ? 'completedAt'
          AND COALESCE((run.value->'tokenUsage'->>'total')::bigint, 0) > 0
        ON CONFLICT (session_id, run_id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_index(
        "ix_session_run_token_usage_owner_employee_id",
        table_name="session_run_token_usage",
    )
    op.drop_index(
        "ix_session_run_token_usage_completed_at",
        table_name="session_run_token_usage",
    )
    op.drop_table("session_run_token_usage")
