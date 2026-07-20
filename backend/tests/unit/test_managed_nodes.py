from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import pytest
import relay.services.managed_nodes as managed_nodes_module

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
    second = store.create_node({"employeeId": "alice", "profile": "large"})

    assert first["id"] != second["id"]


def test_employee_cannot_have_two_running_nodes_in_the_same_policy_slot(
    tmp_path: Path,
) -> None:
    store = LocalManagedNodeStore(tmp_path)
    store.create_node({"employeeId": "alice"})

    with pytest.raises(ValueError, match="active managed node"):
        store.create_node({"employeeId": "alice"})


def test_stopped_node_cannot_restart_into_an_occupied_policy_slot(
    tmp_path: Path,
) -> None:
    store = LocalManagedNodeStore(tmp_path)
    stopped = store.create_node({"employeeId": "alice"})
    store.update_node(stopped["id"], {"desiredState": "stopped"})
    store.create_node({"employeeId": "alice"})

    with pytest.raises(ValueError, match="active managed node"):
        store.update_node(stopped["id"], {"desiredState": "running"})


def test_rejected_policy_slot_update_preserves_active_attempt(tmp_path: Path) -> None:
    store = LocalManagedNodeStore(tmp_path)
    store.create_node({"employeeId": "alice"})
    large = store.create_node({"employeeId": "alice", "profile": "large"})
    attempt, _credential = store.create_attempt(large["id"])

    with pytest.raises(ValueError, match="active managed node"):
        store.update_node(large["id"], {"profile": "standard"})

    preserved = next(
        item
        for item in store.list_attempts(large["id"])
        if item["id"] == attempt["id"]
    )
    assert preserved["status"] == "pending"
    assert store.get_node(large["id"])["activeAttemptId"] == attempt["id"]


def test_policy_slot_uniqueness_is_enforced_across_store_instances(
    tmp_path: Path,
) -> None:
    stores = (LocalManagedNodeStore(tmp_path), LocalManagedNodeStore(tmp_path))
    barrier = Barrier(2)

    def create(store: LocalManagedNodeStore) -> str:
        barrier.wait()
        return store.create_node({"employeeId": "alice"})["id"]

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = [executor.submit(create, store) for store in stores]

    successes = [future.result() for future in results if future.exception() is None]
    failures = [future.exception() for future in results if future.exception() is not None]
    assert len(successes) == 1
    assert len(failures) == 1
    assert isinstance(failures[0], ValueError)


def test_managed_capacity_ensure_is_idempotent_across_store_instances(
    tmp_path: Path,
) -> None:
    stores = (LocalManagedNodeStore(tmp_path), LocalManagedNodeStore(tmp_path))
    barrier = Barrier(2)

    def ensure(store: LocalManagedNodeStore) -> tuple[str, bool]:
        barrier.wait()
        resolution = store.ensure_node_for_employee("alice")
        return resolution.node["id"], resolution.provisioning_requested

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(ensure, stores))

    assert len({node_id for node_id, _requested in results}) == 1
    assert sorted(requested for _node_id, requested in results) == [False, True]


def test_managed_nodes_require_boxlite(tmp_path: Path) -> None:
    store = LocalManagedNodeStore(tmp_path)

    with pytest.raises(ValueError, match="require sandboxMode boxlite"):
        store.create_node({"employeeId": "alice", "sandboxMode": "none"})


def test_managed_capacity_restart_is_reported_as_requested(tmp_path: Path) -> None:
    store = LocalManagedNodeStore(tmp_path)
    node = store.create_node({"employeeId": "alice"})
    stopped = store.update_node(node["id"], {"desiredState": "stopped"})

    resolution = store.ensure_node_for_employee("alice")

    assert resolution.provisioning_requested is True
    restarted = resolution.node
    assert restarted["id"] == node["id"]
    assert restarted["desiredState"] == "running"
    assert restarted["phase"] == "requested"
    assert restarted["generation"] == stopped["generation"] + 1


def test_restart_cancels_an_attempt_from_the_previous_generation(
    tmp_path: Path,
) -> None:
    store = LocalManagedNodeStore(tmp_path)
    node = store.create_node({"employeeId": "alice"})
    old_attempt, _credential = store.create_attempt(node["id"])

    store.update_node(node["id"], {"desiredState": "stopped"})
    restarted = store.ensure_node_for_employee("alice").node
    new_attempt, _credential = store.create_attempt(restarted["id"])

    cancelled_attempt = next(
        attempt
        for attempt in store.list_attempts(node["id"])
        if attempt["id"] == old_attempt["id"]
    )
    assert cancelled_attempt["status"] == "cancelled"
    with pytest.raises(ValueError, match="already terminal"):
        store.update_attempt(old_attempt["id"], {"status": "allocating"})
    assert new_attempt["generation"] == restarted["generation"]


def test_running_managed_capacity_is_not_requested_twice(tmp_path: Path) -> None:
    store = LocalManagedNodeStore(tmp_path)
    node = store.create_node({"employeeId": "alice"})

    resolution = store.ensure_node_for_employee("alice")

    assert resolution.provisioning_requested is False
    existing = resolution.node
    assert existing["id"] == node["id"]


def test_running_managed_capacity_is_preferred_over_an_older_stopped_node(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    timestamps = iter(
        [
            "2026-07-19T00:00:00Z",
            "2026-07-19T00:00:01Z",
            "2026-07-19T00:00:02Z",
            "2026-07-19T00:00:03Z",
        ]
    )
    monkeypatch.setattr(managed_nodes_module, "now_iso", lambda: next(timestamps))
    store = LocalManagedNodeStore(tmp_path)
    stopped = store.create_node({"employeeId": "alice"})
    store.update_node(stopped["id"], {"desiredState": "stopped"})
    running = store.create_node({"employeeId": "alice"})

    resolution = store.ensure_node_for_employee("alice")

    assert resolution.provisioning_requested is False
    existing = resolution.node
    assert existing["id"] == running["id"]
    assert store.get_node(stopped["id"])["desiredState"] == "stopped"


def test_managed_capacity_resolution_matches_the_requested_policy_slot(
    tmp_path: Path,
) -> None:
    store = LocalManagedNodeStore(tmp_path)
    default = store.create_node({"employeeId": "alice"})
    store.update_node(default["id"], {"desiredState": "stopped"})
    large = store.create_node({"employeeId": "alice", "profile": "large"})

    resolution = store.ensure_node_for_employee(
        "alice", policy={"profile": "standard"}
    )

    assert resolution.node["id"] == default["id"]
    assert resolution.node["desiredState"] == "running"
    assert store.get_node(large["id"])["desiredState"] == "running"


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
