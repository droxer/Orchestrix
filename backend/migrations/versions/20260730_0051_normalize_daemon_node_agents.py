"""move the per-agent node maps into daemon_node_agents

Revision ID: 20260730_0051
Revises: 20260730_0050

`daemon_nodes` described its agents with five parallel JSON maps -- `agents`
(status), `agent_details`, `disabled_agents`, `agent_role_defaults`, and
`agent_role_overrides` -- all keyed by the same agent name and kept aligned only
by convention. Any question about a single agent ("which nodes can run codex")
meant loading every node and scanning in Python.

They become one row per (node, agent). `run_capacity_by_mode` stays on the node:
it is keyed by run mode, not by agent.
"""

from __future__ import annotations

import json
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "20260730_0051"
down_revision = "20260730_0050"
branch_labels = None
depends_on = None

LEGACY_COLUMNS = (
    "agents",
    "agent_details",
    "disabled_agents",
    "agent_role_defaults",
    "agent_role_overrides",
)


def upgrade() -> None:
    connection = op.get_bind()

    op.create_table(
        "daemon_node_agents",
        sa.Column("node_id", sa.Uuid(as_uuid=False), nullable=False),
        sa.Column("agent", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("details", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("disabled", sa.Boolean(), nullable=False),
        sa.Column("role_default", sa.Text(), nullable=True),
        sa.Column("role_override", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["node_id"], ["daemon_nodes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("node_id", "agent", name="pk_daemon_node_agents"),
    )

    rows = connection.execute(
        sa.text(
            "SELECT id, agents, agent_details, disabled_agents, "
            "agent_role_defaults, agent_role_overrides FROM daemon_nodes"
        )
    ).mappings().all()

    payload = [entry for row in rows for entry in _node_agent_rows(row)]
    if payload:
        connection.execute(
            sa.text(
                "INSERT INTO daemon_node_agents "
                "(node_id, agent, status, details, disabled, role_default, role_override) "
                "VALUES (:node_id, :agent, :status, :details, :disabled, "
                ":role_default, :role_override)"
            ),
            payload,
        )

    with op.batch_alter_table("daemon_nodes") as batch:
        for column in LEGACY_COLUMNS:
            batch.drop_column(column)


def downgrade() -> None:
    connection = op.get_bind()
    op.add_column("daemon_nodes", sa.Column("agents", sa.JSON(), nullable=True))
    op.add_column("daemon_nodes", sa.Column("agent_details", sa.JSON(), nullable=True))
    op.add_column("daemon_nodes", sa.Column("disabled_agents", sa.JSON(), nullable=True))
    op.add_column(
        "daemon_nodes", sa.Column("agent_role_defaults", sa.JSON(), nullable=True)
    )
    op.add_column(
        "daemon_nodes", sa.Column("agent_role_overrides", sa.JSON(), nullable=True)
    )

    grouped: dict[str, dict[str, Any]] = {}
    for row in connection.execute(
        sa.text("SELECT * FROM daemon_node_agents ORDER BY node_id, agent")
    ).mappings():
        node = grouped.setdefault(
            str(row["node_id"]),
            {
                "agents": {},
                "agent_details": {},
                "disabled_agents": [],
                "agent_role_defaults": {},
                "agent_role_overrides": {},
            },
        )
        node["agents"][row["agent"]] = row["status"]
        if row["details"] is not None:
            node["agent_details"][row["agent"]] = row["details"]
        if row["disabled"]:
            node["disabled_agents"].append(row["agent"])
        if row["role_default"]:
            node["agent_role_defaults"][row["agent"]] = row["role_default"]
        if row["role_override"]:
            node["agent_role_overrides"][row["agent"]] = row["role_override"]

    for node_id, maps in grouped.items():
        connection.execute(
            sa.text(
                "UPDATE daemon_nodes SET agents = :agents, "
                "agent_details = :agent_details, disabled_agents = :disabled_agents, "
                "agent_role_defaults = :agent_role_defaults, "
                "agent_role_overrides = :agent_role_overrides WHERE id = :node_id"
            ),
            {"node_id": node_id, **{key: json.dumps(value) for key, value in maps.items()}},
        )

    op.drop_table("daemon_node_agents")


def _node_agent_rows(row: Any) -> list[dict[str, Any]]:
    statuses = _as_dict(row["agents"])
    details = _as_dict(row["agent_details"])
    disabled = set(_as_list(row["disabled_agents"]))
    role_defaults = _as_dict(row["agent_role_defaults"])
    role_overrides = _as_dict(row["agent_role_overrides"])
    names = (
        set(statuses)
        | set(details)
        | disabled
        | set(role_defaults)
        | set(role_overrides)
    )
    return [
        {
            "node_id": str(row["id"]),
            "agent": agent,
            "status": statuses.get(agent) or "unknown",
            "details": json.dumps(details[agent]) if agent in details else None,
            "disabled": agent in disabled,
            "role_default": role_defaults.get(agent),
            "role_override": role_overrides.get(agent),
        }
        for agent in sorted(names)
    ]


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, (str, bytes)):
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _as_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, (str, bytes)):
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError):
            return []
        return parsed if isinstance(parsed, list) else []
    return []
