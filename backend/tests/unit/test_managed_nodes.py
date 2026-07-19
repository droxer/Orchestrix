from __future__ import annotations

from pathlib import Path

import pytest

from relay.services.managed_nodes import LocalManagedNodeStore


def test_managed_node_attempt_uses_single_use_enrollment_grant(tmp_path: Path) -> None:
    store = LocalManagedNodeStore(tmp_path)
    node = store.create_node({"employeeId": "alice", "provider": "local-process"})
    attempt, credential = store.create_attempt(node["id"])

    enrolled_node, enrolled_attempt = store.consume_enrollment_grant(credential)

    assert enrolled_node["id"] == node["id"]
    assert enrolled_attempt["id"] == attempt["id"]
    with pytest.raises(PermissionError, match="already been consumed"):
        store.consume_enrollment_grant(credential)


def test_provider_change_increments_generation_and_invalidates_old_grant(tmp_path: Path) -> None:
    store = LocalManagedNodeStore(tmp_path)
    node = store.create_node({"employeeId": "alice", "provider": "local-process"})
    _attempt, credential = store.create_attempt(node["id"])

    updated = store.update_node(node["id"], {"profile": "large"})

    assert updated["generation"] == 2
    with pytest.raises(PermissionError, match="no longer accepts"):
        store.consume_enrollment_grant(credential)


def test_employee_can_have_multiple_dedicated_managed_nodes(tmp_path: Path) -> None:
    store = LocalManagedNodeStore(tmp_path)
    first = store.create_node({"employeeId": "alice"})
    second = store.create_node({"employeeId": "alice"})

    assert first["id"] != second["id"]


def test_managed_nodes_require_boxlite(tmp_path: Path) -> None:
    store = LocalManagedNodeStore(tmp_path)

    with pytest.raises(ValueError, match="require sandboxMode boxlite"):
        store.create_node({"employeeId": "alice", "sandboxMode": "none"})


def test_managed_capacity_restart_is_reported_as_requested(tmp_path: Path) -> None:
    store = LocalManagedNodeStore(tmp_path)
    node = store.create_node({"employeeId": "alice"})
    store.update_node(node["id"], {"desiredState": "stopped"})

    restarted, requested = store.ensure_node_for_employee("alice")

    assert requested is True
    assert restarted["id"] == node["id"]
    assert restarted["desiredState"] == "running"
    assert restarted["phase"] == "requested"


def test_running_managed_capacity_is_not_requested_twice(tmp_path: Path) -> None:
    store = LocalManagedNodeStore(tmp_path)
    node = store.create_node({"employeeId": "alice"})

    existing, requested = store.ensure_node_for_employee("alice")

    assert requested is False
    assert existing["id"] == node["id"]


def test_successful_enrollment_links_observed_daemon(tmp_path: Path) -> None:
    store = LocalManagedNodeStore(tmp_path)
    node = store.create_node({"employeeId": "alice"})
    attempt, credential = store.create_attempt(node["id"])
    store.consume_enrollment_grant(credential)

    updated, completed = store.complete_enrollment(node["id"], attempt["id"], "sbx_alice")

    assert completed["status"] == "succeeded"
    assert updated["activeDaemonNodeId"] == "sbx_alice"
    assert updated["phase"] == "registering"
    assert store.mark_ready("sbx_alice")["phase"] == "ready"
