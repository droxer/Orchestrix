"""add foreign keys across aggregate boundaries

Revision ID: 20260730_0050
Revises: 20260730_0049

Foreign keys existed only inside a single store's tables, because each store
owned a separate MetaData and could not name another's tables. Nothing tied an
agent to its employee, a placement to its agent or node, or a node to its
employee, so a dangling reference was only ever caught -- if at all -- by the
code that dereferenced it. `agent_placements` had accumulated rows pointing at
hard-deleted nodes exactly this way; they are cleaned up here, which is what
ON DELETE CASCADE would have done at the time.

`employees` is soft-deleted and never removed, so the employee-facing keys use
RESTRICT: a hard delete should fail loudly rather than silently orphan or blank
an agent roster.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260730_0050"
down_revision = "20260730_0049"
branch_labels = None
depends_on = None

# (name, table, column, target table, on delete)
FOREIGN_KEYS = (
    ("fk_agents_supervisor_employee", "agents", "supervisor_employee_id", "employees", "RESTRICT"),
    ("fk_agent_placements_agent", "agent_placements", "agent_id", "agents", "CASCADE"),
    ("fk_agent_placements_node", "agent_placements", "daemon_node_id", "daemon_nodes", "CASCADE"),
    ("fk_agent_placements_supervisor_employee", "agent_placements", "supervisor_employee_id", "employees", "RESTRICT"),
    ("fk_daemon_nodes_employee", "daemon_nodes", "employee_id", "employees", "SET NULL"),
    ("fk_teams_owner_employee", "teams", "owner_employee_id", "employees", "RESTRICT"),
)


def upgrade() -> None:
    connection = op.get_bind()

    # Placements whose node was hard-deleted before this key existed.
    orphaned = connection.execute(
        sa.text(
            "DELETE FROM agent_placements WHERE daemon_node_id NOT IN "
            "(SELECT id FROM daemon_nodes)"
        )
    ).rowcount
    if orphaned:
        op.get_context().impl.static_output(
            f"0050: removed {orphaned} placement(s) referencing deleted nodes"
        )

    for name, table, column, target, ondelete in FOREIGN_KEYS:
        op.create_foreign_key(
            name, table, target, [column], ["id"], ondelete=ondelete
        )


def downgrade() -> None:
    for name, table, _column, _target, _ondelete in reversed(FOREIGN_KEYS):
        op.drop_constraint(name, table, type_="foreignkey")
