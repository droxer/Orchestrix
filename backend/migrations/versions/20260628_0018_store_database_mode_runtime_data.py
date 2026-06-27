"""store database mode runtime data

Revision ID: 20260628_0018
Revises: 20260628_0017
Create Date: 2026-06-28 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260628_0018"
down_revision = "20260628_0017"
branch_labels = None
depends_on = None


def jsonb() -> postgresql.JSONB:
    return postgresql.JSONB(astext_type=sa.Text())


def timestamp() -> sa.DateTime:
    return sa.DateTime(timezone=True)


def uuid_pk() -> sa.Column:
    return sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True, server_default=sa.text("gen_random_uuid()"))


def upgrade() -> None:
    op.add_column("session_artifacts", sa.Column("content", sa.Text(), nullable=True))
    op.create_table(
        "chat_documents",
        uuid_pk(),
        sa.Column("document_key", sa.Text(), nullable=False, unique=True),
        sa.Column("payload", jsonb(), nullable=False),
        sa.Column("updated_at", timestamp(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("chat_documents")
    op.drop_column("session_artifacts", "content")
