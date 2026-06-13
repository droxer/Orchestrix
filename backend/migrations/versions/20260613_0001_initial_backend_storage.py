"""initial backend storage

Revision ID: 20260613_0001
Revises:
Create Date: 2026-06-13 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260613_0001"
down_revision = None
branch_labels = None
depends_on = None


def jsonb() -> postgresql.JSONB:
    return postgresql.JSONB(astext_type=sa.Text())


def timestamp() -> sa.DateTime:
    return sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "relay_sessions",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("workspace_path", sa.Text(), nullable=False),
        sa.Column("owner_employee_id", sa.Text(), nullable=True),
        sa.Column("task_goal", sa.Text(), nullable=False),
        sa.Column("participants", jsonb(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("phase", sa.Text(), nullable=False),
        sa.Column("pending_decision", sa.Text(), nullable=True),
        sa.Column("current_agent", sa.Text(), nullable=True),
        sa.Column("review_verdict", sa.Text(), nullable=True),
        sa.Column("final_outcome", jsonb(), nullable=True),
        sa.Column("snapshot", jsonb(), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", timestamp(), nullable=False),
        sa.Column("updated_at", timestamp(), nullable=False),
    )
    op.create_index("ix_relay_sessions_updated_at", "relay_sessions", ["updated_at"])
    op.create_index("ix_relay_sessions_owner_employee_id", "relay_sessions", ["owner_employee_id"])
    op.create_index("ix_relay_sessions_status", "relay_sessions", ["status"])

    op.create_table(
        "relay_session_events",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("session_id", sa.Text(), sa.ForeignKey("relay_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("timestamp", timestamp(), nullable=False),
        sa.Column("payload", jsonb(), nullable=False),
    )
    op.create_index("ix_relay_session_events_session_id", "relay_session_events", ["session_id"])
    op.create_index("ix_relay_session_events_timestamp", "relay_session_events", ["timestamp"])
    op.create_unique_constraint("uq_relay_session_events_session_sequence", "relay_session_events", ["session_id", "sequence"])

    op.create_table(
        "relay_session_artifacts",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("session_id", sa.Text(), sa.ForeignKey("relay_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent_run_id", sa.Text(), nullable=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("path", sa.Text(), nullable=True),
        sa.Column("content_type", sa.Text(), nullable=True),
        sa.Column("byte_size", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("metadata", jsonb(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", timestamp(), nullable=False),
    )
    op.create_index("ix_relay_session_artifacts_session_id", "relay_session_artifacts", ["session_id"])

    op.create_table(
        "relay_tasks",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("priority", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("assigned_agent", sa.Text(), nullable=True),
        sa.Column("owner_employee_id", sa.Text(), nullable=True),
        sa.Column("snapshot", jsonb(), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", timestamp(), nullable=False),
        sa.Column("updated_at", timestamp(), nullable=False),
    )
    op.create_index("ix_relay_tasks_updated_at", "relay_tasks", ["updated_at"])
    op.create_index("ix_relay_tasks_status", "relay_tasks", ["status"])
    op.create_index("ix_relay_tasks_assigned_agent", "relay_tasks", ["assigned_agent"])
    op.create_index("ix_relay_tasks_owner_employee_id", "relay_tasks", ["owner_employee_id"])

    op.create_table(
        "relay_task_events",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("task_id", sa.Text(), sa.ForeignKey("relay_tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("timestamp", timestamp(), nullable=False),
        sa.Column("payload", jsonb(), nullable=False),
    )
    op.create_index("ix_relay_task_events_task_id", "relay_task_events", ["task_id"])
    op.create_index("ix_relay_task_events_timestamp", "relay_task_events", ["timestamp"])
    op.create_unique_constraint("uq_relay_task_events_task_sequence", "relay_task_events", ["task_id", "sequence"])

    op.create_table(
        "relay_task_sessions",
        sa.Column("task_id", sa.Text(), sa.ForeignKey("relay_tasks.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("session_id", sa.Text(), sa.ForeignKey("relay_sessions.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("created_at", timestamp(), nullable=False),
    )

    op.create_table(
        "relay_daemon_nodes",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("employee_id", sa.Text(), nullable=False),
        sa.Column("workspace_path", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("agents", jsonb(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("ui_token_hash", sa.Text(), nullable=True),
        sa.Column("node_token_hash", sa.Text(), nullable=True),
        sa.Column("token_hash", sa.Text(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", timestamp(), nullable=False),
        sa.Column("updated_at", timestamp(), nullable=False),
        sa.Column("last_seen_at", timestamp(), nullable=True),
    )
    op.create_index("ix_relay_daemon_nodes_employee_id", "relay_daemon_nodes", ["employee_id"])
    op.create_index("ix_relay_daemon_nodes_updated_at", "relay_daemon_nodes", ["updated_at"])
    op.create_index("ix_relay_daemon_nodes_last_seen_at", "relay_daemon_nodes", ["last_seen_at"])

    op.create_table(
        "relay_daemon_commands",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("node_id", sa.Text(), sa.ForeignKey("relay_daemon_nodes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("command", jsonb(), nullable=False),
        sa.Column("exit_code", sa.Integer(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", timestamp(), nullable=False),
        sa.Column("updated_at", timestamp(), nullable=False),
        sa.Column("dispatched_at", timestamp(), nullable=True),
        sa.Column("completed_at", timestamp(), nullable=True),
    )
    op.create_index("ix_relay_daemon_commands_node_status", "relay_daemon_commands", ["node_id", "status"])
    op.create_index("ix_relay_daemon_commands_created_at", "relay_daemon_commands", ["created_at"])

    op.create_table(
        "relay_daemon_runs",
        sa.Column("run_id", sa.Text(), primary_key=True),
        sa.Column("node_id", sa.Text(), sa.ForeignKey("relay_daemon_nodes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("command_id", sa.Text(), sa.ForeignKey("relay_daemon_commands.id", ondelete="SET NULL"), nullable=True),
        sa.Column("session_id", sa.Text(), sa.ForeignKey("relay_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent", sa.Text(), nullable=False),
        sa.Column("mode", sa.Text(), nullable=False),
        sa.Column("task_goal", sa.Text(), nullable=False),
        sa.Column("workspace_path", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("exit_code", sa.Integer(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("started_at", timestamp(), nullable=False),
        sa.Column("completed_at", timestamp(), nullable=True),
    )
    op.create_index("ix_relay_daemon_runs_node_status", "relay_daemon_runs", ["node_id", "status"])
    op.create_index("ix_relay_daemon_runs_session_id", "relay_daemon_runs", ["session_id"])

    op.create_table(
        "relay_daemon_events",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("node_id", sa.Text(), nullable=True),
        sa.Column("command_id", sa.Text(), nullable=True),
        sa.Column("run_id", sa.Text(), nullable=True),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("timestamp", timestamp(), nullable=False),
        sa.Column("payload", jsonb(), nullable=False),
    )
    op.create_index("ix_relay_daemon_events_timestamp", "relay_daemon_events", ["timestamp"])
    op.create_index("ix_relay_daemon_events_node_id", "relay_daemon_events", ["node_id"])


def downgrade() -> None:
    op.drop_index("ix_relay_daemon_events_node_id", table_name="relay_daemon_events")
    op.drop_index("ix_relay_daemon_events_timestamp", table_name="relay_daemon_events")
    op.drop_table("relay_daemon_events")

    op.drop_index("ix_relay_daemon_runs_session_id", table_name="relay_daemon_runs")
    op.drop_index("ix_relay_daemon_runs_node_status", table_name="relay_daemon_runs")
    op.drop_table("relay_daemon_runs")

    op.drop_index("ix_relay_daemon_commands_created_at", table_name="relay_daemon_commands")
    op.drop_index("ix_relay_daemon_commands_node_status", table_name="relay_daemon_commands")
    op.drop_table("relay_daemon_commands")

    op.drop_index("ix_relay_daemon_nodes_last_seen_at", table_name="relay_daemon_nodes")
    op.drop_index("ix_relay_daemon_nodes_updated_at", table_name="relay_daemon_nodes")
    op.drop_index("ix_relay_daemon_nodes_employee_id", table_name="relay_daemon_nodes")
    op.drop_table("relay_daemon_nodes")

    op.drop_table("relay_task_sessions")

    op.drop_constraint("uq_relay_task_events_task_sequence", "relay_task_events", type_="unique")
    op.drop_index("ix_relay_task_events_timestamp", table_name="relay_task_events")
    op.drop_index("ix_relay_task_events_task_id", table_name="relay_task_events")
    op.drop_table("relay_task_events")

    op.drop_index("ix_relay_tasks_owner_employee_id", table_name="relay_tasks")
    op.drop_index("ix_relay_tasks_assigned_agent", table_name="relay_tasks")
    op.drop_index("ix_relay_tasks_status", table_name="relay_tasks")
    op.drop_index("ix_relay_tasks_updated_at", table_name="relay_tasks")
    op.drop_table("relay_tasks")

    op.drop_index("ix_relay_session_artifacts_session_id", table_name="relay_session_artifacts")
    op.drop_table("relay_session_artifacts")

    op.drop_constraint("uq_relay_session_events_session_sequence", "relay_session_events", type_="unique")
    op.drop_index("ix_relay_session_events_timestamp", table_name="relay_session_events")
    op.drop_index("ix_relay_session_events_session_id", table_name="relay_session_events")
    op.drop_table("relay_session_events")

    op.drop_index("ix_relay_sessions_status", table_name="relay_sessions")
    op.drop_index("ix_relay_sessions_owner_employee_id", table_name="relay_sessions")
    op.drop_index("ix_relay_sessions_updated_at", table_name="relay_sessions")
    op.drop_table("relay_sessions")
