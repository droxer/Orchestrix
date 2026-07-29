"""remove legacy public ids for threads, agents, and nodes

Revision ID: 20260729_0041
Revises: 20260728_0040
"""

from __future__ import annotations

import logging
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "20260729_0041"
down_revision = "20260728_0040"
branch_labels = None
depends_on = None

logger = logging.getLogger(__name__)

RENAMED_COLUMNS = (
    ("task_sessions", "session_public_id", "session_id"),
    ("agent_placements", "agent_public_id", "agent_id"),
    ("agent_placements", "daemon_node_public_id", "daemon_node_id"),
    ("daemon_runs", "session_public_id", "session_id"),
    ("daemon_run_requests", "session_public_id", "session_id"),
)

REDUNDANT_COLUMNS = (
    ("session_run_token_usage", "session_public_id", False),
    ("daemon_commands", "node_public_id", False),
    ("daemon_runs", "node_public_id", False),
    ("daemon_run_requests", "node_public_id", False),
    ("daemon_events", "node_public_id", True),
)

ENTITY_PUBLIC_ID_COLUMNS = ("sessions", "agents", "daemon_nodes")

RENAMED_INDEXES = (
    (
        "agent_placements",
        "ix_agent_placements_agent_public_id",
        "ix_agent_placements_agent_id",
    ),
    (
        "agent_placements",
        "ix_agent_placements_daemon_node_public_id",
        "ix_agent_placements_daemon_node_id",
    ),
    ("daemon_runs", "ix_daemon_runs_session_public_id", "ix_daemon_runs_session_id"),
    (
        "daemon_run_requests",
        "ix_daemon_run_requests_session_public_id",
        "ix_daemon_run_requests_session_id",
    ),
)

RENAMED_CONSTRAINT = (
    "task_sessions",
    "uq_task_sessions_task_session_public",
    "uq_task_sessions_task_session",
)


def upgrade() -> None:
    for table, old_name, new_name in RENAMED_COLUMNS:
        op.alter_column(table, old_name, new_column_name=new_name)

    _rename_indexes(RENAMED_INDEXES)
    _rename_constraint(*RENAMED_CONSTRAINT)

    for table, column, _nullable in REDUNDANT_COLUMNS:
        with op.batch_alter_table(table) as batch:
            batch.drop_column(column)
    for table in ENTITY_PUBLIC_ID_COLUMNS:
        with op.batch_alter_table(table) as batch:
            batch.drop_column("public_id")


def downgrade() -> None:
    for table in ENTITY_PUBLIC_ID_COLUMNS:
        op.add_column(table, sa.Column("public_id", sa.Uuid(), nullable=True))
        op.execute(f'UPDATE "{table}" SET public_id = id')
        op.alter_column(table, "public_id", nullable=False)
        op.create_unique_constraint(f"uq_{table}_public_id", table, ["public_id"])

    for table, column, nullable in REDUNDANT_COLUMNS:
        op.add_column(table, sa.Column(column, sa.Uuid(), nullable=True))
        source = "session_id" if column == "session_public_id" else "node_id"
        op.execute(f'UPDATE "{table}" SET "{column}" = "{source}"')
        if not nullable:
            op.alter_column(table, column, nullable=False)

    table, new_name, old_name = RENAMED_CONSTRAINT
    _rename_constraint(table, new_name, old_name)
    _rename_indexes(
        [(table, new_name, old_name) for table, old_name, new_name in reversed(RENAMED_INDEXES)]
    )
    for table, old_name, new_name in reversed(RENAMED_COLUMNS):
        op.alter_column(table, new_name, new_column_name=old_name)


def _offline() -> bool:
    return bool(getattr(op.get_context(), "as_sql", False))


def _rename_indexes(renames: list[tuple[str, str, str]]) -> None:
    if _offline():
        for _table, old_name, new_name in renames:
            op.execute(f'ALTER INDEX "{old_name}" RENAME TO "{new_name}"')
        return
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    for table, old_name, new_name in renames:
        definition = _find_index(inspector, table, old_name)
        if definition is None:
            logger.warning(
                "0041: index %s on %s not found, skipping rename",
                old_name,
                table,
            )
            continue
        if connection.dialect.name == "postgresql":
            op.execute(f'ALTER INDEX "{old_name}" RENAME TO "{new_name}"')
            continue
        op.drop_index(old_name, table_name=table)
        op.create_index(
            new_name,
            table,
            definition["column_names"],
            unique=definition["unique"],
        )


def _find_index(
    inspector: Any, table: str, name: str
) -> dict[str, Any] | None:
    for index in inspector.get_indexes(table):
        if index["name"] == name:
            return index
    return None


def _rename_constraint(table: str, old_name: str, new_name: str) -> None:
    statement = (
        f'ALTER TABLE {table} RENAME CONSTRAINT '
        f'"{old_name}" TO "{new_name}"'
    )
    if _offline():
        op.execute(statement)
        return
    connection = op.get_bind()
    if connection.dialect.name != "postgresql":
        return
    exists = connection.execute(
        sa.text(
            "SELECT 1 FROM pg_constraint "
            "WHERE conrelid = CAST(:table AS regclass) AND conname = :name"
        ),
        {"table": table, "name": old_name},
    ).scalar()
    if not exists:
        logger.warning(
            "0041: constraint %s on %s not found, skipping rename",
            old_name,
            table,
        )
        return
    op.execute(statement)
