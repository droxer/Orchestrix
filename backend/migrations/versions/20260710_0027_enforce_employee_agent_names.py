"""enforce employee-scoped normalized agent names

Revision ID: 20260710_0027
Revises: 20260710_0026
Create Date: 2026-07-10 18:00:00.000000

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260710_0027"
down_revision = "20260710_0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "employee_agents", sa.Column("display_name_key", sa.Text(), nullable=True)
    )
    op.execute(
        """
        UPDATE employee_agents
        SET display_name_key = LOWER(TRIM(display_name))
        WHERE deleted_at IS NULL
        """
    )
    op.create_unique_constraint(
        "uq_employee_agents_employee_display_name_key",
        "employee_agents",
        ["employee_public_id", "display_name_key"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_employee_agents_employee_display_name_key",
        "employee_agents",
        type_="unique",
    )
    op.drop_column("employee_agents", "display_name_key")
