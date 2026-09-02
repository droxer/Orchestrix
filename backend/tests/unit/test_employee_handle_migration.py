from __future__ import annotations

import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text
from sqlalchemy.dialects import postgresql

MIGRATION_PATH = (
    Path(__file__).parents[2]
    / "migrations"
    / "versions"
    / "20260831_0065_add_employee_handle.py"
)


def load_migration():
    spec = importlib.util.spec_from_file_location("employee_handle_migration", MIGRATION_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_employee_handle_backfill_compares_employee_ids_as_uuids() -> None:
    """The live table has UUID ids, so PostgreSQL must not bind them as text."""
    migration = load_migration()
    employees = migration._employees_table()

    statement = (
        employees.update()
        .where(employees.c.id == "5dadd571-0557-4288-8378-90af89b20c6e")
        .values(handle="admin")
    )

    assert "::UUID" in str(statement.compile(dialect=postgresql.dialect()))


def test_backfill_prefers_the_username_then_the_display_name_then_the_id() -> None:
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE employees (
                    id TEXT PRIMARY KEY,
                    display_name TEXT NOT NULL,
                    created_at TIMESTAMP NOT NULL
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE auth_users (
                    username TEXT NOT NULL,
                    employee_id TEXT
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO employees VALUES
                    ('11111111-1111-1111-1111-111111111111', 'Alice Chen', '2026-01-01'),
                    ('22222222-2222-2222-2222-222222222222', 'Bob Stone', '2026-01-02'),
                    ('33333333-3333-3333-3333-333333333333', '///', '2026-01-03'),
                    ('44444444-4444-4444-4444-444444444444', 'Alice Chen', '2026-01-04'),
                    ('55555555-5555-5555-5555-555555555555', 'Bob Stone', '2026-01-05')
                """
            )
        )
        connection.execute(
            text(
                "INSERT INTO auth_users VALUES "
                "('alice', '11111111-1111-1111-1111-111111111111')"
            )
        )

        migration = load_migration()
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        handles = {
            str(row["id"])[:8]: row["handle"]
            for row in connection.execute(
                text("SELECT id, handle FROM employees")
            ).mappings()
        }
        # The linked login wins.
        assert handles["11111111"] == "alice"
        # No login, so the display name is slugified.
        assert handles["22222222"] == "bob-stone"
        # Nothing usable in either, so the id prefix stands in — never blank.
        assert handles["33333333"] == "33333333"
        # The first Alice took her username, so the slug of her display name
        # was never claimed and this row gets it outright.
        assert handles["44444444"] == "alice-chen"
        # A real duplicate is suffixed rather than dropped; the older row keeps
        # the plain handle.
        assert handles["55555555"] == "bob-stone-2"


def test_backfill_leaves_a_unique_index_behind() -> None:
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE employees (id TEXT PRIMARY KEY, "
                "display_name TEXT NOT NULL, created_at TIMESTAMP NOT NULL)"
            )
        )
        connection.execute(
            text("CREATE TABLE auth_users (username TEXT NOT NULL, employee_id TEXT)")
        )
        connection.execute(
            text("INSERT INTO employees VALUES ('id-1', 'Alice', '2026-01-01')")
        )
        migration = load_migration()
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        indexes = [
            row["name"]
            for row in connection.execute(
                text("PRAGMA index_list('employees')")
            ).mappings()
        ]
        assert "uq_employees_handle" in indexes
