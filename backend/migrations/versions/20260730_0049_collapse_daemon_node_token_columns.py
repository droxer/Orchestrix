"""collapse the daemon_nodes credential columns

Revision ID: 20260730_0049
Revises: 20260730_0048

`daemon_nodes` carried four credential columns. Two are real and stay:
`ui_token_hash` (control-panel token) and `node_token_hash` (daemon token).
The other two go:

- `node_token` held a plaintext daemon token. Nothing has written it since the
  split -- `node_to_row` hard-codes NULL -- and nothing reads it, but rows
  predating the split may still hold a live secret, so it is overwritten before
  the column is dropped. Overwriting and dropping both leave the original tuples
  on disk until the table is rewritten; run `VACUUM FULL daemon_nodes` afterwards
  if a database predates the credential split and its pages matter. That is left
  to the operator because VACUUM cannot run inside a migration's transaction and
  takes an exclusive lock.
- `token_hash` was the pre-split single hash that served both purposes, read
  only as a fallback. Its value is backfilled into whichever of the two real
  columns is still empty, which preserves the fallback's exact behaviour, and
  then the column and the fallback code path both go away.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260730_0049"
down_revision = "20260730_0048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    columns = {
        item["name"] for item in sa.inspect(connection).get_columns("daemon_nodes")
    }

    if "token_hash" in columns:
        # A row holding only the pre-split hash used one token for both roles.
        connection.execute(
            sa.text(
                "UPDATE daemon_nodes SET ui_token_hash = token_hash "
                "WHERE ui_token_hash IS NULL AND token_hash IS NOT NULL"
            )
        )
        connection.execute(
            sa.text(
                "UPDATE daemon_nodes SET node_token_hash = token_hash "
                "WHERE node_token_hash IS NULL AND token_hash IS NOT NULL"
            )
        )

    if "node_token" in columns:
        connection.execute(
            sa.text("UPDATE daemon_nodes SET node_token = NULL WHERE node_token IS NOT NULL")
        )

    with op.batch_alter_table("daemon_nodes") as batch:
        if "node_token" in columns:
            batch.drop_column("node_token")
        if "token_hash" in columns:
            batch.drop_column("token_hash")


def downgrade() -> None:
    op.add_column("daemon_nodes", sa.Column("token_hash", sa.Text(), nullable=True))
    op.add_column("daemon_nodes", sa.Column("node_token", sa.Text(), nullable=True))
