"""add the org-wide cap on automatic task rounds

Revision ID: 20260807_0058
Revises: 20260806_0057
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260807_0058"
down_revision = "20260806_0057"
branch_labels = None
depends_on = None

DEFAULT_MAX_TASK_ROUNDS = 5


def upgrade() -> None:
    # Not nullable with a server default: every existing row needs a cap the
    # moment continuation exists, or a task could loop without one.
    op.add_column(
        "org_settings",
        sa.Column(
            "max_task_rounds",
            sa.Integer(),
            nullable=False,
            server_default=str(DEFAULT_MAX_TASK_ROUNDS),
        ),
    )
    op.create_check_constraint(
        "ck_org_settings_max_task_rounds_positive",
        "org_settings",
        "max_task_rounds >= 1",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_org_settings_max_task_rounds_positive", "org_settings", type_="check"
    )
    op.drop_column("org_settings", "max_task_rounds")
