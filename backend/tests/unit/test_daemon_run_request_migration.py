from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any


MIGRATION_PATH = (
    Path(__file__).parents[2]
    / "migrations"
    / "versions"
    / "20260616_0008_add_daemon_run_requests.py"
)


class RecordingOp:
    def __init__(self) -> None:
        self.tables: dict[str, tuple[Any, ...]] = {}
        self.created_indexes: list[tuple[str, str, list[str]]] = []
        self.dropped_indexes: list[tuple[str, str | None]] = []
        self.dropped_tables: list[str] = []

    def create_table(self, name: str, *columns: Any) -> None:
        self.tables[name] = columns

    def create_index(self, name: str, table_name: str, columns: list[str]) -> None:
        self.created_indexes.append((name, table_name, columns))

    def drop_index(self, name: str, *, table_name: str | None = None) -> None:
        self.dropped_indexes.append((name, table_name))

    def drop_table(self, name: str) -> None:
        self.dropped_tables.append(name)


def load_migration() -> Any:
    spec = importlib.util.spec_from_file_location("daemon_run_requests_migration", MIGRATION_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_daemon_run_requests_migration_creates_store_table(monkeypatch: Any) -> None:
    migration = load_migration()
    op = RecordingOp()
    monkeypatch.setattr(migration, "op", op)

    migration.upgrade()

    columns = {column.name for column in op.tables["daemon_run_requests"]}
    assert columns == {
        "id",
        "public_id",
        "node_id",
        "node_public_id",
        "session_public_id",
        "task_goal",
        "assignments",
        "current_index",
        "state",
        "status",
        "current_command_public_id",
        "current_run_public_id",
        "current_agent",
        "current_mode",
        "current_started_at",
        "error",
        "created_at",
        "updated_at",
        "completed_at",
    }
    assert (
        "ix_daemon_run_requests_status",
        "daemon_run_requests",
        ["status"],
    ) in op.created_indexes
    assert (
        "ix_daemon_run_requests_node_status",
        "daemon_run_requests",
        ["node_id", "status"],
    ) in op.created_indexes
    assert (
        "ix_daemon_run_requests_session_public_id",
        "daemon_run_requests",
        ["session_public_id"],
    ) in op.created_indexes


def test_daemon_run_requests_migration_downgrade_drops_table(monkeypatch: Any) -> None:
    migration = load_migration()
    op = RecordingOp()
    monkeypatch.setattr(migration, "op", op)

    migration.downgrade()

    assert op.dropped_tables == ["daemon_run_requests"]
    assert op.dropped_indexes == [
        ("ix_daemon_run_requests_session_public_id", "daemon_run_requests"),
        ("ix_daemon_run_requests_node_status", "daemon_run_requests"),
        ("ix_daemon_run_requests_status", "daemon_run_requests"),
    ]
