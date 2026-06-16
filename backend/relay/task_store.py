from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from loguru import logger
from sqlalchemy import BigInteger, JSON, Column, DateTime, ForeignKey, MetaData, Table, Text, UniqueConstraint, Uuid, create_engine, insert, select, update

from .store_common import (
    DEFAULT_RELAY_DATA_DIR,
    AgentName,
    _append_jsonl,
    _parse_iso,
    _read_json,
    _read_jsonl,
    _write_json,
    database_id_column,
    materialize_task_events,
    new_database_id,
    new_relay_id,
    now_iso,
    relay_task_event,
)

class LocalTaskStore:
    def __init__(self, root_dir: str | Path = DEFAULT_RELAY_DATA_DIR):
        self.root_dir = Path(root_dir)
        self.tasks_dir = self.root_dir / "tasks"
        self.tasks_dir.mkdir(parents=True, exist_ok=True)

    def create_task(self, input: dict[str, Any]) -> dict[str, Any]:
        task_id = new_relay_id("task")
        self._task_dir(task_id).mkdir(parents=True, exist_ok=True)
        logger.debug("Creating task", task_id=task_id, title=input.get("title"))
        events = [relay_task_event("task.created", task_id, {
            "title": input["title"],
            "description": input.get("description", ""),
            "priority": input.get("priority", "normal"),
            **({"ownerEmployeeId": input["ownerEmployeeId"]} if input.get("ownerEmployeeId") else {}),
        })]
        if input.get("assignedAgent"):
            events.append(relay_task_event("task.assigned", task_id, {"agent": input["assignedAgent"]}))
        if input.get("status") and input["status"] != "backlog":
            events.append(relay_task_event("task.status", task_id, {"status": input["status"]}))
        task = materialize_task_events(events)
        self._events_path(task_id).write_text("".join(json.dumps(item, separators=(",", ":")) + "\n" for item in events), encoding="utf-8")
        _write_json(self._snapshot_path(task_id), task)
        return task

    def append_event(self, task_id: str, event: dict[str, Any]) -> dict[str, Any]:
        self._task_dir(task_id).mkdir(parents=True, exist_ok=True)
        _append_jsonl(self._events_path(task_id), event)
        logger.debug("Task event appended", task_id=task_id, event_type=event.get("type"))
        task = materialize_task_events(_read_jsonl(self._events_path(task_id)))
        _write_json(self._snapshot_path(task_id), task)
        return task

    def get_task(self, task_id: str) -> dict[str, Any]:
        if self._snapshot_path(task_id).exists():
            return _read_json(self._snapshot_path(task_id))
        return materialize_task_events(_read_jsonl(self._events_path(task_id)))

    def list_tasks(self) -> list[dict[str, Any]]:
        if not self.tasks_dir.exists():
            return []
        tasks = [self.get_task(path.name) for path in self.tasks_dir.iterdir() if path.is_dir()]
        return sorted(tasks, key=lambda item: item["updatedAt"], reverse=True)

    def update_task(self, task_id: str, input: dict[str, Any]) -> dict[str, Any]:
        task = self.append_event(task_id, relay_task_event("task.updated", task_id, {
            "title": input.get("title"),
            "description": input.get("description"),
            "priority": input.get("priority"),
        }))
        if input.get("status"):
            task = self.append_event(task_id, relay_task_event("task.status", task_id, {"status": input["status"]}))
        return task

    def assign_task(self, task_id: str, agent: AgentName) -> dict[str, Any]:
        self.append_event(task_id, relay_task_event("task.assigned", task_id, {"agent": agent}))
        self.append_event(task_id, relay_task_event("task.status", task_id, {"status": "assigned"}))
        logger.debug("Task assigned", task_id=task_id, agent=agent)
        return self.record_activity(task_id, f"Assigned to {agent}.", {"agent": agent})

    def link_session(self, task_id: str, session_id: str) -> dict[str, Any]:
        task = self.append_event(task_id, relay_task_event("task.session_linked", task_id, {"sessionId": session_id}))
        logger.debug("Task linked to session", task_id=task_id, session_id=session_id)
        return self.record_activity(task["id"], f"Linked session {session_id}.", {"sessionId": session_id})

    def record_activity(self, task_id: str, message: str, input: dict[str, Any] | None = None) -> dict[str, Any]:
        input = input or {}
        logger.debug("Task activity recorded", task_id=task_id, message=message)
        return self.append_event(task_id, relay_task_event("task.activity", task_id, {
            "activity": {
                "id": new_relay_id("act"),
                "createdAt": now_iso(),
                "message": message,
                **({"agent": input["agent"]} if input.get("agent") else {}),
                **({"sessionId": input["sessionId"]} if input.get("sessionId") else {}),
            }
        }))

    def _task_dir(self, task_id: str) -> Path:
        return self.tasks_dir / Path(task_id).name

    def _events_path(self, task_id: str) -> Path:
        return self._task_dir(task_id) / "events.jsonl"

    def _snapshot_path(self, task_id: str) -> Path:
        return self._task_dir(task_id) / "snapshot.json"


class DatabaseTaskStore:
    metadata = MetaData()

    tasks = Table(
        "tasks",
        metadata,
        database_id_column(),
        Column("public_id", Text, nullable=False, unique=True),
        Column("title", Text, nullable=False),
        Column("description", Text, nullable=False),
        Column("priority", Text, nullable=False),
        Column("status", Text, nullable=False),
        Column("assigned_agent", Text, nullable=True),
        Column("owner_employee_id", Text, nullable=True),
        Column("snapshot", JSON, nullable=False),
        Column("version", BigInteger, nullable=False),
        Column("created_at", DateTime(timezone=True), nullable=False),
        Column("updated_at", DateTime(timezone=True), nullable=False),
    )
    events = Table(
        "task_events",
        metadata,
        database_id_column(),
        Column("public_id", Text, nullable=False, unique=True),
        Column("task_id", Uuid(as_uuid=False), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        Column("sequence", BigInteger, nullable=False),
        Column("type", Text, nullable=False),
        Column("timestamp", DateTime(timezone=True), nullable=False),
        Column("payload", JSON, nullable=False),
    )
    task_sessions = Table(
        "task_sessions",
        metadata,
        database_id_column(),
        Column("task_id", Uuid(as_uuid=False), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        Column("session_public_id", Text, nullable=False),
        Column("created_at", DateTime(timezone=True), nullable=False),
        UniqueConstraint("task_id", "session_public_id", name="uq_task_sessions_task_session_public"),
    )

    def __init__(self, database_url: str, *, create_schema: bool = False):
        self.engine = create_engine(database_url, future=True)
        if create_schema:
            self.metadata.create_all(self.engine)

    def create_task(self, input: dict[str, Any]) -> dict[str, Any]:
        task_id = new_relay_id("task")
        logger.debug("Creating database task", task_id=task_id, title=input.get("title"))
        events = [relay_task_event("task.created", task_id, {
            "title": input["title"],
            "description": input.get("description", ""),
            "priority": input.get("priority", "normal"),
            **({"ownerEmployeeId": input["ownerEmployeeId"]} if input.get("ownerEmployeeId") else {}),
        })]
        if input.get("assignedAgent"):
            events.append(relay_task_event("task.assigned", task_id, {"agent": input["assignedAgent"]}))
        if input.get("status") and input["status"] != "backlog":
            events.append(relay_task_event("task.status", task_id, {"status": input["status"]}))
        task = materialize_task_events(events)
        with self.engine.begin() as conn:
            task_row = task_to_row(task, version=len(events))
            conn.execute(insert(self.tasks).values(**task_row))
            for sequence, event in enumerate(events):
                conn.execute(insert(self.events).values(**task_event_to_row(task_row["id"], sequence, event)))
        return task

    def append_event(self, task_id: str, event: dict[str, Any]) -> dict[str, Any]:
        with self.engine.begin() as conn:
            task_pk = self._task_pk(conn, task_id)
            events = self._events_for_task(conn, task_pk)
            if not events:
                raise KeyError(task_id)
            sequence = len(events)
            conn.execute(insert(self.events).values(**task_event_to_row(task_pk, sequence, event)))
            task = materialize_task_events([*events, event])
            conn.execute(update(self.tasks).where(self.tasks.c.id == task_pk).values(**task_to_row(task, version=sequence + 1, database_id=task_pk)))
            if event.get("type") == "task.session_linked":
                self._ensure_task_session(conn, task_pk, event["sessionId"], event["timestamp"])
        logger.debug("Database task event appended", task_id=task_id, event_type=event.get("type"))
        return task

    def get_task(self, task_id: str) -> dict[str, Any]:
        with self.engine.begin() as conn:
            row = conn.execute(select(self.tasks.c.snapshot).where(self.tasks.c.public_id == task_id)).mappings().first()
            if not row:
                raise KeyError(task_id)
        return row["snapshot"]

    def list_tasks(self) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = conn.execute(select(self.tasks.c.snapshot).order_by(self.tasks.c.updated_at.desc())).mappings().all()
        return [row["snapshot"] for row in rows]

    def update_task(self, task_id: str, input: dict[str, Any]) -> dict[str, Any]:
        task = self.append_event(task_id, relay_task_event("task.updated", task_id, {
            "title": input.get("title"),
            "description": input.get("description"),
            "priority": input.get("priority"),
        }))
        if input.get("status"):
            task = self.append_event(task_id, relay_task_event("task.status", task_id, {"status": input["status"]}))
        return task

    def assign_task(self, task_id: str, agent: AgentName) -> dict[str, Any]:
        self.append_event(task_id, relay_task_event("task.assigned", task_id, {"agent": agent}))
        self.append_event(task_id, relay_task_event("task.status", task_id, {"status": "assigned"}))
        logger.debug("Database task assigned", task_id=task_id, agent=agent)
        return self.record_activity(task_id, f"Assigned to {agent}.", {"agent": agent})

    def link_session(self, task_id: str, session_id: str) -> dict[str, Any]:
        task = self.append_event(task_id, relay_task_event("task.session_linked", task_id, {"sessionId": session_id}))
        logger.debug("Database task linked to session", task_id=task_id, session_id=session_id)
        return self.record_activity(task["id"], f"Linked session {session_id}.", {"sessionId": session_id})

    def record_activity(self, task_id: str, message: str, input: dict[str, Any] | None = None) -> dict[str, Any]:
        input = input or {}
        logger.debug("Database task activity recorded", task_id=task_id, message=message)
        return self.append_event(task_id, relay_task_event("task.activity", task_id, {
            "activity": {
                "id": new_relay_id("act"),
                "createdAt": now_iso(),
                "message": message,
                **({"agent": input["agent"]} if input.get("agent") else {}),
                **({"sessionId": input["sessionId"]} if input.get("sessionId") else {}),
            }
        }))

    def _task_pk(self, conn: Any, task_id: str) -> str:
        task_pk = conn.scalar(select(self.tasks.c.id).where(self.tasks.c.public_id == task_id))
        if not task_pk:
            raise KeyError(task_id)
        return task_pk

    def _events_for_task(self, conn: Any, task_pk: str) -> list[dict[str, Any]]:
        rows = conn.execute(
            select(self.events.c.payload)
            .where(self.events.c.task_id == task_pk)
            .order_by(self.events.c.sequence)
        ).mappings().all()
        return [row["payload"] for row in rows]

    def _ensure_task_session(self, conn: Any, task_pk: str, session_id: str, timestamp: str) -> None:
        existing = conn.execute(
            select(self.task_sessions.c.task_id)
            .where(self.task_sessions.c.task_id == task_pk)
            .where(self.task_sessions.c.session_public_id == session_id)
        ).first()
        if not existing:
            conn.execute(insert(self.task_sessions).values(id=new_database_id(), task_id=task_pk, session_public_id=session_id, created_at=_parse_iso(timestamp)))



def task_to_row(task: dict[str, Any], *, version: int, database_id: str | None = None) -> dict[str, Any]:
    return {
        "id": database_id or new_database_id(),
        "public_id": task["id"],
        "title": task["title"],
        "description": task.get("description", ""),
        "priority": task.get("priority", "normal"),
        "status": task["status"],
        "assigned_agent": task.get("assignedAgent"),
        "owner_employee_id": task.get("ownerEmployeeId"),
        "snapshot": task,
        "version": version,
        "created_at": _parse_iso(task["createdAt"]),
        "updated_at": _parse_iso(task["updatedAt"]),
    }


def task_event_to_row(task_pk: str, sequence: int, event: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": new_database_id(),
        "public_id": event["id"],
        "task_id": task_pk,
        "sequence": sequence,
        "type": event["type"],
        "timestamp": _parse_iso(event["timestamp"]),
        "payload": event,
    }
