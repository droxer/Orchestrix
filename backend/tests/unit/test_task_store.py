from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from tempfile import TemporaryDirectory

from relay.store_common import relay_task_event
from relay.stores import DatabaseTaskStore, LocalTaskStore


def test_task_store_persists_assignment_status_activity_and_link() -> None:
    with TemporaryDirectory() as root:
        store = LocalTaskStore(root)
        task = store.create_task({
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
        })
        task = store.assign_task(task["id"], "codex")
        task = store.update_task(task["id"], {"routineNextRunDate": "2026-07-02", "routineEnabled": False})
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
        assert task["linkedSessionIds"] == ["ses_test"]
        assert task["status"] == "running"
        assert any("Assigned to codex" in item["message"] for item in task["activity"])


def test_local_task_store_serializes_concurrent_appends() -> None:
    with TemporaryDirectory() as root:
        store = LocalTaskStore(root)
        task = store.create_task({"title": "Collect activity", "description": "", "priority": "normal"})
        assert task["isRoutine"] is False
        assert task["routineEnabled"] is False

        def append(index: int) -> None:
            store.append_event(task["id"], relay_task_event("task.activity", task["id"], {
                "activity": {
                    "id": f"act_{index}",
                    "createdAt": "2026-06-05T00:00:00.000Z",
                    "message": f"Activity {index}",
                }
            }))

        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(append, range(25)))

        updated = store.get_task(task["id"])
        assert len(updated["activity"]) == 25
        assert {activity["id"] for activity in updated["activity"]} == {f"act_{index}" for index in range(25)}


def test_database_task_store_persists_assignment_status_activity_and_link() -> None:
    with TemporaryDirectory() as root:
        store = DatabaseTaskStore(f"sqlite:///{root}/relay.db", create_schema=True)
        task = store.create_task({
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
        })
        task = store.assign_task(task["id"], "codex")
        task = store.update_task(task["id"], {"routineNextRunDate": "2026-07-25", "routineEnabled": False})
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
        assert task["linkedSessionIds"] == ["ses_test"]
        assert task["status"] == "running"
        assert store.list_tasks()[0]["id"] == task["id"]
        assert any("Assigned to codex" in item["message"] for item in task["activity"])


def test_task_claim_orders_by_priority_due_date_and_assignee() -> None:
    with TemporaryDirectory() as root:
        store = LocalTaskStore(root)
        later = store.create_task({"title": "Later", "priority": "high", "assigneeEmployeeId": "alice", "dueDate": "2026-07-10"})
        earlier = store.create_task({"title": "Earlier", "priority": "high", "assigneeEmployeeId": "alice", "dueDate": "2026-06-25"})
        wrong_assignee = store.create_task({"title": "Bob", "priority": "high", "assigneeEmployeeId": "bob", "dueDate": "2026-06-01"})
        for task in (later, earlier, wrong_assignee):
            store.assign_task(task["id"], "codex")

        claimed = store.claim_next_task_for_agent("codex", "alice")

        assert claimed is not None
        assert claimed["id"] == earlier["id"]
        assert claimed["status"] == "running"
        assert store.get_task(wrong_assignee["id"])["status"] == "assigned"


def test_database_task_claim_orders_by_priority_due_date_and_assignee() -> None:
    with TemporaryDirectory() as root:
        store = DatabaseTaskStore(f"sqlite:///{root}/relay.db", create_schema=True)
        later = store.create_task({"title": "Later", "priority": "high", "assigneeEmployeeId": "alice", "dueDate": "2026-07-10"})
        earlier = store.create_task({"title": "Earlier", "priority": "high", "assigneeEmployeeId": "alice", "dueDate": "2026-06-25"})
        wrong_assignee = store.create_task({"title": "Bob", "priority": "high", "assigneeEmployeeId": "bob", "dueDate": "2026-06-01"})
        for task in (later, earlier, wrong_assignee):
            store.assign_task(task["id"], "codex")

        claimed = store.claim_next_task_for_agent("codex", "alice")

        assert claimed is not None
        assert claimed["id"] == earlier["id"]
        assert claimed["status"] == "running"
        assert store.get_task(wrong_assignee["id"])["status"] == "assigned"
