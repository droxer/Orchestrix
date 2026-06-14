"""add employees table

Revision ID: 20260613_0004
Revises: 20260613_0003
Create Date: 2026-06-13 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260613_0004"
down_revision = "20260613_0003"
branch_labels = None
depends_on = None


def timestamp() -> sa.DateTime:
    return sa.DateTime(timezone=True)


def uuid_pk() -> sa.Column:
    return sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True, server_default=sa.text("gen_random_uuid()"))


def upgrade() -> None:
    op.execute("create extension if not exists pgcrypto")
    op.create_table(
        "employees",
        uuid_pk(),
        sa.Column("public_id", sa.Text(), nullable=False, unique=True),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("created_at", timestamp(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", timestamp(), nullable=False, server_default=sa.func.now()),
    )

    op.execute("update auth_users set employee_public_id = username where employee_public_id is null")
    op.execute(
        """
        insert into employees (public_id, display_name, email, created_at, updated_at)
        select distinct employee_public_id, username, email, now(), now()
        from auth_users
        where employee_public_id is not null
        on conflict (public_id) do nothing
        """
    )
    op.execute(
        """
        insert into employees (public_id, display_name, email, created_at, updated_at)
        select distinct employee_id, employee_id, null, now(), now()
        from daemon_nodes
        where employee_id is not null
        on conflict (public_id) do nothing
        """
    )
    op.execute(
        """
        update auth_users
        set employee_id = employees.id
        from employees
        where auth_users.employee_public_id = employees.public_id
        """
    )
    op.create_foreign_key(
        "fk_auth_users_employee_id_employees",
        "auth_users",
        "employees",
        ["employee_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_auth_users_employee_id_employees", "auth_users", type_="foreignkey")
    op.drop_table("employees")
