"""add user preferences

Revision ID: 20260726_0038
Revises: 20260726_0037
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260726_0038"
down_revision = "20260726_0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "auth_users",
        sa.Column("theme", sa.Text(), nullable=False, server_default="system"),
    )
    op.add_column(
        "auth_users",
        sa.Column("language", sa.Text(), nullable=False, server_default="en"),
    )


def downgrade() -> None:
    op.drop_column("auth_users", "language")
    op.drop_column("auth_users", "theme")
