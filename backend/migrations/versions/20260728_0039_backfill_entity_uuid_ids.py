"""backfill thread, agent, and node public ids with UUIDs

Revision ID: 20260728_0039
Revises: 20260726_0038
"""

from __future__ import annotations

import json
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "20260728_0039"
down_revision = "20260726_0038"
branch_labels = None
depends_on = None

ENTITY_TABLES = ("sessions", "agents", "daemon_nodes")

REFERENCE_COLUMNS = {
    "sessions": (
        ("task_sessions", "session_public_id"),
        ("daemon_runs", "session_public_id"),
        ("daemon_run_requests", "session_public_id"),
        ("session_run_token_usage", "session_public_id"),
    ),
    "agents": (
        ("agent_placements", "agent_public_id"),
        ("tasks", "assigned_agent_id"),
        ("teams", "lead_agent_id"),
        ("daemon_runs", "logical_agent_id"),
    ),
    "daemon_nodes": (
        ("daemon_commands", "node_public_id"),
        ("daemon_runs", "node_public_id"),
        ("daemon_run_requests", "node_public_id"),
        ("daemon_events", "node_public_id"),
        ("agent_placements", "daemon_node_public_id"),
    ),
}

JSON_COLUMNS = (
    ("sessions", "snapshot"),
    ("session_events", "payload"),
    ("session_artifacts", "metadata"),
    ("tasks", "snapshot"),
    ("task_events", "payload"),
    ("agents", "snapshot"),
    ("agent_events", "payload"),
    ("agent_placements", "snapshot"),
    ("agent_placement_events", "payload"),
    ("teams", "member_agent_ids"),
    ("teams", "snapshot"),
    ("team_events", "payload"),
    ("daemon_commands", "command"),
    ("daemon_run_requests", "assignments"),
    ("daemon_run_requests", "state"),
    ("daemon_events", "payload"),
)

BATCH_SIZE = 500


def upgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    table_names = set(inspector.get_table_names())
    columns = {
        table: {item["name"] for item in inspector.get_columns(table)}
        for table in table_names
    }
    mappings = {
        table: _entity_mapping(connection, table)
        for table in ENTITY_TABLES
        if table in table_names and {"id", "public_id"}.issubset(columns[table])
    }

    for entity_table, references in REFERENCE_COLUMNS.items():
        mapping = mappings.get(entity_table, {})
        for table, column in references:
            if table in table_names and column in columns[table]:
                _replace_column_values(connection, table, column, mapping)

    if "agents" in table_names and "compatibility_key" in columns["agents"]:
        _replace_embedded_column_values(
            connection, "agents", "compatibility_key", mappings.get("daemon_nodes", {})
        )

    combined_mapping = {
        old_id: new_id for mapping in mappings.values() for old_id, new_id in mapping.items()
    }
    for table, column in JSON_COLUMNS:
        if (
            table in table_names
            and "id" in columns[table]
            and column in columns[table]
        ):
            _replace_json_values(connection, table, column, combined_mapping)

    for table, mapping in mappings.items():
        _replace_public_ids(connection, table, mapping)


def downgrade() -> None:
    raise NotImplementedError(
        "Legacy public identifiers cannot be reconstructed after UUID backfill."
    )


def _entity_mapping(connection: Any, table: str) -> dict[str, str]:
    rows = connection.execute(
        sa.text(f'SELECT id, public_id FROM "{table}"')
    ).mappings()
    return {
        str(row["public_id"]): str(row["id"])
        for row in rows
        if str(row["public_id"]) != str(row["id"])
    }


def _replace_column_values(
    connection: Any, table: str, column: str, mapping: dict[str, str]
) -> None:
    statement = sa.text(
        f'UPDATE "{table}" SET "{column}" = :new_id WHERE "{column}" = :old_id'
    )
    for old_id, new_id in mapping.items():
        connection.execute(statement, {"old_id": old_id, "new_id": new_id})


def _replace_public_ids(
    connection: Any, table: str, mapping: dict[str, str]
) -> None:
    statement = sa.text(
        f'UPDATE "{table}" SET public_id = :new_id WHERE public_id = :old_id'
    )
    staged: dict[str, str] = {}
    for old_id, new_id in mapping.items():
        temporary_id = f"uuid_migration_{new_id.replace('-', '')}"
        connection.execute(
            statement, {"old_id": old_id, "new_id": temporary_id}
        )
        staged[temporary_id] = new_id
    for temporary_id, new_id in staged.items():
        connection.execute(
            statement, {"old_id": temporary_id, "new_id": new_id}
        )


def _replace_embedded_column_values(
    connection: Any, table: str, column: str, mapping: dict[str, str]
) -> None:
    statement = sa.text(
        f'UPDATE "{table}" SET "{column}" = '
        f'replace("{column}", :old_id, :new_id) '
        f'WHERE "{column}" LIKE :pattern'
    )
    for old_id, new_id in mapping.items():
        connection.execute(
            statement,
            {"old_id": old_id, "new_id": new_id, "pattern": f"%{old_id}%"},
        )


def _replace_json_values(
    connection: Any, table: str, column: str, mapping: dict[str, str]
) -> None:
    if not mapping:
        return
    after_id: Any = None
    while True:
        where = "" if after_id is None else "WHERE id > :after_id"
        rows = connection.execute(
            sa.text(
                f'SELECT id, "{column}" FROM "{table}" '
                f"{where} ORDER BY id LIMIT {BATCH_SIZE}"
            ),
            {} if after_id is None else {"after_id": after_id},
        ).mappings().all()
        if not rows:
            return
        for row in rows:
            raw_value = row[column]
            decoded = json.loads(raw_value) if isinstance(raw_value, str) else raw_value
            replaced = _replace_json_scalars(decoded, mapping)
            if replaced == decoded:
                continue
            encoded = json.dumps(replaced, separators=(",", ":"))
            value_expression = (
                "CAST(:value AS JSONB)"
                if connection.dialect.name == "postgresql"
                else ":value"
            )
            connection.execute(
                sa.text(
                    f'UPDATE "{table}" SET "{column}" = {value_expression} '
                    "WHERE id = :row_id"
                ),
                {"row_id": row["id"], "value": encoded},
            )
        after_id = rows[-1]["id"]


def _replace_json_scalars(value: Any, mapping: dict[str, str]) -> Any:
    if isinstance(value, str):
        for old_id, new_id in mapping.items():
            value = value.replace(old_id, new_id)
        return value
    if isinstance(value, list):
        return [_replace_json_scalars(item, mapping) for item in value]
    if isinstance(value, dict):
        return {
            key: _replace_json_scalars(item, mapping) for key, item in value.items()
        }
    return value
