from __future__ import annotations

from pathlib import Path

import pytest

from relay.persistence.session_store import LocalSessionStore
from relay.persistence.stores import relay_event
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
