"""express identity and soft-delete uniqueness as partial unique indexes

Revision ID: 20260730_0048
Revises: 20260730_0047

Three invariants that the application enforced by convention become database
constraints:

1. A Computer is (employeeId, workspaceId) for an employee device and
   managedNodeId for a managed one. `daemon_nodes` had only plain indexes, so a
   daemon that restarted with a fresh sandboxId inserted a second live row for
   the same Computer -- the source of stale duplicate nodes and duplicate
   compatibility agents.
2. An agent's name and compatibility identity are unique among an employee's
   *live* agents. This was emulated by nulling `display_name_key` and dropping
   `compatibility_key` on delete, which encoded "deleted" in three columns and
   needed the 0044/0045 repairs. A partial index says it directly, so the key
   columns can now be written unconditionally.
3. An agent has at most one live placement per node, previously held only by an
   advisory row lock in `agent_placement_store`.

`display_name_key` and `name_key` stay: they hold Python's `str.casefold()`,
which is not `lower()` in Postgres for some scripts, so an expression index
would silently disagree with the application's own comparison.
"""

from __future__ import annotations

from alembic import op

revision = "20260730_0048"
down_revision = "20260730_0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "uq_daemon_nodes_computer",
        "daemon_nodes",
        ["employee_id", "workspace_id"],
        unique=True,
        postgresql_where="managed_node_id IS NULL AND retired_at IS NULL",
        sqlite_where="managed_node_id IS NULL AND retired_at IS NULL",
    )
    op.create_index(
        "uq_daemon_nodes_managed_runtime",
        "daemon_nodes",
        ["managed_node_id"],
        unique=True,
        postgresql_where="managed_node_id IS NOT NULL AND retired_at IS NULL",
        sqlite_where="managed_node_id IS NOT NULL AND retired_at IS NULL",
    )

    # Replace the whole-table uniqueness that soft deletes had to escape.
    op.drop_constraint(
        "uq_agents_supervisor_display_name_key", "agents", type_="unique"
    )
    op.create_index(
        "uq_agents_live_supervisor_display_name",
        "agents",
        ["supervisor_employee_id", "display_name_key"],
        unique=True,
        postgresql_where="deleted_at IS NULL",
        sqlite_where="deleted_at IS NULL",
    )
    op.drop_constraint("employee_agents_compatibility_key_key", "agents", type_="unique")
    op.create_index(
        "uq_agents_live_compatibility_key",
        "agents",
        ["compatibility_key"],
        unique=True,
        postgresql_where="deleted_at IS NULL AND compatibility_key IS NOT NULL",
        sqlite_where="deleted_at IS NULL AND compatibility_key IS NOT NULL",
    )

    op.drop_constraint("uq_teams_owner_name_key", "teams", type_="unique")
    op.create_index(
        "uq_teams_live_owner_name",
        "teams",
        ["owner_employee_id", "name_key"],
        unique=True,
        postgresql_where="deleted_at IS NULL",
        sqlite_where="deleted_at IS NULL",
    )

    op.create_index(
        "uq_agent_placements_live_agent_node",
        "agent_placements",
        ["agent_id", "daemon_node_id"],
        unique=True,
        postgresql_where="desired_state <> 'removed'",
        sqlite_where="desired_state <> 'removed'",
    )


def downgrade() -> None:
    op.drop_index(
        "uq_agent_placements_live_agent_node", table_name="agent_placements"
    )
    op.drop_index("uq_teams_live_owner_name", table_name="teams")
    op.create_unique_constraint(
        "uq_teams_owner_name_key", "teams", ["owner_employee_id", "name_key"]
    )
    op.drop_index("uq_agents_live_compatibility_key", table_name="agents")
    op.create_unique_constraint(
        "employee_agents_compatibility_key_key", "agents", ["compatibility_key"]
    )
    op.drop_index("uq_agents_live_supervisor_display_name", table_name="agents")
    op.create_unique_constraint(
        "uq_agents_supervisor_display_name_key",
        "agents",
        ["supervisor_employee_id", "display_name_key"],
    )
    op.drop_index("uq_daemon_nodes_managed_runtime", table_name="daemon_nodes")
    op.drop_index("uq_daemon_nodes_computer", table_name="daemon_nodes")
