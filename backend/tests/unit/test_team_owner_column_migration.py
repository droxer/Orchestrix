from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

import pytest


MIGRATION_PATH = (
    Path(__file__).parents[2]
    / "migrations"
    / "versions"
    / "20260724_0034_repair_team_owner_column.py"
)


class RecordingOp:
    def __init__(self) -> None:
        self.altered_columns: list[tuple[str, str, dict[str, Any]]] = []
        self.statements: list[str] = []

    def get_bind(self) -> object:
        return object()

    def alter_column(self, table_name: str, column_name: str, **kwargs: Any) -> None:
        self.altered_columns.append((table_name, column_name, kwargs))

    def execute(self, statement: str) -> None:
        self.statements.append(statement)


class SchemaInspector:
    def __init__(
        self,
        *,
        columns: set[str],
        unique_constraints: set[str] = frozenset(),
        indexes: set[str] = frozenset(),
    ) -> None:
        self.columns = columns
        self.unique_constraints = unique_constraints
        self.indexes = indexes

    def get_columns(self, table_name: str) -> list[dict[str, str]]:
        assert table_name == "teams"
        return [{"name": name} for name in self.columns]

    def get_unique_constraints(self, table_name: str) -> list[dict[str, str]]:
        assert table_name == "teams"
        return [{"name": name} for name in self.unique_constraints]

    def get_indexes(self, table_name: str) -> list[dict[str, str]]:
        assert table_name == "teams"
        return [{"name": name} for name in self.indexes]


def load_migration() -> Any:
    spec = importlib.util.spec_from_file_location(
        "team_owner_column_migration", MIGRATION_PATH
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_repairs_legacy_supervisor_schema(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration = load_migration()
    recorder = RecordingOp()
    inspector = SchemaInspector(
        columns={"supervisor_employee_public_id"},
        unique_constraints={"uq_teams_supervisor_name_key"},
        indexes={"ix_teams_supervisor_employee_public_id"},
    )
    monkeypatch.setattr(migration, "op", recorder)
    monkeypatch.setattr(migration.sa, "inspect", lambda bind: inspector)

    migration.upgrade()

    assert len(recorder.altered_columns) == 1
    table_name, column_name, kwargs = recorder.altered_columns[0]
    assert table_name == "teams"
    assert column_name == "supervisor_employee_public_id"
    assert kwargs["new_column_name"] == "owner_employee_public_id"
    assert isinstance(kwargs["existing_type"], migration.sa.Text)
    assert kwargs["existing_nullable"] is False
    assert recorder.statements == [
        "ALTER TABLE teams RENAME CONSTRAINT "
        "uq_teams_supervisor_name_key TO uq_teams_owner_name_key",
        "ALTER INDEX ix_teams_supervisor_employee_public_id "
        "RENAME TO ix_teams_owner_employee_public_id",
    ]


def test_upgrade_is_noop_for_canonical_schema(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration = load_migration()
    recorder = RecordingOp()
    inspector = SchemaInspector(columns={"owner_employee_public_id"})
    monkeypatch.setattr(migration, "op", recorder)
    monkeypatch.setattr(migration.sa, "inspect", lambda bind: inspector)

    migration.upgrade()

    assert recorder.altered_columns == []
    assert recorder.statements == []


def test_upgrade_rejects_unknown_team_ownership_schema(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration = load_migration()
    recorder = RecordingOp()
    inspector = SchemaInspector(columns={"public_id"})
    monkeypatch.setattr(migration, "op", recorder)
    monkeypatch.setattr(migration.sa, "inspect", lambda bind: inspector)

    with pytest.raises(
        RuntimeError,
        match="neither owner_employee_public_id nor "
        "supervisor_employee_public_id exists",
    ):
        migration.upgrade()
