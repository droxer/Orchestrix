"""align the migrated schema with the declared metadata

Revision ID: 20260730_0046
Revises: 20260729_0045

Drops `session_token_usage`, which migration 0035 superseded with
`session_run_token_usage` but never removed, adds the `daemon_nodes` retirement
index, and converts the `json` columns created by migrations 0024 and 0032 to
`jsonb` so every JSON column in the database has the same type. From this
revision on, `tests/unit/test_schema_drift.py` diffs the migrated database
against `relay.persistence.schema.metadata`, so the two definitions cannot
silently diverge again.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260730_0046"
down_revision = "20260729_0045"
branch_labels = None
depends_on = None

# Created as `json` by 0024 (agents, placements) and 0032 (teams) while every
# other JSON column in the schema is `jsonb`.
JSON_COLUMNS = (
    ("agents", "snapshot", False),
    ("agent_events", "payload", False),
    ("agent_placements", "snapshot", False),
    ("agent_placement_events", "payload", False),
    ("teams", "snapshot", False),
    ("teams", "member_agent_ids", False),
    ("team_events", "payload", False),
)


def upgrade() -> None:
    connection = op.get_bind()
    tables = set(sa.inspect(connection).get_table_names())

    if "session_token_usage" in tables:
        op.drop_table("session_token_usage")

    op.create_index("ix_daemon_nodes_retired_at", "daemon_nodes", ["retired_at"])

    if connection.dialect.name != "postgresql":
        return
    for table, column, nullable in JSON_COLUMNS:
        if table not in tables:
            continue
        op.alter_column(
            table,
            column,
            existing_type=sa.JSON(),
            type_=sa.dialects.postgresql.JSONB(),
            existing_nullable=nullable,
            postgresql_using=f'"{column}"::jsonb',
        )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.dialect.name == "postgresql":
        for table, column, nullable in reversed(JSON_COLUMNS):
            op.alter_column(
                table,
                column,
                existing_type=sa.dialects.postgresql.JSONB(),
                type_=sa.JSON(),
                existing_nullable=nullable,
                postgresql_using=f'"{column}"::json',
            )
    op.drop_index("ix_daemon_nodes_retired_at", table_name="daemon_nodes")
    op.create_table(
        "session_token_usage",
        sa.Column("session_id", sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column("owner_employee_id", sa.Text(), nullable=True),
        sa.Column("input_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column(
            "cache_read_tokens", sa.BigInteger(), nullable=False, server_default="0"
        ),
        sa.Column(
            "cache_creation_tokens", sa.BigInteger(), nullable=False, server_default="0"
        ),
        sa.Column("total_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_session_token_usage_updated_at", "session_token_usage", ["updated_at"]
    )
    op.create_index(
        "ix_session_token_usage_owner_employee_id",
        "session_token_usage",
        ["owner_employee_id"],
    )
