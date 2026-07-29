"""remove remaining legacy public ids

Revision ID: 20260729_0042
Revises: 20260729_0041
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "20260729_0042"
down_revision = "20260729_0041"
branch_labels = None
depends_on = None

logger = logging.getLogger(__name__)

# Tables whose (public_id -> id) pairs form the rewrite mapping. Event tables
# are excluded: nothing references event public ids.
MAPPING_TABLES = (
    "tasks",
    "teams",
    "employees",
    "departments",
    "auth_users",
    "auth_sessions",
    "daemon_commands",
    "daemon_runs",
    "daemon_run_requests",
    "agent_placements",
)

# (table, old column, new column, null_unmatched). Values are rewritten from
# the referenced entity's public_id to its uuid id, then the column is
# renamed. Columns stay Text; when null_unmatched is set, values with no
# mapping entry (dangling pointers to pruned rows) become NULL.
REFERENCE_REWRITES = (
    ("daemon_run_requests", "task_public_id", "task_id", True),
    ("daemon_run_requests", "current_command_public_id", "current_command_id", True),
    ("daemon_run_requests", "current_run_public_id", "current_run_id", True),
    ("agents", "supervisor_employee_public_id", "supervisor_employee_id", False),
    ("agent_placements", "supervisor_employee_public_id", "supervisor_employee_id", False),
    ("teams", "owner_employee_public_id", "owner_employee_id", False),
)

# Text columns holding employee handles; values become employee uuids.
EMPLOYEE_HANDLE_COLUMNS = (
    ("sessions", "owner_employee_id"),
    ("tasks", "owner_employee_id"),
    ("tasks", "assignee_employee_id"),
    ("session_run_token_usage", "owner_employee_id"),
    ("session_token_usage", "owner_employee_id"),
    ("daemon_nodes", "employee_id"),
)

# Redundant legacy duplicates of existing uuid columns.
DROP_COLUMNS = (
    ("daemon_events", "command_public_id"),
    ("daemon_events", "run_public_id"),
    ("daemon_runs", "command_public_id"),
    ("auth_sessions", "user_public_id"),
    ("auth_users", "employee_public_id"),
    ("employees", "department_public_id"),
    ("departments", "parent_department_public_id"),
    ("session_token_usage", "session_public_id"),
)

PUBLIC_ID_TABLES = (
    "agent_events",
    "agent_placement_events",
    "agent_placements",
    "auth_sessions",
    "auth_users",
    "daemon_commands",
    "daemon_events",
    "daemon_run_requests",
    "daemon_runs",
    "departments",
    "employees",
    "session_artifacts",
    "session_events",
    "task_events",
    "tasks",
    "team_events",
    "teams",
)

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
    ("chat_documents", "payload"),
)

RENAMED_INDEXES = (
    ("agents", "ix_employee_agents_employee_public_id", "ix_agents_supervisor_employee_id"),
    (
        "agent_placements",
        "ix_agent_placements_employee_public_id",
        "ix_agent_placements_supervisor_employee_id",
    ),
    ("teams", "ix_teams_owner_employee_public_id", "ix_teams_owner_employee_id"),
    (
        "daemon_run_requests",
        "ix_daemon_run_requests_task_public_id",
        "ix_daemon_run_requests_task_id",
    ),
)

# Generated ids look like task_mrxdemi7_mg70va; employee handles and
# department slugs do not match this and take the exact-match path instead.
GENERATED_ID = re.compile(r"^[a-z]+_[a-z0-9]+_[a-z0-9]+$")

# JSON keys whose string values may hold an employee handle / department slug.
EXACT_KEYS = {
    "id",
    "employeeId",
    "employeeIds",
    "ownerEmployeeId",
    "assigneeEmployeeId",
    "supervisorEmployeeId",
    "leadEmployeeId",
    "departmentId",
    "parentDepartmentId",
    "employee_id",
    "employee_ids",
    "owner_employee_id",
    "assignee_employee_id",
    "supervisor_employee_id",
    "lead_employee_id",
    "department_id",
    "parent_department_id",
}

# JSON keys whose compound values start with an employee handle segment.
PREFIX_KEYS = {"compatibilityKey", "compatibility_key"}

BATCH_SIZE = 500
MAPPING_TABLE = "uuid_id_map"


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
        for table in MAPPING_TABLES
        if table in table_names and {"id", "public_id"}.issubset(columns[table])
    }
    combined = {
        old_id: new_id
        for mapping in mappings.values()
        for old_id, new_id in mapping.items()
    }
    if not combined:
        logger.info("0042: no legacy public ids found, skipping data rewrite")
    else:
        logger.info("0042: rewriting %d legacy public ids", len(combined))
        _create_mapping_table(connection, combined)
        try:
            for table, old_column, _new_column, null_unmatched in REFERENCE_REWRITES:
                if table in table_names and old_column in columns[table]:
                    _rewrite_reference(
                        connection, table, old_column, null_unmatched=null_unmatched
                    )
            employee_map = {
                old: new
                for table in ("employees", "departments")
                for old, new in mappings.get(table, {}).items()
            }
            for table, column in EMPLOYEE_HANDLE_COLUMNS:
                if table in table_names and column in columns[table]:
                    _rewrite_exact_column(
                        connection, table, column, mappings.get("employees", {})
                    )
            if "agents" in table_names and "compatibility_key" in columns["agents"]:
                _rewrite_compatibility_keys(connection, employee_map)
            safe_map = {
                old: new for old, new in combined.items() if GENERATED_ID.match(old)
            }
            exact_map = {
                old: new for old, new in combined.items() if old not in safe_map
            }
            pattern = _build_pattern(safe_map)
            for table, column in JSON_COLUMNS:
                if (
                    table in table_names
                    and "id" in columns[table]
                    and column in columns[table]
                ):
                    updated = _replace_json_values(
                        connection, table, column, pattern, safe_map, exact_map
                    )
                    logger.info("0042: %s.%s rewrote %d rows", table, column, updated)
        finally:
            connection.execute(sa.text(f"DROP TABLE IF EXISTS {MAPPING_TABLE}"))

    for table, old_column, new_column, _null_unmatched in REFERENCE_REWRITES:
        if table in table_names and old_column in columns[table]:
            op.alter_column(table, old_column, new_column_name=new_column)
    _rename_indexes(connection, table_names)

    for table, column in DROP_COLUMNS:
        if table in table_names and column in columns[table]:
            with op.batch_alter_table(table) as batch:
                batch.drop_column(column)
    for table in PUBLIC_ID_TABLES:
        if table in table_names and "public_id" in columns[table]:
            with op.batch_alter_table(table) as batch:
                batch.drop_column("public_id")
            logger.info("0042: dropped %s.public_id", table)


def downgrade() -> None:
    raise NotImplementedError(
        "Legacy public identifiers cannot be reconstructed after removal."
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
        f"INSERT INTO {MAPPING_TABLE} (old_id, new_id) VALUES (:old_id, :new_id)"
    )
    items = [
        {"old_id": old_id, "new_id": new_id} for old_id, new_id in mapping.items()
    ]
    for start in range(0, len(items), BATCH_SIZE):
        connection.execute(statement, items[start : start + BATCH_SIZE])


def _rewrite_reference(
    connection: Any, table: str, column: str, *, null_unmatched: bool
) -> None:
    result = connection.execute(
        sa.text(
            f'UPDATE "{table}" SET "{column}" = ('
            f"SELECT new_id FROM {MAPPING_TABLE} "
            f'WHERE old_id = "{table}"."{column}") '
            f'WHERE "{column}" IN (SELECT old_id FROM {MAPPING_TABLE})'
        )
    )
    logger.info("0042: %s.%s rewrote %d rows", table, column, result.rowcount)
    unmatched = connection.execute(
        sa.text(
            f'SELECT COUNT(*) FROM "{table}" WHERE "{column}" IS NOT NULL '
            f'AND "{column}" NOT IN (SELECT new_id FROM {MAPPING_TABLE})'
        )
    ).scalar_one()
    if not unmatched:
        return
    if null_unmatched:
        logger.warning(
            "0042: nulling %d dangling value(s) in %s.%s",
            unmatched,
            table,
            column,
        )
        connection.execute(
            sa.text(
                f'UPDATE "{table}" SET "{column}" = NULL '
                f'WHERE "{column}" IS NOT NULL AND "{column}" NOT IN '
                f"(SELECT new_id FROM {MAPPING_TABLE})"
            )
        )
    else:
        logger.warning(
            "0042: %d unmatched value(s) left in %s.%s",
            unmatched,
            table,
            column,
        )


def _rewrite_exact_column(
    connection: Any, table: str, column: str, mapping: dict[str, str]
) -> None:
    statement = sa.text(
        f'UPDATE "{table}" SET "{column}" = :new_id WHERE "{column}" = :old_id'
    )
    for old_id, new_id in mapping.items():
        connection.execute(statement, {"old_id": old_id, "new_id": new_id})


def _rewrite_compatibility_keys(connection: Any, mapping: dict[str, str]) -> None:
    statement = sa.text(
        "UPDATE agents SET compatibility_key = "
        ":new_id || substr(compatibility_key, length(:old_id) + 1) "
        "WHERE substr(compatibility_key, 1, length(:old_id) + 1) = :old_id || ':'"
    )
    for old_id, new_id in mapping.items():
        connection.execute(statement, {"old_id": old_id, "new_id": new_id})


def _build_pattern(mapping: dict[str, str]) -> re.Pattern[str] | None:
    if not mapping:
        return None
    ordered = sorted(mapping, key=len, reverse=True)
    return re.compile("|".join(re.escape(key) for key in ordered))


def _replace_json_values(
    connection: Any,
    table: str,
    column: str,
    pattern: re.Pattern[str] | None,
    safe_map: dict[str, str],
    exact_map: dict[str, str],
) -> int:
    value_expression = (
        "CAST(:value AS JSONB)"
        if connection.dialect.name == "postgresql"
        else ":value"
    )
    update = sa.text(
        f'UPDATE "{table}" SET "{column}" = {value_expression} WHERE id = :row_id'
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
            replaced = _replace_json_scalars(decoded, pattern, safe_map, exact_map)
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
    value: Any,
    pattern: re.Pattern[str] | None,
    safe_map: dict[str, str],
    exact_map: dict[str, str],
    key: str | None = None,
) -> Any:
    if isinstance(value, str):
        if key in EXACT_KEYS and value in exact_map:
            return exact_map[value]
        if key in PREFIX_KEYS:
            for old_id, new_id in exact_map.items():
                if value.startswith(old_id + ":"):
                    return new_id + value[len(old_id) :]
        if pattern is None:
            return value
        replaced, count = pattern.subn(lambda match: safe_map[match.group(0)], value)
        return replaced if count else value
    if isinstance(value, list):
        return [
            _replace_json_scalars(item, pattern, safe_map, exact_map, key=key)
            for item in value
        ]
    if isinstance(value, dict):
        return {
            item_key: _replace_json_scalars(
                item, pattern, safe_map, exact_map, key=item_key
            )
            for item_key, item in value.items()
        }
    return value


def _rename_indexes(connection: Any, table_names: set[str]) -> None:
    if connection.dialect.name != "postgresql":
        return
    inspector = sa.inspect(connection)
    for table, old_name, new_name in RENAMED_INDEXES:
        if table not in table_names:
            continue
        exists = any(
            index["name"] == old_name for index in inspector.get_indexes(table)
        )
        if exists:
            op.execute(f'ALTER INDEX "{old_name}" RENAME TO "{new_name}"')
