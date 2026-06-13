from __future__ import annotations

from tempfile import TemporaryDirectory

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
