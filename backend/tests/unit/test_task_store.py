from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from tempfile import TemporaryDirectory

from relay.persistence.store_common import relay_task_event
from relay.persistence.stores import DatabaseTaskStore, LocalTaskStore


def test_task_store_persists_assignment_status_activity_and_link() -> None:
    with TemporaryDirectory() as root:
        store = LocalTaskStore(root)
        task = store.create_task(
            {
                "title": "Add Kanban board",
                "description": "Show backlog.",
                "priority": "high",
                "assigneeEmployeeId": "alice",
                "dueDate": "2026-06-30",
                "isRoutine": True,
                "routineType": "job",
                "routineCadence": "weekly",
                "routineNextRunDate": "2026-06-25",
                "routineEnabled": True,
            }
        )
        task = store.assign_task(task["id"], "codex", "agent_builder")
        task = store.update_task(
            task["id"], {"routineNextRunDate": "2026-07-02", "routineEnabled": False}
        )
        task = store.link_session(task["id"], "ses_test")
        task = store.update_task(task["id"], {"status": "running"})

        assert task["assigneeEmployeeId"] == "alice"
        assert task["dueDate"] == "2026-06-30"
        assert task["isRoutine"] is True
        assert task["routineType"] == "job"
        assert task["routineCadence"] == "weekly"
        assert task["routineNextRunDate"] == "2026-07-02"
        assert task["routineEnabled"] is False
        assert task["assignedAgent"] == "codex"
        assert task["assignedAgentId"] == "agent_builder"
        assert task["linkedSessionIds"] == ["ses_test"]
        assert task["status"] == "running"
        assert any("Assigned to codex" in item["message"] for item in task["activity"])


def test_local_task_store_serializes_concurrent_appends() -> None:
    with TemporaryDirectory() as root:
        store = LocalTaskStore(root)
        task = store.create_task(
            {"title": "Collect activity", "description": "", "priority": "normal"}
        )
        assert task["isRoutine"] is False
        assert task["routineEnabled"] is False

        def append(index: int) -> None:
            store.append_event(
                task["id"],
                relay_task_event(
                    "task.activity",
                    task["id"],
                    {
                        "activity": {
                            "id": f"act_{index}",
                            "createdAt": "2026-06-05T00:00:00.000Z",
                            "message": f"Activity {index}",
                        }
                    },
                ),
            )

        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(append, range(25)))

        updated = store.get_task(task["id"])
        assert len(updated["activity"]) == 25
        assert {activity["id"] for activity in updated["activity"]} == {
            f"act_{index}" for index in range(25)
        }


def test_database_task_store_persists_assignment_status_activity_and_link() -> None:
    with TemporaryDirectory() as root:
        store = DatabaseTaskStore(f"sqlite:///{root}/relay.db", create_schema=True)
        task = store.create_task(
            {
                "title": "Add Kanban board",
                "description": "Show backlog.",
                "priority": "high",
                "assigneeEmployeeId": "alice",
                "dueDate": "2026-06-30",
                "isRoutine": True,
                "routineType": "job",
                "routineCadence": "monthly",
                "routineNextRunDate": "2026-06-25",
                "routineEnabled": True,
            }
        )
        task = store.assign_task(task["id"], "codex", "agent_builder")
        task = store.update_task(
            task["id"], {"routineNextRunDate": "2026-07-25", "routineEnabled": False}
        )
        task = store.link_session(task["id"], "ses_test")
        task = store.update_task(task["id"], {"status": "running"})

        assert task["assigneeEmployeeId"] == "alice"
        assert task["dueDate"] == "2026-06-30"
        assert task["isRoutine"] is True
        assert task["routineType"] == "job"
        assert task["routineCadence"] == "monthly"
        assert task["routineNextRunDate"] == "2026-07-25"
        assert task["routineEnabled"] is False
        assert task["assignedAgent"] == "codex"
        assert task["assignedAgentId"] == "agent_builder"
        assert task["linkedSessionIds"] == ["ses_test"]
        assert task["status"] == "running"
        assert store.list_tasks()[0]["id"] == task["id"]
        assert any("Assigned to codex" in item["message"] for item in task["activity"])


def test_task_claim_orders_by_priority_due_date_and_assignee() -> None:
    with TemporaryDirectory() as root:
        store = LocalTaskStore(root)
        later = store.create_task(
            {
                "title": "Later",
                "priority": "high",
                "assigneeEmployeeId": "alice",
                "dueDate": "2026-07-10",
            }
        )
        earlier = store.create_task(
            {
                "title": "Earlier",
                "priority": "high",
                "assigneeEmployeeId": "alice",
                "dueDate": "2026-06-25",
            }
        )
        wrong_assignee = store.create_task(
            {
                "title": "Bob",
                "priority": "high",
                "assigneeEmployeeId": "bob",
                "dueDate": "2026-06-01",
            }
        )
        for task in (later, earlier, wrong_assignee):
            store.assign_task(task["id"], "codex")

        claimed = store.claim_next_task_for_agent("codex", "alice")

        assert claimed is not None
        assert claimed["id"] == earlier["id"]
        assert claimed["status"] == "running"
        assert store.get_task(wrong_assignee["id"])["status"] == "assigned"


def test_task_store_claims_exact_task_for_dispatch() -> None:
    with TemporaryDirectory() as root:
        store = LocalTaskStore(root)
        routine = store.create_task(
            {
                "title": "Routine",
                "isRoutine": True,
                "routineEnabled": True,
                "assignedAgent": "codex",
                "status": "assigned",
            }
        )
        task = store.create_task(
            {"title": "Dispatch me", "assignedAgent": "codex", "status": "assigned"}
        )

        assert store.claim_task_for_dispatch(routine["id"], "codex") is None
        claimed = store.claim_task_for_dispatch(task["id"], "codex")
        second_claim = store.claim_task_for_dispatch(task["id"], "codex")

        assert claimed is not None
        assert claimed["status"] == "running"
        assert second_claim is None


def test_task_store_promotes_due_routine_once() -> None:
    with TemporaryDirectory() as root:
        store = LocalTaskStore(root)
        routine = store.create_task(
            {
                "title": "Routine",
                "description": "Run it.",
                "priority": "high",
                "isRoutine": True,
                "routineEnabled": True,
                "routineCadence": "weekly",
                "routineNextRunDate": "2026-06-25",
                "assignedAgent": "codex",
                "ownerEmployeeId": "alice",
                "assigneeEmployeeId": "alice",
            }
        )

        first = store.promote_due_routine(routine["id"], "2026-06-25", "2026-07-02")
        second = store.promote_due_routine(routine["id"], "2026-06-25", "2026-07-09")

        assert first is not None
        assert first["status"] == "assigned"
        assert first["isRoutine"] is False
        assert first["assignedAgent"] == "codex"
        assert first["dueDate"] == "2026-06-25"
        assert second is None
        updated = store.get_task(routine["id"])
        assert updated["routineNextRunDate"] == "2026-07-02"
        assert (
            len([task for task in store.list_tasks() if task["id"] != routine["id"]])
            == 1
        )


def test_database_task_claim_orders_by_priority_due_date_and_assignee() -> None:
    with TemporaryDirectory() as root:
        store = DatabaseTaskStore(f"sqlite:///{root}/relay.db", create_schema=True)
        later = store.create_task(
            {
                "title": "Later",
                "priority": "high",
                "assigneeEmployeeId": "alice",
                "dueDate": "2026-07-10",
            }
        )
        earlier = store.create_task(
            {
                "title": "Earlier",
                "priority": "high",
                "assigneeEmployeeId": "alice",
                "dueDate": "2026-06-25",
            }
        )
        wrong_assignee = store.create_task(
            {
                "title": "Bob",
                "priority": "high",
                "assigneeEmployeeId": "bob",
                "dueDate": "2026-06-01",
            }
        )
        for task in (later, earlier, wrong_assignee):
            store.assign_task(task["id"], "codex")

        claimed = store.claim_next_task_for_agent("codex", "alice")

        assert claimed is not None
        assert claimed["id"] == earlier["id"]
        assert claimed["status"] == "running"
        assert store.get_task(wrong_assignee["id"])["status"] == "assigned"


def test_database_task_store_claims_exact_task_for_dispatch() -> None:
    with TemporaryDirectory() as root:
        store = DatabaseTaskStore(f"sqlite:///{root}/relay.db", create_schema=True)
        routine = store.create_task(
            {
                "title": "Routine",
                "isRoutine": True,
                "routineEnabled": True,
                "assignedAgent": "codex",
                "status": "assigned",
            }
        )
        task = store.create_task(
            {"title": "Dispatch me", "assignedAgent": "codex", "status": "assigned"}
        )

        assert store.claim_task_for_dispatch(routine["id"], "codex") is None
        claimed = store.claim_task_for_dispatch(task["id"], "codex")
        second_claim = store.claim_task_for_dispatch(task["id"], "codex")

        assert claimed is not None
        assert claimed["status"] == "running"
        assert second_claim is None


def assert_store_lists_scheduler_queues(
    store: LocalTaskStore | DatabaseTaskStore,
) -> None:
    low = store.create_task(
        {
            "title": "Low priority",
            "priority": "low",
            "assignedAgent": "codex",
            "status": "assigned",
            "dueDate": "2026-05-01",
        }
    )
    high = store.create_task(
        {
            "title": "High priority",
            "priority": "high",
            "assignedAgent": "codex",
            "status": "assigned",
            "dueDate": "2026-07-10",
        }
    )
    normal = store.create_task(
        {
            "title": "Normal priority",
            "priority": "normal",
            "assignedAgent": "codex",
            "status": "assigned",
            "dueDate": "2026-06-01",
        }
    )
    store.create_task({"title": "Unassigned", "status": "assigned"})
    store.create_task({"title": "Backlog", "assignedAgent": "codex"})
    store.create_task({"title": "Done", "assignedAgent": "codex", "status": "done"})
    store.create_task(
        {
            "title": "Routine occurrence source",
            "assignedAgent": "codex",
            "status": "assigned",
            "isRoutine": True,
            "routineEnabled": True,
        }
    )

    due_routine = store.create_task(
        {
            "title": "Due routine",
            "isRoutine": True,
            "routineEnabled": True,
            "routineCadence": "weekly",
            "routineNextRunDate": "2026-06-25",
            "assignedAgent": "codex",
        }
    )
    store.create_task(
        {
            "title": "Future routine",
            "isRoutine": True,
            "routineEnabled": True,
            "routineCadence": "weekly",
            "routineNextRunDate": "2026-07-25",
            "assignedAgent": "codex",
        }
    )
    if isinstance(store, LocalTaskStore):
        store.create_task(
            {
                "title": "Invalid routine",
                "isRoutine": True,
                "routineEnabled": True,
                "routineCadence": "weekly",
                "routineNextRunDate": "not-a-date",
                "assignedAgent": "codex",
            }
        )

    assert [task["id"] for task in store.list_dispatchable_tasks()] == [
        high["id"],
        normal["id"],
        low["id"],
    ]
    assert [task["id"] for task in store.list_dispatchable_tasks(limit=2)] == [
        high["id"],
        normal["id"],
    ]
    assert [task["id"] for task in store.list_due_routines("2026-06-25")] == [
        due_routine["id"]
    ]


def test_local_task_store_lists_scheduler_queues() -> None:
    with TemporaryDirectory() as root:
        assert_store_lists_scheduler_queues(LocalTaskStore(root))


def test_database_task_store_lists_scheduler_queues() -> None:
    with TemporaryDirectory() as root:
        assert_store_lists_scheduler_queues(
            DatabaseTaskStore(f"sqlite:///{root}/relay.db", create_schema=True)
        )


def test_database_task_store_promotes_due_routine_once() -> None:
    with TemporaryDirectory() as root:
        store = DatabaseTaskStore(f"sqlite:///{root}/relay.db", create_schema=True)
        routine = store.create_task(
            {
                "title": "Routine",
                "description": "Run it.",
                "priority": "high",
                "isRoutine": True,
                "routineEnabled": True,
                "routineCadence": "weekly",
                "routineNextRunDate": "2026-06-25",
                "assignedAgent": "codex",
                "ownerEmployeeId": "alice",
                "assigneeEmployeeId": "alice",
            }
        )

        first = store.promote_due_routine(routine["id"], "2026-06-25", "2026-07-02")
        second = store.promote_due_routine(routine["id"], "2026-06-25", "2026-07-09")

        assert first is not None
        assert first["status"] == "assigned"
        assert first["isRoutine"] is False
        assert first["assignedAgent"] == "codex"
        assert first["dueDate"] == "2026-06-25"
        assert second is None
        updated = store.get_task(routine["id"])
        assert updated["routineNextRunDate"] == "2026-07-02"
        assert (
            len([task for task in store.list_tasks() if task["id"] != routine["id"]])
            == 1
        )
