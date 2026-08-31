"""claim local computer enrollments across backend replicas

Revision ID: 20260831_0064
Revises: 20260815_0063
"""

from __future__ import annotations

import hashlib
import os
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "20260831_0064"
down_revision = "20260815_0063"
branch_labels = None
depends_on = None


def _enrollment_key(employee_id: Any, workspace_path: str) -> str:
    normalized_workspace = os.path.normcase(os.path.abspath(workspace_path.strip()))
    digest = hashlib.sha256(
        f"{str(employee_id).strip()}\0{normalized_workspace}".encode()
    ).hexdigest()
    return f"sha256:{digest}"


def upgrade() -> None:
    op.add_column("daemon_nodes", sa.Column("enrollment_key", sa.Text(), nullable=True))

    daemon_nodes = sa.table(
        "daemon_nodes",
        sa.column("id"),
        sa.column("employee_id"),
        sa.column("workspace_path"),
        sa.column("workspace_id"),
        sa.column("managed_node_id"),
        sa.column("retired_at"),
        sa.column("status"),
        sa.column("created_at"),
        sa.column("updated_at"),
        sa.column("enrollment_key"),
    )
    connection = op.get_bind()
    rows = (
        connection.execute(
            sa.select(daemon_nodes).where(
                daemon_nodes.c.employee_id.is_not(None),
                daemon_nodes.c.workspace_path.is_not(None),
                daemon_nodes.c.managed_node_id.is_(None),
                daemon_nodes.c.retired_at.is_(None),
            )
        )
        .mappings()
        .all()
    )
    groups: dict[str, list[Any]] = defaultdict(list)
    for row in rows:
        workspace_path = str(row["workspace_path"] or "").strip()
        if workspace_path:
            groups[_enrollment_key(row["employee_id"], workspace_path)].append(row)

    retired_at = datetime.now(UTC)
    for enrollment_key, matches in groups.items():
        # A registered node has the physical machine-id (`workspace_id`) and
        # therefore wins over a request that never launched. If several real
        # computers intentionally use the same path, retain all of them but
        # attach the provisional key to only the oldest one.
        registered = [row for row in matches if row["workspace_id"]]
        candidates = registered or matches
        winner = min(candidates, key=lambda row: (row["created_at"], str(row["id"])))
        connection.execute(
            sa.update(daemon_nodes)
            .where(daemon_nodes.c.id == winner["id"])
            .values(enrollment_key=enrollment_key)
        )
        for duplicate in matches:
            if duplicate["id"] == winner["id"] or duplicate["workspace_id"]:
                continue
            connection.execute(
                sa.update(daemon_nodes)
                .where(daemon_nodes.c.id == duplicate["id"])
                .values(
                    retired_at=retired_at,
                    updated_at=retired_at,
                    status="stopped",
                )
            )

    op.create_index(
        "uq_daemon_nodes_local_enrollment",
        "daemon_nodes",
        ["enrollment_key"],
        unique=True,
        postgresql_where=sa.text(
            "enrollment_key IS NOT NULL AND managed_node_id IS NULL "
            "AND retired_at IS NULL"
        ),
        sqlite_where=sa.text(
            "enrollment_key IS NOT NULL AND managed_node_id IS NULL "
            "AND retired_at IS NULL"
        ),
    )


def downgrade() -> None:
    op.drop_index("uq_daemon_nodes_local_enrollment", table_name="daemon_nodes")
    op.drop_column("daemon_nodes", "enrollment_key")
