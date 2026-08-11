from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

import pytest

MIGRATION_PATH = (
    Path(__file__).parents[2]
    / "migrations"
    / "versions"
    / "20260809_0059_remove_agent_task_modes.py"
)


class RecordingOp:
    def __init__(self) -> None:
        self.dropped_columns: list[tuple[str, str]] = []

    def drop_column(self, table_name: str, column_name: str) -> None:
        self.dropped_columns.append((table_name, column_name))


def load_migration() -> Any:
    spec = importlib.util.spec_from_file_location(
        "remove_agent_task_modes_migration", MIGRATION_PATH
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_drops_every_agent_task_mode_column(monkeypatch: Any) -> None:
    migration = load_migration()
    op = RecordingOp()
    monkeypatch.setattr(migration, "op", op)

    migration.upgrade()

    assert op.dropped_columns == [
        ("daemon_run_requests", "current_mode"),
        ("daemon_runs", "mode"),
        ("daemon_nodes", "run_capacity_by_mode"),
    ]


def test_downgrade_does_not_restore_the_removed_modes() -> None:
    migration = load_migration()

    with pytest.raises(RuntimeError, match="intentionally irreversible"):
        migration.downgrade()
