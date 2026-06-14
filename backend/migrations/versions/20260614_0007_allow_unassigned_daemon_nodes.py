"""allow unassigned daemon nodes

Revision ID: 20260614_0007
Revises: 20260614_0006
Create Date: 2026-06-14 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

revision = "20260614_0007"
down_revision = "20260614_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("daemon_nodes", "employee_id", nullable=True)


def downgrade() -> None:
    op.alter_column("daemon_nodes", "employee_id", nullable=False)
