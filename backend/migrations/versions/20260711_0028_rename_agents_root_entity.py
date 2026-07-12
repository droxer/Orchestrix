"""rename employee agents to agent root entities

Revision ID: 20260711_0028
Revises: 20260710_0027
"""

from alembic import op


revision = "20260711_0028"
down_revision = "20260710_0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.rename_table("employee_agents", "agents")
    op.rename_table("employee_agent_events", "agent_events")
    op.alter_column("agents", "employee_public_id", new_column_name="supervisor_employee_public_id")
    op.drop_constraint("uq_employee_agents_employee_display_name_key", "agents", type_="unique")
    op.create_unique_constraint(
        "uq_agents_supervisor_display_name_key",
        "agents",
        ["supervisor_employee_public_id", "display_name_key"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_agents_supervisor_display_name_key", "agents", type_="unique")
    op.create_unique_constraint(
        "uq_employee_agents_employee_display_name_key",
        "agents",
        ["supervisor_employee_public_id", "display_name_key"],
    )
    op.alter_column("agents", "supervisor_employee_public_id", new_column_name="employee_public_id")
    op.rename_table("agent_events", "employee_agent_events")
    op.rename_table("agents", "employee_agents")
