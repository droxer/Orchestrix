from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text

MIGRATION_PATH = (
    Path(__file__).parents[2]
    / "migrations"
    / "versions"
    / "20260730_0053_prune_heartbeat_daemon_events.py"
)


def load_migration():
    spec = importlib.util.spec_from_file_location("prune_heartbeat_events", MIGRATION_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_database():
    engine = create_engine("sqlite:///:memory:")
    connection = engine.connect()
    connection.execute(
        text(
            "CREATE TABLE daemon_events ("
            "id TEXT PRIMARY KEY, node_id TEXT, type TEXT NOT NULL, "
            "timestamp TEXT NOT NULL, payload TEXT NOT NULL)"
        )
    )
    return engine, connection


def add_event(connection, event_id, event_type, timestamp, node=None, node_id=None):
    connection.execute(
        text(
            "INSERT INTO daemon_events (id, node_id, type, timestamp, payload) "
            "VALUES (:id, :node_id, :type, :timestamp, :payload)"
        ),
        {
            "id": event_id,
            # Production never populates this column for registration events.
            "node_id": node_id,
            "type": event_type,
            "timestamp": timestamp,
            "payload": json.dumps({"node": node} if node else {}),
        },
    )


def registered(node_id, *, status="ready", last_seen="2026-07-30T00:00:00.000Z"):
    return {
        "id": node_id,
        "status": status,
        "agents": {"claude": "ready"},
        "updatedAt": last_seen,
        "lastSeenAt": last_seen,
    }


def run_upgrade(connection):
    module = load_migration()
    module.op = Operations(MigrationContext.configure(connection))
    module.upgrade()


def remaining(connection, event_type="daemon.node.registered"):
    return [
        row[0]
        for row in connection.execute(
            text(
                "SELECT id FROM daemon_events WHERE type = :type ORDER BY timestamp, id"
            ),
            {"type": event_type},
        ).all()
    ]


def test_dead_seen_events_are_removed() -> None:
    engine, connection = build_database()
    try:
        for index in range(4):
            add_event(
                connection, f"s{index}", "daemon.node.seen", f"2026-07-30T00:0{index}:00Z"
            )
        run_upgrade(connection)

        assert remaining(connection, "daemon.node.seen") == []
    finally:
        connection.close()
        engine.dispose()


def test_identical_registrations_collapse_to_first_and_last() -> None:
    engine, connection = build_database()
    try:
        for index in range(5):
            add_event(
                connection,
                f"r{index}",
                "daemon.node.registered",
                f"2026-07-30T00:0{index}:00Z",
                node=registered("node_a", last_seen=f"2026-07-30T00:0{index}:00.000Z"),
            )
        run_upgrade(connection)

        # The first is the incarnation record, the last is current state.
        assert remaining(connection) == ["r0", "r4"]
    finally:
        connection.close()
        engine.dispose()


def test_a_real_state_change_is_never_collapsed() -> None:
    engine, connection = build_database()
    try:
        add_event(
            connection, "r0", "daemon.node.registered", "2026-07-30T00:00:00Z",
            node=registered("node_a"),
        )
        add_event(
            connection, "r1", "daemon.node.registered", "2026-07-30T00:01:00Z",
            node=registered("node_a", status="stopped"),
        )
        add_event(
            connection, "r2", "daemon.node.registered", "2026-07-30T00:02:00Z",
            node=registered("node_a", status="stopped"),
        )
        run_upgrade(connection)

        assert remaining(connection) == ["r0", "r1", "r2"]
    finally:
        connection.close()
        engine.dispose()


def test_interleaved_nodes_are_grouped_by_payload_not_the_null_column() -> None:
    """`daemon_event` leaves node_id NULL, so grouping on the column puts every
    node in one bucket and interleaving hides each node's duplicates."""
    engine, connection = build_database()
    try:
        stamp = 0
        for _ in range(3):
            for node in ("node_a", "node_b"):
                add_event(
                    connection,
                    f"{node}_{stamp}",
                    "daemon.node.registered",
                    f"2026-07-30T00:{stamp:02d}:00Z",
                    node=registered(node, last_seen=f"2026-07-30T00:{stamp:02d}:00.000Z"),
                )
                stamp += 1
        run_upgrade(connection)

        kept = remaining(connection)
        # Two per node: its first and its last. Nothing survives just because a
        # different node's event sat between two of its own.
        assert len(kept) == 4
        assert {name.rsplit("_", 1)[0] for name in kept} == {"node_a", "node_b"}
    finally:
        connection.close()
        engine.dispose()


def test_managed_node_linkage_survives(monkeypatch) -> None:
    """Deduplication must not drop the mapping historical_managed_runtime_ids
    rebuilds from these events."""
    engine, connection = build_database()
    try:
        for index in range(6):
            node = registered("runtime_a", last_seen=f"2026-07-30T00:0{index}:00.000Z")
            node["managedNodeId"] = "computer_a"
            add_event(
                connection,
                f"r{index}",
                "daemon.node.registered",
                f"2026-07-30T00:0{index}:00Z",
                node=node,
            )
        run_upgrade(connection)

        rows = connection.execute(
            text("SELECT payload FROM daemon_events WHERE type='daemon.node.registered'")
        ).all()
        linkage = {
            json.loads(row[0])["node"]["id"]: json.loads(row[0])["node"]["managedNodeId"]
            for row in rows
        }
        assert linkage == {"runtime_a": "computer_a"}
    finally:
        connection.close()
        engine.dispose()
