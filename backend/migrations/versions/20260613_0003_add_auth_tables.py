"""add auth tables

Revision ID: 20260613_0003
Revises: 20260613_0002
Create Date: 2026-06-13 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260613_0003"
down_revision = "20260613_0002"
branch_labels = None
depends_on = None


def timestamp() -> sa.DateTime:
    return sa.DateTime(timezone=True)


def uuid_pk() -> sa.Column:
    return sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True, server_default=sa.text("gen_random_uuid()"))


def upgrade() -> None:
    op.execute("create extension if not exists pgcrypto")
    op.create_table(
        "auth_users",
        uuid_pk(),
        sa.Column("public_id", sa.Text(), nullable=False, unique=True),
        sa.Column("username", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("employee_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("employee_public_id", sa.Text(), nullable=True),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("created_at", timestamp(), nullable=False),
        sa.Column("updated_at", timestamp(), nullable=False),
        sa.CheckConstraint("role in ('admin', 'user')", name="ck_auth_users_role"),
        sa.UniqueConstraint("username", name="uq_auth_users_username"),
    )
    op.create_index("ix_auth_users_role", "auth_users", ["role"])
    op.create_index("ix_auth_users_employee_id", "auth_users", ["employee_id"])

    op.create_table(
        "auth_sessions",
        uuid_pk(),
        sa.Column("public_id", sa.Text(), nullable=False, unique=True),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("auth_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_public_id", sa.Text(), nullable=False),
        sa.Column("created_at", timestamp(), nullable=False),
        sa.Column("expires_at", timestamp(), nullable=False),
        sa.UniqueConstraint("token_hash", name="uq_auth_sessions_token_hash"),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    op.create_index("ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_auth_sessions_expires_at", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_user_id", table_name="auth_sessions")
    op.drop_table("auth_sessions")

    op.drop_index("ix_auth_users_employee_id", table_name="auth_users")
    op.drop_index("ix_auth_users_role", table_name="auth_users")
    op.drop_table("auth_users")
