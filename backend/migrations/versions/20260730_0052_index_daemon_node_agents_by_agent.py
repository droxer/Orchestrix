"""index daemon_node_agents by agent

Revision ID: 20260730_0052
Revises: 20260730_0051

The primary key is (node_id, agent), which answers "what can this node run" but
not "which nodes can run codex" -- the question normalizing the JSON maps was
meant to make cheap. That one needs agent as the leading column.

Kept as its own revision rather than folded into 0051 so a database that already
migrated to 0051 still picks the index up.
"""

from __future__ import annotations

from alembic import op

revision = "20260730_0052"
down_revision = "20260730_0051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_daemon_node_agents_agent_status",
        "daemon_node_agents",
        ["agent", "status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_daemon_node_agents_agent_status", table_name="daemon_node_agents"
    )
