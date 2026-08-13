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
