"""repair legacy team ownership column

Revision ID: 20260724_0034
Revises: 20260723_0033
Create Date: 2026-07-24 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260724_0034"
down_revision = "20260723_0033"
branch_labels = None
depends_on = None


LEGACY_COLUMN = "supervisor_employee_public_id"
OWNER_COLUMN = "owner_employee_public_id"
LEGACY_CONSTRAINT = "uq_teams_supervisor_name_key"
OWNER_CONSTRAINT = "uq_teams_owner_name_key"
LEGACY_INDEX = "ix_teams_supervisor_employee_public_id"
OWNER_INDEX = "ix_teams_owner_employee_public_id"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("teams")}

    if OWNER_COLUMN in columns and LEGACY_COLUMN in columns:
        raise RuntimeError(
            "Cannot repair teams ownership schema because both "
            f"{OWNER_COLUMN} and {LEGACY_COLUMN} exist."
        )
    if OWNER_COLUMN in columns:
        return
    if LEGACY_COLUMN not in columns:
        raise RuntimeError(
            "Cannot repair teams ownership schema because neither "
            f"{OWNER_COLUMN} nor {LEGACY_COLUMN} exists."
        )

    constraints = {
        constraint["name"] for constraint in inspector.get_unique_constraints("teams")
    }
    indexes = {index["name"] for index in inspector.get_indexes("teams")}

    op.alter_column(
        "teams",
        LEGACY_COLUMN,
        new_column_name=OWNER_COLUMN,
        existing_type=sa.Text(),
        existing_nullable=False,
    )
    if LEGACY_CONSTRAINT in constraints:
        op.execute(
            "ALTER TABLE teams RENAME CONSTRAINT "
            f"{LEGACY_CONSTRAINT} TO {OWNER_CONSTRAINT}"
        )
    if LEGACY_INDEX in indexes:
        op.execute(f"ALTER INDEX {LEGACY_INDEX} RENAME TO {OWNER_INDEX}")


def downgrade() -> None:
    # This migration repairs a schema that did not match the committed 0032
    # revision. Revision 0033 already expects the owner column, so reverting
    # the repair would recreate the incompatible state.
    pass
