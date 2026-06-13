from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from sqlalchemy import (
    BigInteger,
    JSON,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    MetaData,
    Table,
    Text,
    create_engine,
    insert,
    select,
    update,
)

from loguru import logger

from .ids import new_relay_id, now_iso
from .models import AGENT_NAMES, AgentName, TaskPriority, TaskStatus

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RELAY_DATA_DIR = REPO_ROOT / ".relay"


def _parse_iso(value: str | None) -> Any:
    if not value:
        return None
    return __import__("datetime").datetime.fromisoformat(value.replace("Z", "+00:00"))


def _format_iso(value: Any) -> str | None:
    if value is None:
        return None
    return value.astimezone(__import__("datetime").timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _write_json(path: Path, value: Any, mode: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    if mode is None:
        with tmp.open("w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2)
            handle.write("\n")
    else:
        fd = os.open(tmp, flags, mode)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2)
            handle.write("\n")
    tmp.replace(path)


def _append_jsonl(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(value, separators=(",", ":")))
        handle.write("\n")


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise KeyError(path)
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def relay_event(event_type: str, session_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"id": new_relay_id("evt"), "type": event_type, "sessionId": session_id, "timestamp": now_iso(), **payload}


def relay_task_event(event_type: str, task_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"id": new_relay_id("evt"), "type": event_type, "taskId": task_id, "timestamp": now_iso(), **payload}


def materialize_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    created = next((event for event in events if event.get("type") == "session.created"), None)
    if not created:
        raise ValueError("Relay session event log is missing session.created.")
    session: dict[str, Any] = {
        "id": created["sessionId"],
        "workspacePath": created["workspacePath"],
        "taskGoal": created["taskGoal"],
        "participants": created.get("participants", ["human"]),
        "status": "running",
        "phase": "created",
        "createdAt": created["timestamp"],
        "updatedAt": created["timestamp"],
        "agentRuns": [],
        "artifacts": [],
        "decisions": [],
        "events": [],
    }
    if created.get("ownerEmployeeId"):
        session["ownerEmployeeId"] = created["ownerEmployeeId"]
    for event in events:
        session["events"].append(event)
        session["updatedAt"] = event["timestamp"]
        event_type = event.get("type")
        if event_type == "session.status":
            session["status"] = event["status"]
            session["phase"] = event["phase"]
            if event.get("pendingDecision"):
                session["pendingDecision"] = event["pendingDecision"]
            else:
                session.pop("pendingDecision", None)
            if event["status"] not in ("completed", "failed"):
                session.pop("finalOutcome", None)
        elif event_type == "agent.started":
            session["status"] = "running"
            session["phase"] = f"{event['agent']}:{event['mode']}"
            session["currentAgent"] = event["agent"]
            session["agentRuns"].append({
                "id": event["runId"],
                "agent": event["agent"],
                "role": event["role"],
                "mode": event["mode"],
                "status": "running",
                "startedAt": event["timestamp"],
                "artifactIds": [],
            })
        elif event_type == "agent.completed":
            for run in session["agentRuns"]:
                if run["id"] == event["runId"]:
                    run["status"] = event["status"]
                    run["completedAt"] = event["timestamp"]
                    run["exitCode"] = event["exitCode"]
            session.pop("currentAgent", None)
            session["phase"] = "agent_completed" if event["status"] == "completed" else "cancelled" if event["status"] == "cancelled" else "agent_failed"
        elif event_type == "artifact.created":
            artifact = event["artifact"]
            session["artifacts"].append(artifact)
            if artifact.get("agentRunId"):
                for run in session["agentRuns"]:
                    if run["id"] == artifact["agentRunId"]:
                        run.setdefault("artifactIds", []).append(artifact["id"])
        elif event_type == "human.decision":
            decision = event["decision"]
            session["decisions"].append(decision)
            if decision["kind"] == "handoff" and decision.get("targetAgent"):
                session["currentAgent"] = decision["targetAgent"]
            if decision["kind"] == "cancel":
                session["status"] = "cancelled"
                session["phase"] = "cancelled"
        elif event_type == "review.verdict":
            session["reviewVerdict"] = event["verdict"]
            session["phase"] = f"review:{event['verdict']}"
        elif event_type == "session.completed":
            session["status"] = "completed"
            session["phase"] = "completed"
            session["finalOutcome"] = event["outcome"]
            session.pop("currentAgent", None)
        elif event_type == "session.failed":
            session["status"] = "failed"
            session["phase"] = "failed"
            session["finalOutcome"] = event["outcome"]
            session.pop("currentAgent", None)
    return session


def materialize_task_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    created = next((event for event in events if event.get("type") == "task.created"), None)
    if not created:
        raise ValueError("Relay task event log is missing task.created.")
    task: dict[str, Any] = {
        "id": created["taskId"],
        "title": created["title"],
        "description": created.get("description", ""),
        "priority": created.get("priority", "normal"),
        "status": "backlog",
        "linkedSessionIds": [],
        "activity": [],
        "createdAt": created["timestamp"],
        "updatedAt": created["timestamp"],
        "events": [],
    }
    if created.get("ownerEmployeeId"):
        task["ownerEmployeeId"] = created["ownerEmployeeId"]
    for event in events:
        task["events"].append(event)
        task["updatedAt"] = event["timestamp"]
        event_type = event.get("type")
        if event_type == "task.updated":
            for key in ("title", "description", "priority"):
                if key in event and event[key] is not None:
                    task[key] = event[key]
        elif event_type == "task.assigned":
            task["assignedAgent"] = event["agent"]
        elif event_type == "task.status":
            task["status"] = event["status"]
        elif event_type == "task.session_linked":
            if event["sessionId"] not in task["linkedSessionIds"]:
                task["linkedSessionIds"].append(event["sessionId"])
        elif event_type == "task.activity":
            task["activity"].append(event["activity"])
    return task


class LocalSessionStore:
    def __init__(self, root_dir: str | Path = DEFAULT_RELAY_DATA_DIR):
        self.root_dir = Path(root_dir)
        self.sessions_dir = self.root_dir / "sessions"
        self.sessions_dir.mkdir(parents=True, exist_ok=True)

    def create_session(self, input: dict[str, Any]) -> dict[str, Any]:
        session_id = new_relay_id("ses")
        (self._session_dir(session_id) / "artifacts").mkdir(parents=True, exist_ok=True)
        logger.debug("Creating session", session_id=session_id, workspace_path=input.get("workspacePath"))
        event = relay_event("session.created", session_id, {
            "workspacePath": input["workspacePath"],
            **({"ownerEmployeeId": input["ownerEmployeeId"]} if input.get("ownerEmployeeId") else {}),
            "taskGoal": input["taskGoal"],
            "participants": input.get("participants", ["human"]),
        })
        events = [event]
        if input.get("status") or input.get("pendingDecision"):
            events.append(relay_event("session.status", session_id, {
                "status": input.get("status", "running"),
                "phase": f"waiting:{input['pendingDecision']}" if input.get("pendingDecision") else "created",
                **({"pendingDecision": input["pendingDecision"]} if input.get("pendingDecision") else {}),
            }))
        session = materialize_events(events)
        self._events_path(session_id).write_text("".join(json.dumps(item, separators=(",", ":")) + "\n" for item in events), encoding="utf-8")
        _write_json(self._snapshot_path(session_id), session)
        return session

    def append_event(self, session_id: str, event: dict[str, Any]) -> dict[str, Any]:
        self._session_dir(session_id).mkdir(parents=True, exist_ok=True)
        _append_jsonl(self._events_path(session_id), event)
        logger.debug("Session event appended", session_id=session_id, event_type=event.get("type"))
        session = materialize_events(_read_jsonl(self._events_path(session_id)))
        _write_json(self._snapshot_path(session_id), session)
        return session

    def get_session(self, session_id: str) -> dict[str, Any]:
        if self._snapshot_path(session_id).exists():
            return _read_json(self._snapshot_path(session_id))
        return materialize_events(_read_jsonl(self._events_path(session_id)))

    def list_sessions(self) -> list[dict[str, Any]]:
        if not self.sessions_dir.exists():
            return []
        sessions = [self.get_session(path.name) for path in self.sessions_dir.iterdir() if path.is_dir()]
        return sorted(sessions, key=lambda item: item["updatedAt"], reverse=True)

    def write_artifact(self, session_id: str, input: dict[str, Any]) -> dict[str, Any]:
        artifact_id = new_relay_id("art")
        extension = input.get("extension") or "txt"
        artifact_dir = self._session_dir(session_id) / "artifacts"
        artifact_dir.mkdir(parents=True, exist_ok=True)
        path = artifact_dir / f"{artifact_id}.{extension}"
        body = input["body"]
        path.write_text(body, encoding="utf-8")
        logger.debug("Artifact written", session_id=session_id, artifact_id=artifact_id, kind=input.get("kind"), bytes=len(body.encode("utf-8")))
        return {
            "id": artifact_id,
            "kind": input["kind"],
            "title": input["title"],
            "path": str(path),
            "createdAt": now_iso(),
            **({"agentRunId": input["agentRunId"]} if input.get("agentRunId") else {}),
            "bytes": len(body.encode("utf-8")),
        }

    def artifact_path(self, session_id: str, artifact_id: str) -> Path:
        for artifact in self.get_session(session_id).get("artifacts", []):
            if artifact["id"] == artifact_id:
                return Path(artifact["path"])
        raise KeyError(f"Unknown artifact {artifact_id} in session {session_id}.")

    def read_artifact(self, session_id: str, artifact_id: str) -> str:
        return self.artifact_path(session_id, artifact_id).read_text(encoding="utf-8")

    def _session_dir(self, session_id: str) -> Path:
        return self.sessions_dir / Path(session_id).name

    def _events_path(self, session_id: str) -> Path:
        return self._session_dir(session_id) / "events.jsonl"

    def _snapshot_path(self, session_id: str) -> Path:
        return self._session_dir(session_id) / "snapshot.json"


class DatabaseSessionStore:
    metadata = MetaData()

    sessions = Table(
        "sessions",
        metadata,
        Column("id", Text, primary_key=True),
        Column("workspace_path", Text, nullable=False),
        Column("owner_employee_id", Text, nullable=True),
        Column("task_goal", Text, nullable=False),
        Column("participants", JSON, nullable=False),
        Column("status", Text, nullable=False),
        Column("phase", Text, nullable=False),
        Column("pending_decision", Text, nullable=True),
        Column("current_agent", Text, nullable=True),
        Column("review_verdict", Text, nullable=True),
        Column("final_outcome", JSON, nullable=True),
        Column("snapshot", JSON, nullable=False),
        Column("version", BigInteger, nullable=False),
        Column("created_at", DateTime(timezone=True), nullable=False),
        Column("updated_at", DateTime(timezone=True), nullable=False),
    )
    events = Table(
        "session_events",
        metadata,
        Column("id", Text, primary_key=True),
        Column("session_id", Text, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        Column("sequence", BigInteger, nullable=False),
        Column("type", Text, nullable=False),
        Column("timestamp", DateTime(timezone=True), nullable=False),
        Column("payload", JSON, nullable=False),
    )
    artifacts = Table(
        "session_artifacts",
        metadata,
        Column("id", Text, primary_key=True),
        Column("session_id", Text, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        Column("agent_run_id", Text, nullable=True),
        Column("kind", Text, nullable=False),
        Column("title", Text, nullable=False),
        Column("path", Text, nullable=True),
        Column("content_type", Text, nullable=True),
        Column("byte_size", BigInteger, nullable=False),
        Column("metadata", JSON, nullable=False),
        Column("created_at", DateTime(timezone=True), nullable=False),
    )

    def __init__(self, database_url: str, root_dir: str | Path = DEFAULT_RELAY_DATA_DIR, *, create_schema: bool = False):
        self.engine = create_engine(database_url, future=True)
        self.root_dir = Path(root_dir)
        self.artifacts_dir = self.root_dir / "session-artifacts"
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)
        if create_schema:
            self.metadata.create_all(self.engine)

    def create_session(self, input: dict[str, Any]) -> dict[str, Any]:
        session_id = new_relay_id("ses")
        logger.debug("Creating database session", session_id=session_id, workspace_path=input.get("workspacePath"))
        events = [relay_event("session.created", session_id, {
            "workspacePath": input["workspacePath"],
            **({"ownerEmployeeId": input["ownerEmployeeId"]} if input.get("ownerEmployeeId") else {}),
            "taskGoal": input["taskGoal"],
            "participants": input.get("participants", ["human"]),
        })]
        if input.get("status") or input.get("pendingDecision"):
            events.append(relay_event("session.status", session_id, {
                "status": input.get("status", "running"),
                "phase": f"waiting:{input['pendingDecision']}" if input.get("pendingDecision") else "created",
                **({"pendingDecision": input["pendingDecision"]} if input.get("pendingDecision") else {}),
            }))
        session = materialize_events(events)
        with self.engine.begin() as conn:
            conn.execute(insert(self.sessions).values(**session_to_row(session, version=len(events))))
            for sequence, event in enumerate(events):
                conn.execute(insert(self.events).values(**session_event_to_row(session_id, sequence, event)))
        return session

    def append_event(self, session_id: str, event: dict[str, Any]) -> dict[str, Any]:
        with self.engine.begin() as conn:
            events = self._events_for_session(conn, session_id)
            if not events:
                raise KeyError(session_id)
            sequence = len(events)
            conn.execute(insert(self.events).values(**session_event_to_row(session_id, sequence, event)))
            session = materialize_events([*events, event])
            conn.execute(update(self.sessions).where(self.sessions.c.id == session_id).values(**session_to_row(session, version=sequence + 1)))
        logger.debug("Database session event appended", session_id=session_id, event_type=event.get("type"))
        return session

    def get_session(self, session_id: str) -> dict[str, Any]:
        with self.engine.begin() as conn:
            row = conn.execute(select(self.sessions.c.snapshot).where(self.sessions.c.id == session_id)).mappings().first()
            if not row:
                raise KeyError(session_id)
        return row["snapshot"]

    def list_sessions(self) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = conn.execute(select(self.sessions.c.snapshot).order_by(self.sessions.c.updated_at.desc())).mappings().all()
        return [row["snapshot"] for row in rows]

    def write_artifact(self, session_id: str, input: dict[str, Any]) -> dict[str, Any]:
        if not self.get_session(session_id):
            raise KeyError(session_id)
        artifact_id = new_relay_id("art")
        extension = input.get("extension") or "txt"
        artifact_dir = self.artifacts_dir / safe_name(session_id)
        artifact_dir.mkdir(parents=True, exist_ok=True)
        path = artifact_dir / f"{artifact_id}.{extension}"
        body = input["body"]
        path.write_text(body, encoding="utf-8")
        artifact = {
            "id": artifact_id,
            "kind": input["kind"],
            "title": input["title"],
            "path": str(path),
            "createdAt": now_iso(),
            **({"agentRunId": input["agentRunId"]} if input.get("agentRunId") else {}),
            "bytes": len(body.encode("utf-8")),
        }
        with self.engine.begin() as conn:
            conn.execute(insert(self.artifacts).values(**session_artifact_to_row(session_id, artifact, {"extension": extension})))
        logger.debug("Database artifact written", session_id=session_id, artifact_id=artifact_id, kind=input.get("kind"), bytes=artifact["bytes"])
        return artifact

    def artifact_path(self, session_id: str, artifact_id: str) -> Path:
        with self.engine.begin() as conn:
            row = conn.execute(
                select(self.artifacts.c.path)
                .where(self.artifacts.c.session_id == session_id)
                .where(self.artifacts.c.id == artifact_id)
            ).mappings().first()
        if row and row["path"]:
            return Path(row["path"])
        for artifact in self.get_session(session_id).get("artifacts", []):
            if artifact["id"] == artifact_id:
                return Path(artifact["path"])
        raise KeyError(f"Unknown artifact {artifact_id} in session {session_id}.")

    def read_artifact(self, session_id: str, artifact_id: str) -> str:
        return self.artifact_path(session_id, artifact_id).read_text(encoding="utf-8")

    def _events_for_session(self, conn: Any, session_id: str) -> list[dict[str, Any]]:
        rows = conn.execute(
            select(self.events.c.payload)
            .where(self.events.c.session_id == session_id)
            .order_by(self.events.c.sequence)
        ).mappings().all()
        return [row["payload"] for row in rows]


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
        Column("id", Text, primary_key=True),
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
        Column("id", Text, primary_key=True),
        Column("task_id", Text, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        Column("sequence", BigInteger, nullable=False),
        Column("type", Text, nullable=False),
        Column("timestamp", DateTime(timezone=True), nullable=False),
        Column("payload", JSON, nullable=False),
    )
    task_sessions = Table(
        "task_sessions",
        metadata,
        Column("task_id", Text, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
        Column("session_id", Text, primary_key=True),
        Column("created_at", DateTime(timezone=True), nullable=False),
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
            conn.execute(insert(self.tasks).values(**task_to_row(task, version=len(events))))
            for sequence, event in enumerate(events):
                conn.execute(insert(self.events).values(**task_event_to_row(task_id, sequence, event)))
        return task

    def append_event(self, task_id: str, event: dict[str, Any]) -> dict[str, Any]:
        with self.engine.begin() as conn:
            events = self._events_for_task(conn, task_id)
            if not events:
                raise KeyError(task_id)
            sequence = len(events)
            conn.execute(insert(self.events).values(**task_event_to_row(task_id, sequence, event)))
            task = materialize_task_events([*events, event])
            conn.execute(update(self.tasks).where(self.tasks.c.id == task_id).values(**task_to_row(task, version=sequence + 1)))
            if event.get("type") == "task.session_linked":
                self._ensure_task_session(conn, task_id, event["sessionId"], event["timestamp"])
        logger.debug("Database task event appended", task_id=task_id, event_type=event.get("type"))
        return task

    def get_task(self, task_id: str) -> dict[str, Any]:
        with self.engine.begin() as conn:
            row = conn.execute(select(self.tasks.c.snapshot).where(self.tasks.c.id == task_id)).mappings().first()
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

    def _events_for_task(self, conn: Any, task_id: str) -> list[dict[str, Any]]:
        rows = conn.execute(
            select(self.events.c.payload)
            .where(self.events.c.task_id == task_id)
            .order_by(self.events.c.sequence)
        ).mappings().all()
        return [row["payload"] for row in rows]

    def _ensure_task_session(self, conn: Any, task_id: str, session_id: str, timestamp: str) -> None:
        existing = conn.execute(
            select(self.task_sessions.c.task_id)
            .where(self.task_sessions.c.task_id == task_id)
            .where(self.task_sessions.c.session_id == session_id)
        ).first()
        if not existing:
            conn.execute(insert(self.task_sessions).values(task_id=task_id, session_id=session_id, created_at=_parse_iso(timestamp)))


class LocalDaemonStore:
    def __init__(self, root_dir: str | Path = DEFAULT_RELAY_DATA_DIR):
        root = Path(root_dir)
        self.nodes_dir = root / "daemon" / "nodes"
        self.commands_dir = root / "daemon" / "commands"
        self.runs_dir = root / "daemon" / "runs"
        self.events_dir = root / "daemon" / "events"
        for path in (self.nodes_dir, self.commands_dir, self.runs_dir, self.events_dir):
            path.mkdir(parents=True, exist_ok=True)

    def register_node(self, sandbox: dict[str, Any]) -> dict[str, Any]:
        node = {**sandbox, "token": None, "nodeToken": None}
        _write_json(self.nodes_dir / f"{safe_name(node['id'])}.json", node, 0o600)
        self.append_daemon_event(daemon_event("daemon.node.registered", {"node": node}))
        return node

    def mark_node_seen(self, node_id: str, patch: dict[str, Any] | None = None) -> dict[str, Any] | None:
        node = self.get_node(node_id)
        if not node:
            return None
        now = now_iso()
        patch = patch or {}
        updated = {**node, **{k: v for k, v in patch.items() if v is not None}, "updatedAt": now, "lastSeenAt": now}
        if patch.get("lastError") is None and "lastError" in patch:
            updated.pop("lastError", None)
        _write_json(self.nodes_dir / f"{safe_name(node_id)}.json", updated, 0o600)
        self.append_daemon_event(daemon_event("daemon.node.seen", {"nodeId": node_id, "patch": {**patch, "lastSeenAt": now}}))
        return updated

    def get_node(self, node_id: str) -> dict[str, Any] | None:
        path = self.nodes_dir / f"{safe_name(node_id)}.json"
        return _read_json(path) if path.exists() else None

    def list_nodes(self) -> list[dict[str, Any]]:
        return [_read_json(path) for path in self.nodes_dir.glob("*.json")]

    def enqueue_command(self, node_id: str, command: dict[str, Any]) -> dict[str, Any]:
        now = now_iso()
        record = {"id": command["id"], "nodeId": node_id, "command": command, "status": "queued", "createdAt": now, "updatedAt": now}
        _write_json(self.commands_dir / f"{safe_name(record['id'])}.json", record)
        if command["type"] == "run.start":
            self._write_run({
                "nodeId": node_id,
                "commandId": command["id"],
                "sessionId": command["sessionId"],
                "runId": command["runId"],
                "agent": command["agent"],
                "mode": command["mode"],
                "taskGoal": command["taskGoal"],
                **({"workspacePath": command["workspacePath"]} if command.get("workspacePath") else {}),
                "status": "running",
                "startedAt": now,
            })
        self.append_daemon_event(daemon_event("daemon.command.queued", {"nodeId": node_id, "commandId": command["id"]}))
        return record

    def take_queued_commands(self, node_id: str, limit: int = 2**53) -> list[dict[str, Any]]:
        now = now_iso()
        records = [record for record in self._list_commands() if record["nodeId"] == node_id and record["status"] == "queued"]
        records = sorted(records, key=lambda item: item["createdAt"])[:limit]
        result = []
        for record in records:
            updated = {**record, "status": "dispatched", "updatedAt": now, "dispatchedAt": now}
            if record["command"]["type"] == "run.cancel":
                updated["status"] = "completed"
                updated["completedAt"] = now
            _write_json(self.commands_dir / f"{safe_name(record['id'])}.json", updated)
            self.append_daemon_event(daemon_event("daemon.command.dispatched", {"nodeId": node_id, "commandId": record["id"]}))
            result.append(updated)
        return result

    def queued_command_count(self, node_id: str) -> int:
        return len([record for record in self._list_commands() if record["nodeId"] == node_id and record["status"] == "queued"])

    def list_active_runs(self, node_id: str | None = None) -> list[dict[str, Any]]:
        runs = [_read_json(path) for path in self.runs_dir.glob("*.json")]
        return [run for run in runs if run.get("status") == "running" and (node_id is None or run.get("nodeId") == node_id)]

    def mark_command_completed(self, node_id: str, event: dict[str, Any]) -> None:
        self._mark_command_terminal(node_id, event, "completed", event.get("exitCode"), None)

    def mark_command_failed(self, node_id: str, event: dict[str, Any]) -> None:
        self._mark_command_terminal(node_id, event, "failed", event.get("exitCode"), event.get("error"))

    def mark_command_cancelled(self, node_id: str, event: dict[str, Any]) -> None:
        self._mark_command_terminal(node_id, event, "cancelled", None, event.get("reason"))

    def append_daemon_event(self, event: dict[str, Any]) -> None:
        _append_jsonl(self.events_dir / "events.jsonl", event)

    def _mark_command_terminal(self, node_id: str, event: dict[str, Any], status: str, exit_code: int | None, error: str | None) -> None:
        now = now_iso()
        command = self._get_command(event["commandId"])
        if command:
            _write_json(self.commands_dir / f"{safe_name(command['id'])}.json", {
                **command,
                "status": status,
                "updatedAt": now,
                "completedAt": now,
                **({"exitCode": exit_code} if exit_code is not None else {}),
                **({"error": error} if error else {}),
            })
        run = self._get_run(event["runId"]) or {
            "nodeId": node_id,
            "commandId": event["commandId"],
            "sessionId": event["sessionId"],
            "runId": event["runId"],
            "agent": event["agent"],
            "mode": event["mode"],
            "taskGoal": "",
            "startedAt": now,
        }
        self._write_run({
            **run,
            "status": status,
            "completedAt": now,
            **({"exitCode": exit_code} if exit_code is not None else {}),
            **({"error": error} if error else {}),
        })
        event_type = {"completed": "daemon.command.completed", "failed": "daemon.command.failed", "cancelled": "daemon.command.cancelled"}[status]
        self.append_daemon_event(daemon_event(event_type, {
            "nodeId": node_id,
            "commandId": event["commandId"],
            "runId": event["runId"],
            **({"exitCode": exit_code} if exit_code is not None else {}),
            **({"error": error} if error else {}),
        }))

    def _list_commands(self) -> list[dict[str, Any]]:
        return [_read_json(path) for path in self.commands_dir.glob("*.json")]

    def _get_command(self, command_id: str) -> dict[str, Any] | None:
        path = self.commands_dir / f"{safe_name(command_id)}.json"
        return _read_json(path) if path.exists() else None

    def _get_run(self, run_id: str) -> dict[str, Any] | None:
        path = self.runs_dir / f"{safe_name(run_id)}.json"
        return _read_json(path) if path.exists() else None

    def _write_run(self, run: dict[str, Any]) -> None:
        _write_json(self.runs_dir / f"{safe_name(run['runId'])}.json", run)


class DatabaseDaemonStore:
    metadata = MetaData()

    nodes = Table(
        "daemon_nodes",
        metadata,
        Column("id", Text, primary_key=True),
        Column("employee_id", Text, nullable=False),
        Column("workspace_path", Text, nullable=True),
        Column("status", Text, nullable=False),
        Column("agents", JSON, nullable=False),
        Column("ui_token_hash", Text, nullable=True),
        Column("node_token_hash", Text, nullable=True),
        Column("token_hash", Text, nullable=True),
        Column("last_error", Text, nullable=True),
        Column("created_at", DateTime(timezone=True), nullable=False),
        Column("updated_at", DateTime(timezone=True), nullable=False),
        Column("last_seen_at", DateTime(timezone=True), nullable=True),
    )
    commands = Table(
        "daemon_commands",
        metadata,
        Column("id", Text, primary_key=True),
        Column("node_id", Text, ForeignKey("daemon_nodes.id", ondelete="CASCADE"), nullable=False),
        Column("type", Text, nullable=False),
        Column("status", Text, nullable=False),
        Column("command", JSON, nullable=False),
        Column("exit_code", Integer, nullable=True),
        Column("error", Text, nullable=True),
        Column("created_at", DateTime(timezone=True), nullable=False),
        Column("updated_at", DateTime(timezone=True), nullable=False),
        Column("dispatched_at", DateTime(timezone=True), nullable=True),
        Column("completed_at", DateTime(timezone=True), nullable=True),
    )
    runs = Table(
        "daemon_runs",
        metadata,
        Column("run_id", Text, primary_key=True),
        Column("node_id", Text, ForeignKey("daemon_nodes.id", ondelete="CASCADE"), nullable=False),
        Column("command_id", Text, ForeignKey("daemon_commands.id", ondelete="SET NULL"), nullable=True),
        Column("session_id", Text, nullable=False),
        Column("agent", Text, nullable=False),
        Column("mode", Text, nullable=False),
        Column("task_goal", Text, nullable=False),
        Column("workspace_path", Text, nullable=True),
        Column("status", Text, nullable=False),
        Column("exit_code", Integer, nullable=True),
        Column("error", Text, nullable=True),
        Column("started_at", DateTime(timezone=True), nullable=False),
        Column("completed_at", DateTime(timezone=True), nullable=True),
    )
    events = Table(
        "daemon_events",
        metadata,
        Column("id", Text, primary_key=True),
        Column("node_id", Text, nullable=True),
        Column("command_id", Text, nullable=True),
        Column("run_id", Text, nullable=True),
        Column("type", Text, nullable=False),
        Column("timestamp", DateTime(timezone=True), nullable=False),
        Column("payload", JSON, nullable=False),
    )

    def __init__(self, database_url: str, *, create_schema: bool = False):
        self.engine = create_engine(database_url, future=True)
        if create_schema:
            self.metadata.create_all(self.engine)

    def register_node(self, sandbox: dict[str, Any]) -> dict[str, Any]:
        node = {**sandbox, "token": None, "nodeToken": None}
        values = node_to_row(node)
        with self.engine.begin() as conn:
            existing = conn.scalar(select(self.nodes.c.id).where(self.nodes.c.id == node["id"]))
            if existing:
                conn.execute(update(self.nodes).where(self.nodes.c.id == node["id"]).values(**values))
            else:
                conn.execute(insert(self.nodes).values(**values))
            self._append_daemon_event(conn, daemon_event("daemon.node.registered", {"node": node}))
        return node

    def mark_node_seen(self, node_id: str, patch: dict[str, Any] | None = None) -> dict[str, Any] | None:
        node = self.get_node(node_id)
        if not node:
            return None
        now = now_iso()
        patch = patch or {}
        updated = {**node, **{k: v for k, v in patch.items() if v is not None}, "updatedAt": now, "lastSeenAt": now}
        if patch.get("lastError") is None and "lastError" in patch:
            updated.pop("lastError", None)
        with self.engine.begin() as conn:
            conn.execute(update(self.nodes).where(self.nodes.c.id == node_id).values(**node_to_row(updated)))
            self._append_daemon_event(conn, daemon_event("daemon.node.seen", {"nodeId": node_id, "patch": {**patch, "lastSeenAt": now}}))
        return updated

    def get_node(self, node_id: str) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            row = conn.execute(select(self.nodes).where(self.nodes.c.id == node_id)).mappings().first()
        return row_to_node(row) if row else None

    def list_nodes(self) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = conn.execute(select(self.nodes)).mappings().all()
        return [row_to_node(row) for row in rows]

    def enqueue_command(self, node_id: str, command: dict[str, Any]) -> dict[str, Any]:
        now = now_iso()
        record = {"id": command["id"], "nodeId": node_id, "command": command, "status": "queued", "createdAt": now, "updatedAt": now}
        with self.engine.begin() as conn:
            conn.execute(insert(self.commands).values(**command_to_row(record)))
            if command["type"] == "run.start":
                self._write_run(conn, {
                    "nodeId": node_id,
                    "commandId": command["id"],
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": command["agent"],
                    "mode": command["mode"],
                    "taskGoal": command["taskGoal"],
                    **({"workspacePath": command["workspacePath"]} if command.get("workspacePath") else {}),
                    "status": "running",
                    "startedAt": now,
                })
            self._append_daemon_event(conn, daemon_event("daemon.command.queued", {"nodeId": node_id, "commandId": command["id"]}))
        return record

    def take_queued_commands(self, node_id: str, limit: int = 2**53) -> list[dict[str, Any]]:
        now = now_iso()
        with self.engine.begin() as conn:
            rows = conn.execute(
                select(self.commands)
                .where(self.commands.c.node_id == node_id)
                .where(self.commands.c.status == "queued")
                .order_by(self.commands.c.created_at)
                .limit(limit)
            ).mappings().all()
            result = []
            for row in rows:
                record = row_to_command(row)
                updated = {**record, "status": "dispatched", "updatedAt": now, "dispatchedAt": now}
                if record["command"]["type"] == "run.cancel":
                    updated["status"] = "completed"
                    updated["completedAt"] = now
                conn.execute(update(self.commands).where(self.commands.c.id == record["id"]).values(**command_to_row(updated)))
                self._append_daemon_event(conn, daemon_event("daemon.command.dispatched", {"nodeId": node_id, "commandId": record["id"]}))
                result.append(updated)
        return result

    def queued_command_count(self, node_id: str) -> int:
        with self.engine.begin() as conn:
            return len(conn.execute(select(self.commands.c.id).where(self.commands.c.node_id == node_id).where(self.commands.c.status == "queued")).all())

    def list_active_runs(self, node_id: str | None = None) -> list[dict[str, Any]]:
        statement = select(self.runs).where(self.runs.c.status == "running")
        if node_id is not None:
            statement = statement.where(self.runs.c.node_id == node_id)
        with self.engine.begin() as conn:
            rows = conn.execute(statement).mappings().all()
        return [row_to_run(row) for row in rows]

    def mark_command_completed(self, node_id: str, event: dict[str, Any]) -> None:
        self._mark_command_terminal(node_id, event, "completed", event.get("exitCode"), None)

    def mark_command_failed(self, node_id: str, event: dict[str, Any]) -> None:
        self._mark_command_terminal(node_id, event, "failed", event.get("exitCode"), event.get("error"))

    def mark_command_cancelled(self, node_id: str, event: dict[str, Any]) -> None:
        self._mark_command_terminal(node_id, event, "cancelled", None, event.get("reason"))

    def append_daemon_event(self, event: dict[str, Any]) -> None:
        with self.engine.begin() as conn:
            self._append_daemon_event(conn, event)

    def _mark_command_terminal(self, node_id: str, event: dict[str, Any], status: str, exit_code: int | None, error: str | None) -> None:
        now = now_iso()
        with self.engine.begin() as conn:
            row = conn.execute(select(self.commands).where(self.commands.c.id == event["commandId"])).mappings().first()
            if row:
                command = row_to_command(row)
                conn.execute(update(self.commands).where(self.commands.c.id == command["id"]).values(**command_to_row({
                    **command,
                    "status": status,
                    "updatedAt": now,
                    "completedAt": now,
                    **({"exitCode": exit_code} if exit_code is not None else {}),
                    **({"error": error} if error else {}),
                })))
            run_row = conn.execute(select(self.runs).where(self.runs.c.run_id == event["runId"])).mappings().first()
            run = row_to_run(run_row) if run_row else {
                "nodeId": node_id,
                "commandId": event["commandId"],
                "sessionId": event["sessionId"],
                "runId": event["runId"],
                "agent": event["agent"],
                "mode": event["mode"],
                "taskGoal": "",
                "startedAt": now,
            }
            self._write_run(conn, {
                **run,
                "status": status,
                "completedAt": now,
                **({"exitCode": exit_code} if exit_code is not None else {}),
                **({"error": error} if error else {}),
            })
            event_type = {"completed": "daemon.command.completed", "failed": "daemon.command.failed", "cancelled": "daemon.command.cancelled"}[status]
            self._append_daemon_event(conn, daemon_event(event_type, {
                "nodeId": node_id,
                "commandId": event["commandId"],
                "runId": event["runId"],
                **({"exitCode": exit_code} if exit_code is not None else {}),
                **({"error": error} if error else {}),
            }))

    def _write_run(self, conn: Any, run: dict[str, Any]) -> None:
        values = run_to_row(run)
        existing = conn.scalar(select(self.runs.c.run_id).where(self.runs.c.run_id == run["runId"]))
        if existing:
            conn.execute(update(self.runs).where(self.runs.c.run_id == run["runId"]).values(**values))
        else:
            conn.execute(insert(self.runs).values(**values))

    def _append_daemon_event(self, conn: Any, event: dict[str, Any]) -> None:
        conn.execute(insert(self.events).values(**daemon_event_to_row(event)))


def session_to_row(session: dict[str, Any], *, version: int) -> dict[str, Any]:
    return {
        "id": session["id"],
        "workspace_path": session["workspacePath"],
        "owner_employee_id": session.get("ownerEmployeeId"),
        "task_goal": session["taskGoal"],
        "participants": session.get("participants") or [],
        "status": session["status"],
        "phase": session["phase"],
        "pending_decision": session.get("pendingDecision"),
        "current_agent": session.get("currentAgent"),
        "review_verdict": session.get("reviewVerdict"),
        "final_outcome": session.get("finalOutcome"),
        "snapshot": session,
        "version": version,
        "created_at": _parse_iso(session["createdAt"]),
        "updated_at": _parse_iso(session["updatedAt"]),
    }


def session_event_to_row(session_id: str, sequence: int, event: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": event["id"],
        "session_id": session_id,
        "sequence": sequence,
        "type": event["type"],
        "timestamp": _parse_iso(event["timestamp"]),
        "payload": event,
    }


def session_artifact_to_row(session_id: str, artifact: dict[str, Any], metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": artifact["id"],
        "session_id": session_id,
        "agent_run_id": artifact.get("agentRunId"),
        "kind": artifact["kind"],
        "title": artifact["title"],
        "path": artifact.get("path"),
        "content_type": artifact.get("contentType"),
        "byte_size": artifact.get("bytes", 0),
        "metadata": metadata or {},
        "created_at": _parse_iso(artifact["createdAt"]),
    }


def task_to_row(task: dict[str, Any], *, version: int) -> dict[str, Any]:
    return {
        "id": task["id"],
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


def task_event_to_row(task_id: str, sequence: int, event: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": event["id"],
        "task_id": task_id,
        "sequence": sequence,
        "type": event["type"],
        "timestamp": _parse_iso(event["timestamp"]),
        "payload": event,
    }


def node_to_row(node: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": node["id"],
        "employee_id": node["employeeId"],
        "workspace_path": node.get("workspacePath"),
        "status": node["status"],
        "agents": node.get("agents") or {},
        "ui_token_hash": node.get("uiTokenHash"),
        "node_token_hash": node.get("nodeTokenHash"),
        "token_hash": node.get("tokenHash"),
        "last_error": node.get("lastError"),
        "created_at": _parse_iso(node["createdAt"]),
        "updated_at": _parse_iso(node["updatedAt"]),
        "last_seen_at": _parse_iso(node.get("lastSeenAt")),
    }


def row_to_node(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "employeeId": row["employee_id"],
        **({"workspacePath": row["workspace_path"]} if row.get("workspace_path") else {}),
        "status": row["status"],
        "agents": row["agents"] or {},
        "token": None,
        **({"tokenHash": row["token_hash"]} if row.get("token_hash") else {}),
        **({"uiTokenHash": row["ui_token_hash"]} if row.get("ui_token_hash") else {}),
        **({"nodeTokenHash": row["node_token_hash"]} if row.get("node_token_hash") else {}),
        **({"lastError": row["last_error"]} if row.get("last_error") else {}),
        "createdAt": _format_iso(row["created_at"]),
        "updatedAt": _format_iso(row["updated_at"]),
        **({"lastSeenAt": _format_iso(row["last_seen_at"])} if row.get("last_seen_at") else {}),
    }


def command_to_row(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": record["id"],
        "node_id": record["nodeId"],
        "type": record["command"]["type"],
        "status": record["status"],
        "command": record["command"],
        "exit_code": record.get("exitCode"),
        "error": record.get("error"),
        "created_at": _parse_iso(record["createdAt"]),
        "updated_at": _parse_iso(record["updatedAt"]),
        "dispatched_at": _parse_iso(record.get("dispatchedAt")),
        "completed_at": _parse_iso(record.get("completedAt")),
    }


def row_to_command(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "nodeId": row["node_id"],
        "command": row["command"],
        "status": row["status"],
        "createdAt": _format_iso(row["created_at"]),
        "updatedAt": _format_iso(row["updated_at"]),
        **({"dispatchedAt": _format_iso(row["dispatched_at"])} if row.get("dispatched_at") else {}),
        **({"completedAt": _format_iso(row["completed_at"])} if row.get("completed_at") else {}),
        **({"exitCode": row["exit_code"]} if row.get("exit_code") is not None else {}),
        **({"error": row["error"]} if row.get("error") else {}),
    }


def run_to_row(run: dict[str, Any]) -> dict[str, Any]:
    return {
        "run_id": run["runId"],
        "node_id": run["nodeId"],
        "command_id": run.get("commandId"),
        "session_id": run["sessionId"],
        "agent": run["agent"],
        "mode": run["mode"],
        "task_goal": run["taskGoal"],
        "workspace_path": run.get("workspacePath"),
        "status": run["status"],
        "exit_code": run.get("exitCode"),
        "error": run.get("error"),
        "started_at": _parse_iso(run["startedAt"]),
        "completed_at": _parse_iso(run.get("completedAt")),
    }


def row_to_run(row: Any) -> dict[str, Any]:
    return {
        "nodeId": row["node_id"],
        **({"commandId": row["command_id"]} if row.get("command_id") else {}),
        "sessionId": row["session_id"],
        "runId": row["run_id"],
        "agent": row["agent"],
        "mode": row["mode"],
        "taskGoal": row["task_goal"],
        **({"workspacePath": row["workspace_path"]} if row.get("workspace_path") else {}),
        "status": row["status"],
        **({"exitCode": row["exit_code"]} if row.get("exit_code") is not None else {}),
        **({"error": row["error"]} if row.get("error") else {}),
        "startedAt": _format_iso(row["started_at"]),
        **({"completedAt": _format_iso(row["completed_at"])} if row.get("completed_at") else {}),
    }


def daemon_event_to_row(event: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": event["id"],
        "node_id": event.get("nodeId"),
        "command_id": event.get("commandId"),
        "run_id": event.get("runId"),
        "type": event["type"],
        "timestamp": _parse_iso(event["timestamp"]),
        "payload": event,
    }


def daemon_event(event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"id": new_relay_id("devt"), "type": event_type, "timestamp": now_iso(), **payload}


def safe_name(value: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in value)
    return safe or "relay"


def role_for_agent(agent: str, mode: str = "implement") -> str:
    if mode == "review":
        return "reviewer"
    return {"claude": "implementer", "pi": "tester", "codex": "fixer", "kimi": "implementer"}.get(agent, "implementer")


def valid_agent(value: Any) -> AgentName | None:
    return value if value in AGENT_NAMES else None


def task_priority(value: Any) -> TaskPriority | None:
    return value if value in ("low", "normal", "high") else None


def task_status(value: Any) -> TaskStatus | None:
    return value if value in ("backlog", "assigned", "running", "waiting_for_human", "review", "done", "blocked") else None
