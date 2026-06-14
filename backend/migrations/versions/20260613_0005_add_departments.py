"""add departments table

Revision ID: 20260613_0005
Revises: 20260613_0004
Create Date: 2026-06-13 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260613_0005"
down_revision = "20260613_0004"
branch_labels = None
depends_on = None


def timestamp() -> sa.DateTime:
    return sa.DateTime(timezone=True)


def uuid_pk() -> sa.Column:
    return sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True, server_default=sa.text("gen_random_uuid()"))


def upgrade() -> None:
    op.execute("create extension if not exists pgcrypto")
    op.create_table(
        "departments",
        uuid_pk(),
        sa.Column("public_id", sa.Text(), nullable=False, unique=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("parent_department_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("departments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("parent_department_public_id", sa.Text(), nullable=True),
        sa.Column("created_at", timestamp(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", timestamp(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_departments_parent_department_id", "departments", ["parent_department_id"])

    op.add_column("employees", sa.Column("department_id", postgresql.UUID(as_uuid=False), nullable=True))
    op.add_column("employees", sa.Column("department_public_id", sa.Text(), nullable=True))
    op.create_index("ix_employees_department_id", "employees", ["department_id"])
    op.create_foreign_key(
        "fk_employees_department_id_departments",
        "employees",
        "departments",
        ["department_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_employees_department_id_departments", "employees", type_="foreignkey")
    op.drop_index("ix_employees_department_id", table_name="employees")
    op.drop_column("employees", "department_public_id")
    op.drop_column("employees", "department_id")

    op.drop_index("ix_departments_parent_department_id", table_name="departments")
    op.drop_table("departments")
