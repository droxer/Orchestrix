"""rename agent placement supervisor column

Revision ID: 20260712_0029
Revises: 20260711_0028
"""

from alembic import op


revision = "20260712_0029"
down_revision = "20260711_0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "agent_placements",
        "employee_public_id",
        new_column_name="supervisor_employee_public_id",
    )


def downgrade() -> None:
    op.alter_column(
        "agent_placements",
        "supervisor_employee_public_id",
        new_column_name="employee_public_id",
    )
