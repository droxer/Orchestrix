"""add org settings and the per-employee local computer limit

Revision ID: 20260806_0056
Revises: 20260802_0055
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260806_0056"
down_revision = "20260802_0055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "org_settings",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column(
            "max_local_computers_per_employee", sa.Integer(), nullable=False
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "max_local_computers_per_employee >= 0",
            name="ck_org_settings_max_local_computers_non_negative",
        ),
    )
    # Nullable by design: empty means "inherit the org default", so a later
    # change to the global value moves every employee who was never pinned.
    op.add_column(
        "employees", sa.Column("max_local_computers", sa.Integer(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("employees", "max_local_computers")
    op.drop_table("org_settings")
