"""add session token usage stats table

Revision ID: 20260619_0011
Revises: 20260618_0010
Create Date: 2026-06-19 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260619_0011"
down_revision = "20260618_0010"
branch_labels = None
depends_on = None


def timestamp() -> sa.DateTime:
    return sa.DateTime(timezone=True)


def uuid_pk() -> sa.Column:
    return sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True, server_default=sa.text("gen_random_uuid()"))


def upgrade() -> None:
    op.create_table(
        "session_token_usage",
        uuid_pk(),
        sa.Column("session_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("session_public_id", sa.Text(), nullable=False, unique=True),
        sa.Column("owner_employee_id", sa.Text(), nullable=True),
        sa.Column("input_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("cache_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("total_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_at", timestamp(), nullable=False),
    )
    op.create_index("ix_session_token_usage_updated_at", "session_token_usage", ["updated_at"])
    op.create_index("ix_session_token_usage_owner_employee_id", "session_token_usage", ["owner_employee_id"])

    op.execute(
        """
        INSERT INTO session_token_usage (
            id, session_id, session_public_id, owner_employee_id,
            input_tokens, output_tokens, cache_tokens, total_tokens, updated_at
        )
        SELECT
            gen_random_uuid(),
            id,
            public_id,
            owner_employee_id,
            COALESCE((snapshot->'tokenUsage'->>'input')::bigint, 0),
            COALESCE((snapshot->'tokenUsage'->>'output')::bigint, 0),
            COALESCE((snapshot->'tokenUsage'->>'cache')::bigint, 0),
            COALESCE((snapshot->'tokenUsage'->>'total')::bigint, 0),
            updated_at
        FROM sessions
        WHERE snapshot ? 'tokenUsage'
          AND COALESCE((snapshot->'tokenUsage'->>'total')::bigint, 0) > 0
        """
    )


def downgrade() -> None:
    op.drop_index("ix_session_token_usage_owner_employee_id", table_name="session_token_usage")
    op.drop_index("ix_session_token_usage_updated_at", table_name="session_token_usage")
    op.drop_table("session_token_usage")
