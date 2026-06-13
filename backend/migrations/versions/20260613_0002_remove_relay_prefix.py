"""remove relay prefix

Revision ID: 20260613_0002
Revises: 20260613_0001
Create Date: 2026-06-13 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

revision = "20260613_0002"
down_revision = "20260613_0001"
branch_labels = None
depends_on = None


_TABLES = [
    ("relay_sessions", "sessions"),
    ("relay_session_events", "session_events"),
    ("relay_session_artifacts", "session_artifacts"),
    ("relay_tasks", "tasks"),
    ("relay_task_events", "task_events"),
    ("relay_task_sessions", "task_sessions"),
    ("relay_daemon_nodes", "daemon_nodes"),
    ("relay_daemon_commands", "daemon_commands"),
    ("relay_daemon_runs", "daemon_runs"),
    ("relay_daemon_events", "daemon_events"),
]

_INDEXES = [
    ("ix_relay_sessions_updated_at", "ix_sessions_updated_at"),
    ("ix_relay_sessions_owner_employee_id", "ix_sessions_owner_employee_id"),
    ("ix_relay_sessions_status", "ix_sessions_status"),
    ("ix_relay_session_events_session_id", "ix_session_events_session_id"),
    ("ix_relay_session_events_timestamp", "ix_session_events_timestamp"),
    ("ix_relay_session_artifacts_session_id", "ix_session_artifacts_session_id"),
    ("ix_relay_tasks_updated_at", "ix_tasks_updated_at"),
    ("ix_relay_tasks_status", "ix_tasks_status"),
    ("ix_relay_tasks_assigned_agent", "ix_tasks_assigned_agent"),
    ("ix_relay_tasks_owner_employee_id", "ix_tasks_owner_employee_id"),
    ("ix_relay_task_events_task_id", "ix_task_events_task_id"),
    ("ix_relay_task_events_timestamp", "ix_task_events_timestamp"),
    ("ix_relay_daemon_nodes_employee_id", "ix_daemon_nodes_employee_id"),
    ("ix_relay_daemon_nodes_updated_at", "ix_daemon_nodes_updated_at"),
    ("ix_relay_daemon_nodes_last_seen_at", "ix_daemon_nodes_last_seen_at"),
    ("ix_relay_daemon_commands_node_status", "ix_daemon_commands_node_status"),
    ("ix_relay_daemon_commands_created_at", "ix_daemon_commands_created_at"),
    ("ix_relay_daemon_runs_node_status", "ix_daemon_runs_node_status"),
    ("ix_relay_daemon_runs_session_id", "ix_daemon_runs_session_id"),
    ("ix_relay_daemon_events_timestamp", "ix_daemon_events_timestamp"),
    ("ix_relay_daemon_events_node_id", "ix_daemon_events_node_id"),
]

_CONSTRAINTS = [
    ("relay_session_events", "uq_relay_session_events_session_sequence", "uq_session_events_session_sequence"),
    ("relay_task_events", "uq_relay_task_events_task_sequence", "uq_task_events_task_sequence"),
]


def _rename_index(old: str, new: str) -> None:
    op.execute(f'ALTER INDEX "{old}" RENAME TO "{new}"')


def _rename_constraint(table: str, old: str, new: str) -> None:
    op.execute(f'ALTER TABLE "{table}" RENAME CONSTRAINT "{old}" TO "{new}"')


def upgrade() -> None:
    # Rename constraints while tables still have their old names.
    for table, old_name, new_name in _CONSTRAINTS:
        _rename_constraint(table, old_name, new_name)
    for old_name, new_name in _TABLES:
        op.rename_table(old_name, new_name)
    for old_name, new_name in _INDEXES:
        _rename_index(old_name, new_name)


def downgrade() -> None:
    for old_name, new_name in _INDEXES:
        _rename_index(new_name, old_name)
    for old_name, new_name in reversed(_TABLES):
        op.rename_table(new_name, old_name)
    # Constraints were moved with their table, so reference the old table names again.
    for table, old_name, new_name in _CONSTRAINTS:
        _rename_constraint(table, new_name, old_name)
