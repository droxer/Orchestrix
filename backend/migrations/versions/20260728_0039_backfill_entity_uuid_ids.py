"""backfill thread, agent, and node public ids with UUIDs

Revision ID: 20260728_0039
Revises: 20260726_0038
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "20260728_0039"
down_revision = "20260726_0038"
branch_labels = None
depends_on = None

logger = logging.getLogger(__name__)

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

MAPPING_TABLE = "uuid_id_map"
STAGING_PREFIX = "uuid_migration_"


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
    combined = {
        old_id: new_id
        for mapping in mappings.values()
        for old_id, new_id in mapping.items()
    }
    if not combined:
        logger.info("0039 backfill: no legacy public ids found, skipping")
        return

    logger.info(
        "0039 backfill: rewriting %d legacy public ids across %d entity tables",
        len(combined),
        len(mappings),
    )
    _create_mapping_table(connection, combined)
    try:
        for entity_table, references in REFERENCE_COLUMNS.items():
            if not mappings.get(entity_table):
                continue
            for table, column in references:
                if table in table_names and column in columns[table]:
                    updated = _replace_column_values(connection, table, column)
                    logger.info(
                        "0039 backfill: %s.%s updated %d rows",
                        table,
                        column,
                        updated,
                    )

        if "agents" in table_names and "compatibility_key" in columns["agents"]:
            _replace_embedded_column_values(
                connection,
                "agents",
                "compatibility_key",
                mappings.get("daemon_nodes", {}),
            )

        pattern = _build_pattern(combined)
        for table, column in JSON_COLUMNS:
            if (
                table in table_names
                and "id" in columns[table]
                and column in columns[table]
            ):
                updated = _replace_json_values(
                    connection, table, column, pattern, combined
                )
                logger.info(
                    "0039 backfill: %s.%s rewrote %d rows",
                    table,
                    column,
                    updated,
                )

        for table in ENTITY_TABLES:
            if mappings.get(table):
                _replace_public_ids(connection, table)
                logger.info("0039 backfill: %s.public_id backfilled", table)
    finally:
        connection.execute(sa.text(f"DROP TABLE IF EXISTS {MAPPING_TABLE}"))


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
        if row["public_id"] is not None
        and row["id"] is not None
        and str(row["public_id"]) != str(row["id"])
    }


def _create_mapping_table(connection: Any, mapping: dict[str, str]) -> None:
    connection.execute(
        sa.text(
            f"CREATE TEMPORARY TABLE {MAPPING_TABLE} ("
            "old_id TEXT PRIMARY KEY, new_id TEXT NOT NULL)"
        )
    )
    statement = sa.text(
        f"INSERT INTO {MAPPING_TABLE} (old_id, new_id) "
        "VALUES (:old_id, :new_id)"
    )
    items = [
        {"old_id": old_id, "new_id": new_id}
        for old_id, new_id in mapping.items()
    ]
    for start in range(0, len(items), BATCH_SIZE):
        connection.execute(statement, items[start : start + BATCH_SIZE])


def _replace_column_values(connection: Any, table: str, column: str) -> int:
    result = connection.execute(
        sa.text(
            f'UPDATE "{table}" SET "{column}" = ('
            f"SELECT new_id FROM {MAPPING_TABLE} "
            f'WHERE old_id = "{table}"."{column}") '
            f'WHERE "{column}" IN (SELECT old_id FROM {MAPPING_TABLE})'
        )
    )
    return result.rowcount


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


def _build_pattern(mapping: dict[str, str]) -> re.Pattern[str]:
    ordered = sorted(mapping, key=len, reverse=True)
    return re.compile("|".join(re.escape(key) for key in ordered))


def _replace_public_ids(connection: Any, table: str) -> None:
    quoted = f'"{table}"'
    connection.execute(
        sa.text(
            f"UPDATE {quoted} SET public_id = '{STAGING_PREFIX}' || replace(("
            f"SELECT new_id FROM {MAPPING_TABLE} "
            f"WHERE old_id = {quoted}.public_id), '-', '') "
            f"WHERE public_id IN (SELECT old_id FROM {MAPPING_TABLE})"
        )
    )
    connection.execute(
        sa.text(
            f"UPDATE {quoted} SET public_id = ("
            f"SELECT new_id FROM {MAPPING_TABLE} "
            f"WHERE '{STAGING_PREFIX}' || replace(new_id, '-', '') = "
            f"{quoted}.public_id) "
            f"WHERE public_id IN ("
            f"SELECT '{STAGING_PREFIX}' || replace(new_id, '-', '') "
            f"FROM {MAPPING_TABLE})"
        )
    )


def _replace_json_values(
    connection: Any,
    table: str,
    column: str,
    pattern: re.Pattern[str],
    mapping: dict[str, str],
) -> int:
    value_expression = (
        "CAST(:value AS JSONB)"
        if connection.dialect.name == "postgresql"
        else ":value"
    )
    update = sa.text(
        f'UPDATE "{table}" SET "{column}" = {value_expression} '
        "WHERE id = :row_id"
    )
    updated = 0
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
            return updated
        replacements = []
        for row in rows:
            raw_value = row[column]
            if raw_value is None:
                continue
            decoded = json.loads(raw_value) if isinstance(raw_value, str) else raw_value
            replaced = _replace_json_scalars(decoded, pattern, mapping)
            if replaced == decoded:
                continue
            replacements.append(
                {
                    "row_id": row["id"],
                    "value": json.dumps(replaced, separators=(",", ":")),
                }
            )
        if replacements:
            connection.execute(update, replacements)
            updated += len(replacements)
        after_id = rows[-1]["id"]


def _replace_json_scalars(
    value: Any, pattern: re.Pattern[str], mapping: dict[str, str]
) -> Any:
    if isinstance(value, str):
        replaced, count = pattern.subn(lambda match: mapping[match.group(0)], value)
        return replaced if count else value
    if isinstance(value, list):
        return [_replace_json_scalars(item, pattern, mapping) for item in value]
    if isinstance(value, dict):
        return {
            key: _replace_json_scalars(item, pattern, mapping)
            for key, item in value.items()
        }
    return value
