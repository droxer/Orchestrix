from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any


MIGRATION_PATH = (
    Path(__file__).parents[2]
    / "migrations"
    / "versions"
    / "20260722_0032_add_teams.py"
)


class RecordingOp:
    def __init__(self) -> None:
        self.tables: dict[str, tuple[Any, ...]] = {}
        self.columns: list[tuple[str, str]] = []
        self.indexes: list[tuple[str, str, list[str]]] = []
        self.dropped_columns: list[tuple[str, str]] = []
        self.dropped_tables: list[str] = []

    def create_table(self, name: str, *columns: Any) -> None:
        self.tables[name] = columns

    def create_index(self, name: str, table: str, columns: list[str]) -> None:
        self.indexes.append((name, table, columns))

    def add_column(self, table: str, column: Any) -> None:
        self.columns.append((table, column.name))

    def drop_index(self, name: str, *, table_name: str | None = None) -> None:
        pass

    def drop_column(self, table: str, column: str) -> None:
        self.dropped_columns.append((table, column))

    def drop_table(self, name: str) -> None:
        self.dropped_tables.append(name)


def load_migration() -> Any:
    spec = importlib.util.spec_from_file_location("team_migration", MIGRATION_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_team_migration_creates_team_store_and_task_assignment(monkeypatch: Any) -> None:
    migration = load_migration()
    recorder = RecordingOp()
    monkeypatch.setattr(migration, "op", recorder)

    migration.upgrade()

    assert {column.name for column in recorder.tables["teams"]} >= {
        "public_id",
        "owner_employee_public_id",
        "name_key",
        "lead_agent_id",
        "member_agent_ids",
        "snapshot",
    }
    assert "team_events" in recorder.tables
    assert ("tasks", "assigned_team_id") in recorder.columns
    assert (
        "ix_tasks_assigned_team_id",
        "tasks",
        ["assigned_team_id"],
    ) in recorder.indexes

    migration.downgrade()

    assert ("tasks", "assigned_team_id") in recorder.dropped_columns
    assert recorder.dropped_tables == ["team_events", "teams"]
