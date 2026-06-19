from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from tempfile import TemporaryDirectory

from relay.store_common import relay_task_event
from relay.stores import DatabaseTaskStore, LocalTaskStore


def test_task_store_persists_assignment_status_activity_and_link() -> None:
    with TemporaryDirectory() as root:
        store = LocalTaskStore(root)
        task = store.create_task({"title": "Add Kanban board", "description": "Show backlog.", "priority": "high"})
        task = store.assign_task(task["id"], "codex")
        task = store.link_session(task["id"], "ses_test")
        task = store.update_task(task["id"], {"status": "running"})

        assert task["assignedAgent"] == "codex"
        assert task["linkedSessionIds"] == ["ses_test"]
        assert task["status"] == "running"
        assert any("Assigned to codex" in item["message"] for item in task["activity"])


def test_local_task_store_serializes_concurrent_appends() -> None:
    with TemporaryDirectory() as root:
        store = LocalTaskStore(root)
        task = store.create_task({"title": "Collect activity", "description": "", "priority": "normal"})

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
        task = store.create_task({"title": "Add Kanban board", "description": "Show backlog.", "priority": "high"})
        task = store.assign_task(task["id"], "codex")
        task = store.link_session(task["id"], "ses_test")
        task = store.update_task(task["id"], {"status": "running"})

        assert task["assignedAgent"] == "codex"
        assert task["linkedSessionIds"] == ["ses_test"]
        assert task["status"] == "running"
        assert store.list_tasks()[0]["id"] == task["id"]
        assert any("Assigned to codex" in item["message"] for item in task["activity"])
