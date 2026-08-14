"""add indexed session agent-run projections

Revision ID: 20260814_0062
Revises: 20260811_0061
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260814_0062"
down_revision = "20260811_0061"
branch_labels = None
depends_on = None


def _uuid() -> sa.TypeEngine:
    return postgresql.UUID(as_uuid=False).with_variant(sa.Text(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "session_agent_runs",
        sa.Column("id", _uuid(), primary_key=True),
        sa.Column(
            "session_id",
            _uuid(),
            nullable=False,
        ),
        sa.Column("run_id", sa.Text(), nullable=False),
        sa.Column("logical_agent_id", sa.Text(), nullable=True),
        sa.Column("placement_id", sa.Text(), nullable=True),
        sa.UniqueConstraint("session_id", "run_id", name="uq_session_agent_runs_run"),
    )
    op.create_index(
        "ix_session_agent_runs_logical_agent",
        "session_agent_runs",
        ["logical_agent_id"],
    )
    op.create_index(
        "ix_session_agent_runs_placement",
        "session_agent_runs",
        ["placement_id"],
    )
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            sa.text(
                """
                INSERT INTO session_agent_runs
                    (id, session_id, run_id, logical_agent_id, placement_id)
                SELECT gen_random_uuid(), sessions.id, run->>'id',
                       NULLIF(run->>'logicalAgentId', ''),
                       NULLIF(run->>'placementId', '')
                FROM sessions
                CROSS JOIN LATERAL jsonb_array_elements(
                    COALESCE(sessions.snapshot->'agentRuns', '[]'::jsonb)
                ) AS run
                WHERE run ? 'id'
                  AND (run ? 'logicalAgentId' OR run ? 'placementId')
                """
            )
        )
    else:
        sessions = sa.table(
            "sessions", sa.column("id", _uuid()), sa.column("snapshot", sa.JSON())
        )
        agent_runs = sa.table(
            "session_agent_runs",
            sa.column("id", _uuid()),
            sa.column("session_id", _uuid()),
            sa.column("run_id", sa.Text()),
            sa.column("logical_agent_id", sa.Text()),
            sa.column("placement_id", sa.Text()),
        )
        rows = []
        for session_id, snapshot in bind.execute(
            sa.select(sessions.c.id, sessions.c.snapshot)
        ):
            for run in (snapshot or {}).get("agentRuns") or []:
                if not run.get("id") or not (
                    run.get("logicalAgentId") or run.get("placementId")
                ):
                    continue
                rows.append(
                    {
                        "id": str(uuid.uuid4()),
                        "session_id": str(session_id),
                        "run_id": run["id"],
                        "logical_agent_id": run.get("logicalAgentId"),
                        "placement_id": run.get("placementId"),
                    }
                )
        if rows:
            op.bulk_insert(agent_runs, rows)


def downgrade() -> None:
    op.drop_index("ix_session_agent_runs_placement", table_name="session_agent_runs")
    op.drop_index(
        "ix_session_agent_runs_logical_agent", table_name="session_agent_runs"
    )
    op.drop_table("session_agent_runs")
