from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any


MIGRATION_PATH = (
    Path(__file__).parents[2]
    / "migrations"
    / "versions"
    / "20260712_0029_rename_agent_placement_supervisor.py"
)


def load_migration() -> Any:
    spec = importlib.util.spec_from_file_location(
        "agent_placement_supervisor_migration", MIGRATION_PATH
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_agent_placement_supervisor_migration_is_reversible(monkeypatch: Any) -> None:
    migration = load_migration()
    calls: list[tuple[str, str, str]] = []

    class RecordingOp:
        def alter_column(
            self, table: str, column: str, *, new_column_name: str
        ) -> None:
            calls.append((table, column, new_column_name))

    monkeypatch.setattr(migration, "op", RecordingOp())

    migration.upgrade()
    migration.downgrade()

    assert calls == [
        (
            "agent_placements",
            "employee_public_id",
            "supervisor_employee_public_id",
        ),
        (
            "agent_placements",
            "supervisor_employee_public_id",
            "employee_public_id",
        ),
    ]
