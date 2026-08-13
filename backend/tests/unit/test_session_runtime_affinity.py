from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from relay.persistence.session_store import DatabaseSessionStore, LocalSessionStore
from relay.persistence.stores import relay_event
from relay.services.agent_routing import persist_legacy_session_computer_id
from relay.sessions.controller import SessionController


def _controller(tmp_path: Path) -> SessionController:
    return SessionController(LocalSessionStore(tmp_path))


def test_runtime_affinity_records_the_computer_identity(tmp_path: Path) -> None:
    controller = _controller(tmp_path)
    session = controller.create_session("Ship it")
    updated = controller.record_runtime_affinity(
        session["id"], "device:alice:machine-a"
    )
    assert updated["computerId"] == "device:alice:machine-a"


def test_runtime_affinity_is_write_once(tmp_path: Path) -> None:
    controller = _controller(tmp_path)
    session = controller.create_session("Ship it")
    controller.record_runtime_affinity(session["id"], "device:alice:machine-a")
    unchanged = controller.record_runtime_affinity(
        session["id"], "device:alice:machine-a"
    )
    assert unchanged["computerId"] == "device:alice:machine-a"
    with pytest.raises(ValueError):
        controller.record_runtime_affinity(session["id"], "managed:mnode-7")


def test_concurrent_runtime_affinity_backfill_appends_one_event(tmp_path: Path) -> None:
    controller = _controller(tmp_path)
    session = controller.create_session("Ship it")

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda _index: controller.record_runtime_affinity(
                    session["id"], "managed:mnode-7"
                ),
                range(2),
            )
        )

    assert {result["computerId"] for result in results} == {"managed:mnode-7"}
    stored = controller.store.get_session(session["id"])
    affinity_events = [
        event
        for event in stored["events"]
        if event["type"] == "session.runtime_affinity"
    ]
    assert len(affinity_events) == 1


def test_dispatch_backfill_persists_legacy_daemon_history_once(tmp_path: Path) -> None:
    store = LocalSessionStore(tmp_path)
    session_id = "legacy-dispatch-session"
    store.append_event(
        session_id,
        relay_event(
            "session.created",
            session_id,
            {
                "taskGoal": "Continue",
                "workspacePath": "/workspace",
                "daemonNodeId": "runtime-old",
            },
        ),
    )
    daemon_store = type(
        "DaemonHistory",
        (),
        {"historical_managed_node_id": lambda self, _node_id: "computer-a"},
    )()

    first = persist_legacy_session_computer_id(
        store.get_session(session_id),
        session_store=store,
        placement_store=type("Placements", (), {})(),
        nodes={},
        daemon_store=daemon_store,
    )
    second = persist_legacy_session_computer_id(
        store.get_session(session_id),
        session_store=store,
        placement_store=type("Placements", (), {})(),
        nodes={},
        daemon_store=daemon_store,
    )

    assert first["computerId"] == "managed:computer-a"
    assert second["computerId"] == "managed:computer-a"
    affinity_events = [
        event
        for event in store.get_session(session_id)["events"]
        if event["type"] == "session.runtime_affinity"
    ]
    assert len(affinity_events) == 1


def test_database_runtime_affinity_is_atomic_and_write_once(tmp_path: Path) -> None:
    store = DatabaseSessionStore(
        f"sqlite:///{tmp_path}/relay.db", create_schema=True
    )
    controller = SessionController(store)
    session = controller.create_session("Ship it")

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda _index: controller.record_runtime_affinity(
                    session["id"], "managed:mnode-7"
                ),
                range(2),
            )
        )
    assert {result["computerId"] for result in results} == {"managed:mnode-7"}
    with pytest.raises(ValueError):
        controller.record_runtime_affinity(session["id"], "managed:mnode-8")

    affinity_events = [
        event
        for event in store.get_session(session["id"])["events"]
        if event["type"] == "session.runtime_affinity"
    ]
    assert len(affinity_events) == 1


def test_legacy_affinity_event_replays_into_a_managed_computer_id(
    tmp_path: Path,
) -> None:
    """老事件只带 managedNodeId，replay 时必须派生出 computerId。"""
    store = LocalSessionStore(tmp_path)
    session = SessionController(store).create_session("Ship it")
    store.append_event(
        session["id"],
        relay_event(
            "session.runtime_affinity", session["id"], {"managedNodeId": "mnode-7"}
        ),
    )
    replayed = store.get_session(session["id"])
    assert replayed["computerId"] == "managed:mnode-7"
    assert replayed["managedNodeId"] == "mnode-7"


def test_create_session_materializes_computer_id_onto_the_snapshot(
    tmp_path: Path,
) -> None:
    """Critical 1 回归：session.created 事件里的 computerId 必须被
    materialize_events 拷贝进 snapshot，而不是只停留在事件 payload 里。"""
    store = LocalSessionStore(tmp_path)
    session = SessionController(store, computer_id="device:alice:machine-a").create_session(
        "Ship it"
    )
    assert session["computerId"] == "device:alice:machine-a"

    reloaded = store.get_session(session["id"])
    assert reloaded["computerId"] == "device:alice:machine-a"


def test_legacy_snapshot_without_computer_id_still_guards_against_a_conflicting_pin(
    tmp_path: Path,
) -> None:
    """Important 2 回归：存量 session 只带 managedNodeId、还没派生出
    computerId 时，写一次不可改的保护不能被打开 —— 否则会被无声钉到另一台
    managed Computer。"""
    store = LocalSessionStore(tmp_path)
    session_id = "legacy-session-1"
    store.append_event(
        session_id,
        relay_event(
            "session.created",
            session_id,
            {
                "workspacePath": "/workspace",
                "taskGoal": "Ship it",
                "daemonNodeId": "node-1",
                "managedNodeId": "mnode-A",
            },
        ),
    )
    snapshot = store.get_session(session_id)
    assert snapshot.get("computerId") is None
    assert snapshot["managedNodeId"] == "mnode-A"

    controller = SessionController(store)
    with pytest.raises(ValueError):
        controller.record_runtime_affinity(session_id, "managed:mnode-B")

    unchanged = controller.record_runtime_affinity(session_id, "managed:mnode-A")
    assert unchanged["computerId"] == "managed:mnode-A"
