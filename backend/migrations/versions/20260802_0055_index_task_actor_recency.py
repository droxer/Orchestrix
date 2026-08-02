"""index task board and dashboard reads by actor and recency

PostgreSQL builds and drops these indexes concurrently. Alembic's autocommit
block intentionally commits the surrounding migration transaction before each
concurrent operation, so deploy this revision as a standalone migration.

Revision ID: 20260802_0055
Revises: 20260801_0054
"""

from __future__ import annotations

from alembic import op

revision = "20260802_0055"
down_revision = "20260801_0054"
branch_labels = None
depends_on = None


def _create_index(name: str, table: str, columns: list[str]) -> None:
    if op.get_bind().dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.create_index(
                name,
                table,
                columns,
                postgresql_concurrently=True,
            )
        return
    op.create_index(name, table, columns)


def _drop_index(name: str, table: str) -> None:
    if op.get_bind().dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.drop_index(name, table_name=table, postgresql_concurrently=True)
        return
    op.drop_index(name, table_name=table)


def upgrade() -> None:
    _create_index("ix_sessions_created_at", "sessions", ["created_at"])
    _create_index(
        "ix_session_events_type_timestamp", "session_events", ["type", "timestamp"]
    )
    _create_index(
        "ix_sessions_owner_updated_at",
        "sessions",
        ["owner_employee_id", "updated_at"],
    )
    _create_index(
        "ix_tasks_owner_updated_at", "tasks", ["owner_employee_id", "updated_at"]
    )
    _create_index(
        "ix_tasks_assignee_updated_at",
        "tasks",
        ["assignee_employee_id", "updated_at"],
    )
    _create_index("ix_tasks_created_at", "tasks", ["created_at"])


def downgrade() -> None:
    _drop_index("ix_tasks_created_at", "tasks")
    _drop_index("ix_tasks_assignee_updated_at", "tasks")
    _drop_index("ix_tasks_owner_updated_at", "tasks")
    _drop_index("ix_sessions_owner_updated_at", "sessions")
    _drop_index("ix_session_events_type_timestamp", "session_events")
    _drop_index("ix_sessions_created_at", "sessions")
