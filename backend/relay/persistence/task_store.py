from __future__ import annotations

import json
import time
from threading import RLock
from pathlib import Path
from typing import Any

from loguru import logger
from sqlalchemy import BigInteger, Boolean, JSON, Column, Date, DateTime, ForeignKey, MetaData, Table, Text, UniqueConstraint, Uuid, create_engine, insert, select, update
from sqlalchemy.exc import IntegrityError

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
        self._lock = RLock()
        self.tasks_dir.mkdir(parents=True, exist_ok=True)

    def create_task(self, input: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            task_id = new_relay_id("task")
            self._task_dir(task_id).mkdir(parents=True, exist_ok=True)
            logger.debug("Creating task", task_id=task_id, title=input.get("title"))
            events = [relay_task_event("task.created", task_id, {
                "title": input["title"],
                "description": input.get("description", ""),
                "priority": input.get("priority", "normal"),
                **({"ownerEmployeeId": input["ownerEmployeeId"]} if input.get("ownerEmployeeId") else {}),
                **({"assigneeEmployeeId": input["assigneeEmployeeId"]} if input.get("assigneeEmployeeId") else {}),
                **({"dueDate": input["dueDate"]} if input.get("dueDate") else {}),
                **({"isRoutine": input["isRoutine"]} if "isRoutine" in input else {}),
                **({"routineType": input["routineType"]} if input.get("routineType") else {}),
                **({"routineCadence": input["routineCadence"]} if input.get("routineCadence") else {}),
                **({"routineNextRunDate": input["routineNextRunDate"]} if input.get("routineNextRunDate") else {}),
                **({"routineEnabled": input["routineEnabled"]} if "routineEnabled" in input else {}),
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
        with self._lock:
            self._task_dir(task_id).mkdir(parents=True, exist_ok=True)
            _append_jsonl(self._events_path(task_id), event)
            logger.debug("Task event appended", task_id=task_id, event_type=event.get("type"))
            if self._snapshot_path(task_id).exists():
                events = [*_read_json(self._snapshot_path(task_id)).get("events", []), event]
            else:
                events = _read_jsonl(self._events_path(task_id))
            task = materialize_task_events(events)
            _write_json(self._snapshot_path(task_id), task)
            return task

    def get_task(self, task_id: str) -> dict[str, Any]:
        with self._lock:
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
            "assigneeEmployeeId": input.get("assigneeEmployeeId"),
            "dueDate": input.get("dueDate"),
            "isRoutine": input.get("isRoutine"),
            "routineType": input.get("routineType"),
            "routineCadence": input.get("routineCadence"),
            "routineNextRunDate": input.get("routineNextRunDate"),
            "routineEnabled": input.get("routineEnabled"),
        }))
        if input.get("status"):
            task = self.append_event(task_id, relay_task_event("task.status", task_id, {"status": input["status"]}))
        return task

    def claim_next_task_for_agent(self, agent: AgentName, assignee_employee_id: str | None = None) -> dict[str, Any] | None:
        with self._lock:
            candidates = [
                task for task in self.list_tasks()
                if task.get("status") == "assigned"
                and task.get("assignedAgent") == agent
                and not task.get("isRoutine")
                and (not assignee_employee_id or task.get("assigneeEmployeeId") == assignee_employee_id or task.get("ownerEmployeeId") == assignee_employee_id)
            ]
            if not candidates:
                return None
            task = sorted(candidates, key=task_claim_sort_key)[0]
            self.append_event(task["id"], relay_task_event("task.status", task["id"], {"status": "running"}))
            logger.debug("Task claimed", task_id=task["id"], agent=agent, assignee=assignee_employee_id)
            return self.record_activity(task["id"], f"Claimed by {agent}.", {"agent": agent})

    def claim_task_for_dispatch(self, task_id: str, agent: AgentName, message: str | None = None) -> dict[str, Any] | None:
        with self._lock:
            task = self.get_task(task_id)
            if task.get("status") != "assigned" or task.get("assignedAgent") != agent:
                return None
            if task.get("isRoutine"):
                return None
            self.append_event(task_id, relay_task_event("task.status", task_id, {"status": "running"}))
            logger.debug("Task claimed for dispatch", task_id=task_id, agent=agent)
            return self.record_activity(task_id, message or f"Scheduled dispatch claimed by {agent}.", {"agent": agent})

    def promote_due_routine(self, task_id: str, today: str, next_run_date: str | None) -> dict[str, Any] | None:
        with self._lock:
            routine = self.get_task(task_id)
            if not routine_due_for_promotion(routine, today):
                return None
            agent = routine.get("assignedAgent")
            if not agent:
                return None
            occurrence_events = routine_occurrence_events(routine, agent)
            occurrence = materialize_task_events(occurrence_events)
            self._task_dir(occurrence["id"]).mkdir(parents=True, exist_ok=True)
            self._events_path(occurrence["id"]).write_text("".join(json.dumps(item, separators=(",", ":")) + "\n" for item in occurrence_events), encoding="utf-8")
            _write_json(self._snapshot_path(occurrence["id"]), occurrence)

            routine_events = routine_promotion_events(routine["id"], occurrence["id"], agent, next_run_date)
            for event in routine_events:
                _append_jsonl(self._events_path(task_id), event)
            updated = materialize_task_events([*routine.get("events", []), *routine_events])
            _write_json(self._snapshot_path(task_id), updated)
            logger.debug("Due routine promoted", task_id=task_id, occurrence_id=occurrence["id"], agent=agent)
            return occurrence

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
        Column("assignee_employee_id", Text, nullable=True),
        Column("due_date", Date, nullable=True),
        Column("is_routine", Boolean, nullable=False, default=False),
        Column("routine_type", Text, nullable=True),
        Column("routine_cadence", Text, nullable=True),
        Column("routine_next_run_date", Date, nullable=True),
        Column("routine_enabled", Boolean, nullable=False, default=False),
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
            **({"assigneeEmployeeId": input["assigneeEmployeeId"]} if input.get("assigneeEmployeeId") else {}),
            **({"dueDate": input["dueDate"]} if input.get("dueDate") else {}),
            **({"isRoutine": input["isRoutine"]} if "isRoutine" in input else {}),
            **({"routineType": input["routineType"]} if input.get("routineType") else {}),
            **({"routineCadence": input["routineCadence"]} if input.get("routineCadence") else {}),
            **({"routineNextRunDate": input["routineNextRunDate"]} if input.get("routineNextRunDate") else {}),
            **({"routineEnabled": input["routineEnabled"]} if "routineEnabled" in input else {}),
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
        for attempt in range(3):
            try:
                return self._append_event_once(task_id, event)
            except IntegrityError:
                if attempt == 2:
                    raise
                time.sleep(0.01 * (attempt + 1))
        raise RuntimeError("unreachable")

    def _append_event_once(self, task_id: str, event: dict[str, Any]) -> dict[str, Any]:
        with self.engine.begin() as conn:
            row = conn.execute(
                select(self.tasks.c.id, self.tasks.c.snapshot, self.tasks.c.version)
                .where(self.tasks.c.public_id == task_id)
                .with_for_update()
            ).mappings().first()
            if not row:
                raise KeyError(task_id)
            task_pk = row["id"]
            sequence = int(row["version"] or 0)
            conn.execute(insert(self.events).values(**task_event_to_row(task_pk, sequence, event)))
            task = materialize_task_events([*(row["snapshot"] or {}).get("events", []), event])
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
            "assigneeEmployeeId": input.get("assigneeEmployeeId"),
            "dueDate": input.get("dueDate"),
            "isRoutine": input.get("isRoutine"),
            "routineType": input.get("routineType"),
            "routineCadence": input.get("routineCadence"),
            "routineNextRunDate": input.get("routineNextRunDate"),
            "routineEnabled": input.get("routineEnabled"),
        }))
        if input.get("status"):
            task = self.append_event(task_id, relay_task_event("task.status", task_id, {"status": input["status"]}))
        return task

    def claim_next_task_for_agent(self, agent: AgentName, assignee_employee_id: str | None = None) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            rows = conn.execute(
                select(self.tasks.c.public_id, self.tasks.c.snapshot)
                .where(self.tasks.c.status == "assigned")
                .where(self.tasks.c.assigned_agent == agent)
            ).mappings().all()
            candidates = [
                row["snapshot"] for row in rows
                if not row["snapshot"].get("isRoutine")
                and (
                    not assignee_employee_id
                    or row["snapshot"].get("assigneeEmployeeId") == assignee_employee_id
                    or row["snapshot"].get("ownerEmployeeId") == assignee_employee_id
                )
            ]
            if not candidates:
                return None
            task = sorted(candidates, key=task_claim_sort_key)[0]
            row = conn.execute(
                select(self.tasks.c.id, self.tasks.c.snapshot, self.tasks.c.version)
                .where(self.tasks.c.public_id == task["id"])
                .with_for_update()
            ).mappings().first()
            if not row or row["snapshot"].get("status") != "assigned" or row["snapshot"].get("assignedAgent") != agent:
                return None
            events = [
                relay_task_event("task.status", task["id"], {"status": "running"}),
                relay_task_event("task.activity", task["id"], {
                    "activity": {
                        "id": new_relay_id("act"),
                        "createdAt": now_iso(),
                        "message": f"Claimed by {agent}.",
                        "agent": agent,
                    }
                }),
            ]
            task_pk = row["id"]
            snapshot_events = list((row["snapshot"] or {}).get("events", []))
            sequence = int(row["version"] or 0)
            for offset, event in enumerate(events):
                conn.execute(insert(self.events).values(**task_event_to_row(task_pk, sequence + offset, event)))
                snapshot_events.append(event)
            claimed = materialize_task_events(snapshot_events)
            conn.execute(update(self.tasks).where(self.tasks.c.id == task_pk).values(**task_to_row(claimed, version=sequence + len(events), database_id=task_pk)))
        logger.debug("Database task claimed", task_id=claimed["id"], agent=agent, assignee=assignee_employee_id)
        return claimed

    def claim_task_for_dispatch(self, task_id: str, agent: AgentName, message: str | None = None) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            row = conn.execute(
                select(self.tasks.c.id, self.tasks.c.snapshot, self.tasks.c.version)
                .where(self.tasks.c.public_id == task_id)
                .with_for_update()
            ).mappings().first()
            if not row:
                return None
            snapshot = row["snapshot"] or {}
            if snapshot.get("status") != "assigned" or snapshot.get("assignedAgent") != agent or snapshot.get("isRoutine"):
                return None
            events = [
                relay_task_event("task.status", task_id, {"status": "running"}),
                relay_task_event("task.activity", task_id, {
                    "activity": {
                        "id": new_relay_id("act"),
                        "createdAt": now_iso(),
                        "message": message or f"Scheduled dispatch claimed by {agent}.",
                        "agent": agent,
                    }
                }),
            ]
            task_pk = row["id"]
            snapshot_events = list(snapshot.get("events", []))
            sequence = int(row["version"] or 0)
            for offset, event in enumerate(events):
                conn.execute(insert(self.events).values(**task_event_to_row(task_pk, sequence + offset, event)))
                snapshot_events.append(event)
            claimed = materialize_task_events(snapshot_events)
            conn.execute(update(self.tasks).where(self.tasks.c.id == task_pk).values(**task_to_row(claimed, version=sequence + len(events), database_id=task_pk)))
        logger.debug("Database task claimed for scheduled dispatch", task_id=task_id, agent=agent)
        return claimed

    def promote_due_routine(self, task_id: str, today: str, next_run_date: str | None) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            row = conn.execute(
                select(self.tasks.c.id, self.tasks.c.snapshot, self.tasks.c.version)
                .where(self.tasks.c.public_id == task_id)
                .with_for_update()
            ).mappings().first()
            if not row:
                return None
            routine = row["snapshot"] or {}
            if not routine_due_for_promotion(routine, today):
                return None
            agent = routine.get("assignedAgent")
            if not agent:
                return None

            occurrence_events = routine_occurrence_events(routine, agent)
            occurrence = materialize_task_events(occurrence_events)
            occurrence_row = task_to_row(occurrence, version=len(occurrence_events))
            conn.execute(insert(self.tasks).values(**occurrence_row))
            for sequence, event in enumerate(occurrence_events):
                conn.execute(insert(self.events).values(**task_event_to_row(occurrence_row["id"], sequence, event)))

            routine_events = routine_promotion_events(task_id, occurrence["id"], agent, next_run_date)
            task_pk = row["id"]
            snapshot_events = list(routine.get("events", []))
            sequence = int(row["version"] or 0)
            for offset, event in enumerate(routine_events):
                conn.execute(insert(self.events).values(**task_event_to_row(task_pk, sequence + offset, event)))
                snapshot_events.append(event)
            updated = materialize_task_events(snapshot_events)
            conn.execute(update(self.tasks).where(self.tasks.c.id == task_pk).values(**task_to_row(updated, version=sequence + len(routine_events), database_id=task_pk)))
        logger.debug("Database due routine promoted", task_id=task_id, occurrence_id=occurrence["id"], agent=agent)
        return occurrence

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

    def _task_pk(self, conn: Any, task_id: str, *, lock: bool = False) -> str:
        statement = select(self.tasks.c.id).where(self.tasks.c.public_id == task_id)
        if lock:
            statement = statement.with_for_update()
        task_pk = conn.scalar(statement)
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
        "assignee_employee_id": task.get("assigneeEmployeeId"),
        "due_date": _parse_date(task.get("dueDate")),
        "is_routine": bool(task.get("isRoutine")),
        "routine_type": task.get("routineType"),
        "routine_cadence": task.get("routineCadence"),
        "routine_next_run_date": _parse_date(task.get("routineNextRunDate")),
        "routine_enabled": bool(task.get("routineEnabled")),
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


def _parse_date(value: str | None) -> Any:
    if not value:
        return None
    return __import__("datetime").date.fromisoformat(value)


def task_claim_sort_key(task: dict[str, Any]) -> tuple[int, str, str]:
    priority_rank = {"high": 0, "normal": 1, "low": 2}.get(task.get("priority"), 1)
    due_date = task.get("dueDate") or "9999-12-31"
    return (priority_rank, due_date, task.get("createdAt") or "")


def routine_due_for_promotion(routine: dict[str, Any], today: str) -> bool:
    next_run = routine.get("routineNextRunDate")
    return bool(routine.get("isRoutine") and routine.get("routineEnabled") and next_run and next_run <= today)


def routine_occurrence_events(routine: dict[str, Any], agent: AgentName) -> list[dict[str, Any]]:
    occurrence_id = new_relay_id("task")
    events = [relay_task_event("task.created", occurrence_id, {
        "title": routine["title"],
        "description": routine.get("description", ""),
        "priority": routine.get("priority", "normal"),
        "dueDate": routine["routineNextRunDate"],
        **({"ownerEmployeeId": routine["ownerEmployeeId"]} if routine.get("ownerEmployeeId") else {}),
        **({"assigneeEmployeeId": routine["assigneeEmployeeId"]} if routine.get("assigneeEmployeeId") else {}),
    })]
    events.append(relay_task_event("task.assigned", occurrence_id, {"agent": agent}))
    events.append(relay_task_event("task.status", occurrence_id, {"status": "assigned"}))
    return events


def routine_promotion_events(routine_id: str, occurrence_id: str, agent: AgentName, next_run_date: str | None) -> list[dict[str, Any]]:
    return [
        relay_task_event("task.updated", routine_id, {
            "routineNextRunDate": next_run_date or "",
            "routineEnabled": bool(next_run_date),
        }),
        relay_task_event("task.activity", routine_id, {
            "activity": {
                "id": new_relay_id("act"),
                "createdAt": now_iso(),
                "message": f"Routine occurrence created: {occurrence_id}.",
                "agent": agent,
            }
        }),
    ]
