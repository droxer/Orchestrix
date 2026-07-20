"""enforce one active daemon run request per session

Revision ID: 20260719_0030
Revises: 20260712_0029
"""

import sqlalchemy as sa

from alembic import op


revision = "20260719_0030"
down_revision = "20260712_0029"
branch_labels = None
depends_on = None


ACTIVE_STATUSES = "'running', 'dispatching', 'finalizing'"
INDEX_NAME = "uq_daemon_run_requests_active_session"


def upgrade() -> None:
    # The old check-then-insert path could leave more than one active request
    # for a session. Preserve the earliest claim and fail later duplicates so
    # the unique index can be installed without blocking an upgrade.
    superseded_requests = f"""
        SELECT current_command_public_id, current_run_public_id
        FROM (
            SELECT
                current_command_public_id,
                current_run_public_id,
                ROW_NUMBER() OVER (
                    PARTITION BY session_public_id
                    ORDER BY created_at ASC, id ASC
                ) AS claim_order
            FROM daemon_run_requests
            WHERE status IN ({ACTIVE_STATUSES})
        ) AS ranked_active_requests
        WHERE claim_order > 1
    """
    op.execute(
        sa.text(
            f"""
            UPDATE daemon_commands
            SET
                status = 'cancelled',
                error = COALESCE(
                    error,
                    'Superseded by the active run request retained for this session.'
                ),
                updated_at = CURRENT_TIMESTAMP,
                completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
                lease_id = NULL,
                lease_expires_at = NULL
            WHERE public_id IN (
                SELECT current_command_public_id
                FROM ({superseded_requests}) AS superseded
                WHERE current_command_public_id IS NOT NULL
            )
            AND status NOT IN ('completed', 'failed', 'cancelled')
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            UPDATE daemon_runs
            SET
                status = 'cancelled',
                error = COALESCE(
                    error,
                    'Superseded by the active run request retained for this session.'
                ),
                completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
            WHERE public_id IN (
                SELECT current_run_public_id
                FROM ({superseded_requests}) AS superseded
                WHERE current_run_public_id IS NOT NULL
            )
            AND status NOT IN ('completed', 'failed', 'cancelled')
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            WITH ranked_active_requests AS (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY session_public_id
                        ORDER BY created_at ASC, id ASC
                    ) AS claim_order
                FROM daemon_run_requests
                WHERE status IN ({ACTIVE_STATUSES})
            )
            UPDATE daemon_run_requests
            SET
                status = 'failed',
                error = COALESCE(
                    error,
                    'Superseded while enforcing one active run per session.'
                ),
                updated_at = CURRENT_TIMESTAMP,
                completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
            WHERE id IN (
                SELECT id
                FROM ranked_active_requests
                WHERE claim_order > 1
            )
            """
        )
    )
    op.create_index(
        INDEX_NAME,
        "daemon_run_requests",
        ["session_public_id"],
        unique=True,
        postgresql_where=sa.text(f"status IN ({ACTIVE_STATUSES})"),
        sqlite_where=sa.text(f"status IN ({ACTIVE_STATUSES})"),
    )


def downgrade() -> None:
    op.drop_index(INDEX_NAME, table_name="daemon_run_requests")
