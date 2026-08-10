"""persist the control-panel node token so owners can reveal or reissue it

Revision ID: 20260810_0060
Revises: 20260809_0059
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260810_0060"
down_revision = "20260809_0059"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable: managed runtime credentials stay one-time-only by design, and
    # nodes provisioned before this column have no recoverable plaintext.
    op.add_column("daemon_nodes", sa.Column("node_token_secret", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("daemon_nodes", "node_token_secret")
