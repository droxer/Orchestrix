"""reserve prepared daemon run requests as active session work

Revision ID: 20260811_0059
Revises: 20260807_0058
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260811_0059"
down_revision = "20260807_0058"
branch_labels = None
depends_on = None

INDEX_NAME = "uq_daemon_run_requests_active_session"
OLD_ACTIVE_STATUSES = "'running', 'dispatching', 'finalizing'"
ACTIVE_STATUSES = "'prepared', 'running', 'dispatching', 'finalizing'"


def _replace_index(statuses: str) -> None:
    bind = op.get_bind()
    predicate = f"status IN ({statuses})"
    if bind.dialect.name == "postgresql":
        # This table is on the dispatch hot path. Avoid blocking reads and
        # writes while replacing the predicate on an existing installation.
        with op.get_context().autocommit_block():
            op.execute(sa.text(f"DROP INDEX CONCURRENTLY IF EXISTS {INDEX_NAME}"))
            op.execute(
                sa.text(
                    f"CREATE UNIQUE INDEX CONCURRENTLY {INDEX_NAME} "
                    f"ON daemon_run_requests (session_id) WHERE {predicate}"
                )
            )
        return
    op.drop_index(INDEX_NAME, table_name="daemon_run_requests")
    op.create_index(
        INDEX_NAME,
        "daemon_run_requests",
        ["session_id"],
        unique=True,
        sqlite_where=sa.text(predicate),
    )


def upgrade() -> None:
    _replace_index(ACTIVE_STATUSES)


def downgrade() -> None:
    _replace_index(OLD_ACTIVE_STATUSES)
