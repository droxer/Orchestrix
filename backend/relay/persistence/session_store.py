from __future__ import annotations

import base64
import json
import time
from threading import RLock
from pathlib import Path
from typing import Any

from loguru import logger
from sqlalchemy import BigInteger, JSON, Column, DateTime, ForeignKey, MetaData, Table, Text, Uuid, create_engine, delete, insert, select, update
from sqlalchemy.exc import IntegrityError

from .store_common import (
    DEFAULT_RELAY_DATA_DIR,
    _append_jsonl,
    _format_iso,
    _parse_iso,
    _read_json,
    _read_jsonl,
    _write_json,
    database_id_column,
    materialize_events,
    new_database_id,
    new_relay_id,
    now_iso,
    relay_event,
    safe_name,
)

class LocalSessionStore:
    def __init__(self, root_dir: str | Path = DEFAULT_RELAY_DATA_DIR):
        self.root_dir = Path(root_dir)
        self.sessions_dir = self.root_dir / "sessions"
        self._lock = RLock()
        self.sessions_dir.mkdir(parents=True, exist_ok=True)

    def create_session(self, input: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
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
        with self._lock:
            self._session_dir(session_id).mkdir(parents=True, exist_ok=True)
            _append_jsonl(self._events_path(session_id), event)
            logger.debug("Session event appended", session_id=session_id, event_type=event.get("type"))
            if self._snapshot_path(session_id).exists():
                events = [*_read_json(self._snapshot_path(session_id)).get("events", []), event]
            else:
                events = _read_jsonl(self._events_path(session_id))
            session = materialize_events(events)
            _write_json(self._snapshot_path(session_id), session)
            return session

    def get_session(self, session_id: str) -> dict[str, Any]:
        with self._lock:
            if self._snapshot_path(session_id).exists():
                return _read_json(self._snapshot_path(session_id))
            return materialize_events(_read_jsonl(self._events_path(session_id)))

    def list_sessions(self) -> list[dict[str, Any]]:
        if not self.sessions_dir.exists():
            return []
        sessions = [self.get_session(path.name) for path in self.sessions_dir.iterdir() if path.is_dir()]
        return sorted(sessions, key=lambda item: item["updatedAt"], reverse=True)

    def write_artifact(self, session_id: str, input: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
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

    def create_artifact(self, session_id: str, input: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        with self._lock:
            artifact = self.write_artifact(session_id, input)
            event = relay_event("artifact.created", session_id, {"artifact": artifact})
            try:
                session = self.append_event(session_id, event)
            except Exception:
                Path(artifact["path"]).unlink(missing_ok=True)
                raise
            return artifact, session

    def index_workspace_artifact(self, session_id: str, artifact: dict[str, Any], content: bytes | None) -> tuple[dict[str, Any], dict[str, Any]]:
        """Record a generated workspace file, keeping a content snapshot when available.

        The artifact's ``path`` points at the live workspace file; the snapshot
        copy under the session's artifact directory keeps the artifact servable
        after the workspace copy is rewritten or deleted.
        """
        with self._lock:
            snapshot_path: Path | None = None
            if content is not None:
                artifact_dir = self._session_dir(session_id) / "artifacts"
                artifact_dir.mkdir(parents=True, exist_ok=True)
                snapshot_path = artifact_dir / f"{artifact['id']}.{artifact_snapshot_extension(artifact.get('title'))}"
                snapshot_path.write_bytes(content)
                artifact = {**artifact, "snapshotPath": str(snapshot_path), "bytes": len(content)}
            try:
                session = self.append_event(session_id, relay_event("artifact.created", session_id, {"artifact": artifact}))
            except Exception:
                if snapshot_path is not None:
                    snapshot_path.unlink(missing_ok=True)
                raise
            logger.debug("Workspace artifact indexed", session_id=session_id, artifact_id=artifact["id"], snapshot=snapshot_path is not None)
            return artifact, session

    def read_artifact_content(self, session_id: str, artifact_id: str) -> bytes | None:
        """Return the stored snapshot bytes for an artifact, if one was kept."""
        for artifact in self.get_session(session_id).get("artifacts", []):
            if artifact["id"] != artifact_id:
                continue
            snapshot_path = artifact.get("snapshotPath")
            if snapshot_path:
                try:
                    return Path(snapshot_path).read_bytes()
                except OSError:
                    return None
            return None
        return None

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
        database_id_column(),
        Column("public_id", Text, nullable=False, unique=True),
        Column("workspace_path", Text, nullable=False),
        Column("owner_employee_id", Text, nullable=True),
        Column("title", Text, nullable=True),
        Column("task_goal", Text, nullable=False),
        Column("participants", JSON, nullable=False),
        Column("status", Text, nullable=False),
        Column("phase", Text, nullable=False),
        Column("pending_decision", Text, nullable=True),
        Column("current_agent", Text, nullable=True),
        Column("final_outcome", JSON, nullable=True),
        Column("snapshot", JSON, nullable=False),
        Column("version", BigInteger, nullable=False),
        Column("created_at", DateTime(timezone=True), nullable=False),
        Column("updated_at", DateTime(timezone=True), nullable=False),
    )
    events = Table(
        "session_events",
        metadata,
        database_id_column(),
        Column("public_id", Text, nullable=False, unique=True),
        Column("session_id", Uuid(as_uuid=False), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        Column("sequence", BigInteger, nullable=False),
        Column("type", Text, nullable=False),
        Column("timestamp", DateTime(timezone=True), nullable=False),
        Column("payload", JSON, nullable=False),
    )
    artifacts = Table(
        "session_artifacts",
        metadata,
        database_id_column(),
        Column("public_id", Text, nullable=False, unique=True),
        Column("session_id", Uuid(as_uuid=False), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        Column("agent_run_id", Text, nullable=True),
        Column("kind", Text, nullable=False),
        Column("title", Text, nullable=False),
        Column("path", Text, nullable=True),
        Column("content", Text, nullable=True),
        Column("content_type", Text, nullable=True),
        Column("byte_size", BigInteger, nullable=False),
        Column("metadata", JSON, nullable=False),
        Column("created_at", DateTime(timezone=True), nullable=False),
    )
    token_usage = Table(
        "session_token_usage",
        metadata,
        database_id_column(),
        Column("session_id", Uuid(as_uuid=False), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, unique=True),
        Column("session_public_id", Text, nullable=False, unique=True),
        Column("owner_employee_id", Text, nullable=True),
        Column("input_tokens", BigInteger, nullable=False),
        Column("output_tokens", BigInteger, nullable=False),
        Column("cache_tokens", BigInteger, nullable=False),
        Column("total_tokens", BigInteger, nullable=False),
        Column("updated_at", DateTime(timezone=True), nullable=False),
    )

    def __init__(self, database_url: str, root_dir: str | Path | None = None, *, create_schema: bool = False):
        self.engine = create_engine(database_url, future=True)
        self.root_dir = Path(root_dir) if root_dir is not None else None
        self.artifacts_dir = self.root_dir / "session-artifacts" if self.root_dir is not None else None
        if self.artifacts_dir is not None:
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
            session_row = session_to_row(session, version=len(events))
            conn.execute(insert(self.sessions).values(**session_row))
            for sequence, event in enumerate(events):
                conn.execute(insert(self.events).values(**session_event_to_row(session_row["id"], sequence, event)))
        return session

    def append_event(self, session_id: str, event: dict[str, Any]) -> dict[str, Any]:
        for attempt in range(3):
            try:
                return self._append_event_once(session_id, event)
            except IntegrityError:
                if attempt == 2:
                    raise
                time.sleep(0.01 * (attempt + 1))
        raise RuntimeError("unreachable")

    def _append_event_once(self, session_id: str, event: dict[str, Any]) -> dict[str, Any]:
        with self.engine.begin() as conn:
            row = conn.execute(
                select(self.sessions.c.id, self.sessions.c.snapshot, self.sessions.c.version)
                .where(self.sessions.c.public_id == session_id)
                .with_for_update()
            ).mappings().first()
            if not row:
                raise KeyError(session_id)
            session_pk = row["id"]
            sequence = int(row["version"] or 0)
            conn.execute(insert(self.events).values(**session_event_to_row(session_pk, sequence, event)))
            session = materialize_events([*(row["snapshot"] or {}).get("events", []), event])
            conn.execute(update(self.sessions).where(self.sessions.c.id == session_pk).values(**session_to_row(session, version=sequence + 1, database_id=session_pk)))
            self._sync_token_usage(conn, session_pk, session)
        logger.debug("Database session event appended", session_id=session_id, event_type=event.get("type"))
        return session

    def get_session(self, session_id: str) -> dict[str, Any]:
        with self.engine.begin() as conn:
            row = conn.execute(select(self.sessions.c.snapshot).where(self.sessions.c.public_id == session_id)).mappings().first()
            if not row:
                raise KeyError(session_id)
        return row["snapshot"]

    def list_sessions(self) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = conn.execute(select(self.sessions.c.snapshot).order_by(self.sessions.c.updated_at.desc())).mappings().all()
        return [row["snapshot"] for row in rows]

    def list_token_usage(self) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = conn.execute(
                select(self.token_usage, self.sessions.c.task_goal)
                .select_from(self.token_usage.join(self.sessions, self.token_usage.c.session_id == self.sessions.c.id))
                .order_by(self.token_usage.c.updated_at.desc())
            ).mappings().all()
        return [
            {
                "sessionId": row["session_public_id"],
                "ownerEmployeeId": row["owner_employee_id"],
                "taskGoal": row["task_goal"],
                "input": int(row["input_tokens"] or 0),
                "output": int(row["output_tokens"] or 0),
                "cache": int(row["cache_tokens"] or 0),
                "total": int(row["total_tokens"] or 0),
                "updatedAt": _format_iso(row["updated_at"]),
            }
            for row in rows
        ]

    def _new_artifact_record(self, session_id: str, input: dict[str, Any]) -> tuple[dict[str, Any], str, str]:
        artifact_id = new_relay_id("art")
        extension = input.get("extension") or "txt"
        body = input["body"]
        artifact = {
            "id": artifact_id,
            "kind": input["kind"],
            "title": input["title"],
            "path": database_artifact_uri(session_id, artifact_id, extension),
            "createdAt": now_iso(),
            **({"agentRunId": input["agentRunId"]} if input.get("agentRunId") else {}),
            "bytes": len(body.encode("utf-8")),
        }
        return artifact, extension, body

    def write_artifact(self, session_id: str, input: dict[str, Any]) -> dict[str, Any]:
        if not self.get_session(session_id):
            raise KeyError(session_id)
        artifact, extension, body = self._new_artifact_record(session_id, input)
        with self.engine.begin() as conn:
            session_pk = self._session_pk(conn, session_id)
            conn.execute(insert(self.artifacts).values(**session_artifact_to_row(session_pk, artifact, {"extension": extension}, content=body)))
        logger.debug("Database artifact written", session_id=session_id, artifact_id=artifact["id"], kind=input.get("kind"), bytes=artifact["bytes"])
        return artifact

    def create_artifact(self, session_id: str, input: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        artifact, extension, body = self._new_artifact_record(session_id, input)
        session = self._insert_artifact_with_event(session_id, artifact, {"extension": extension}, content=body)
        logger.debug("Database artifact created", session_id=session_id, artifact_id=artifact["id"], kind=input.get("kind"), bytes=artifact["bytes"])
        return artifact, session

    def index_workspace_artifact(self, session_id: str, artifact: dict[str, Any], content: bytes | None) -> tuple[dict[str, Any], dict[str, Any]]:
        """Record a generated workspace file with an optional content snapshot.

        Binary content goes into the artifacts table base64-encoded so the
        backend can serve it without access to the daemon's filesystem.
        """
        metadata: dict[str, Any] = {"extension": artifact_snapshot_extension(artifact.get("title"))}
        encoded: str | None = None
        if content is not None:
            encoded = base64.b64encode(content).decode("ascii")
            metadata["contentEncoding"] = "base64"
            artifact = {**artifact, "bytes": len(content)}
        session = self._insert_artifact_with_event(session_id, artifact, metadata, content=encoded)
        logger.debug("Database workspace artifact indexed", session_id=session_id, artifact_id=artifact["id"], snapshot=content is not None)
        return artifact, session

    def _insert_artifact_with_event(self, session_id: str, artifact: dict[str, Any], metadata: dict[str, Any], *, content: str | None) -> dict[str, Any]:
        event = relay_event("artifact.created", session_id, {"artifact": artifact})
        with self.engine.begin() as conn:
            row = conn.execute(
                select(self.sessions.c.id, self.sessions.c.snapshot, self.sessions.c.version)
                .where(self.sessions.c.public_id == session_id)
                .with_for_update()
            ).mappings().first()
            if not row:
                raise KeyError(session_id)
            session_pk = row["id"]
            sequence = int(row["version"] or 0)
            conn.execute(insert(self.artifacts).values(**session_artifact_to_row(session_pk, artifact, metadata, content=content)))
            conn.execute(insert(self.events).values(**session_event_to_row(session_pk, sequence, event)))
            session = materialize_events([*(row["snapshot"] or {}).get("events", []), event])
            conn.execute(update(self.sessions).where(self.sessions.c.id == session_pk).values(**session_to_row(session, version=sequence + 1, database_id=session_pk)))
            self._sync_token_usage(conn, session_pk, session)
        return session

    def read_artifact_content(self, session_id: str, artifact_id: str) -> bytes | None:
        """Return the stored snapshot bytes for an artifact, if one was kept."""
        with self.engine.begin() as conn:
            session_pk = self._session_pk(conn, session_id)
            row = conn.execute(
                select(self.artifacts.c.content, self.artifacts.c.metadata)
                .where(self.artifacts.c.session_id == session_pk)
                .where(self.artifacts.c.public_id == artifact_id)
            ).mappings().first()
        if not row or row["content"] is None:
            return None
        if (row["metadata"] or {}).get("contentEncoding") == "base64":
            try:
                return base64.b64decode(row["content"], validate=True)
            except (ValueError, TypeError):
                return None
        return str(row["content"]).encode("utf-8")

    def artifact_path(self, session_id: str, artifact_id: str) -> Path:
        with self.engine.begin() as conn:
            session_pk = self._session_pk(conn, session_id)
            row = conn.execute(
                select(self.artifacts.c.path)
                .where(self.artifacts.c.session_id == session_pk)
                .where(self.artifacts.c.public_id == artifact_id)
            ).mappings().first()
        if row and row["path"]:
            return Path(row["path"])
        for artifact in self.get_session(session_id).get("artifacts", []):
            if artifact["id"] == artifact_id:
                return Path(artifact["path"])
        raise KeyError(f"Unknown artifact {artifact_id} in session {session_id}.")

    def read_artifact(self, session_id: str, artifact_id: str) -> str:
        with self.engine.begin() as conn:
            session_pk = self._session_pk(conn, session_id)
            row = conn.execute(
                select(self.artifacts.c.content, self.artifacts.c.path)
                .where(self.artifacts.c.session_id == session_pk)
                .where(self.artifacts.c.public_id == artifact_id)
            ).mappings().first()
        if row and row["content"] is not None:
            return row["content"]
        if row and row["path"]:
            return Path(row["path"]).read_text(encoding="utf-8")
        raise KeyError(f"Unknown artifact {artifact_id} in session {session_id}.")

    def _session_pk(self, conn: Any, session_id: str, *, lock: bool = False) -> str:
        statement = select(self.sessions.c.id).where(self.sessions.c.public_id == session_id)
        if lock:
            statement = statement.with_for_update()
        session_pk = conn.scalar(statement)
        if not session_pk:
            raise KeyError(session_id)
        return session_pk

    def _events_for_session(self, conn: Any, session_pk: str) -> list[dict[str, Any]]:
        rows = conn.execute(
            select(self.events.c.payload)
            .where(self.events.c.session_id == session_pk)
            .order_by(self.events.c.sequence)
        ).mappings().all()
        return [row["payload"] for row in rows]

    def _sync_token_usage(self, conn: Any, session_pk: str, session: dict[str, Any]) -> None:
        row = session_token_usage_to_row(session_pk, session)
        existing_id = conn.scalar(select(self.token_usage.c.id).where(self.token_usage.c.session_id == session_pk))
        if row:
            if existing_id:
                conn.execute(update(self.token_usage).where(self.token_usage.c.id == existing_id).values({**row, "id": existing_id}))
            else:
                conn.execute(insert(self.token_usage).values(**row))
        elif existing_id:
            conn.execute(delete(self.token_usage).where(self.token_usage.c.id == existing_id))



def session_to_row(session: dict[str, Any], *, version: int, database_id: str | None = None) -> dict[str, Any]:
    return {
        "id": database_id or new_database_id(),
        "public_id": session["id"],
        "workspace_path": session["workspacePath"],
        "owner_employee_id": session.get("ownerEmployeeId"),
        "title": session.get("title"),
        "task_goal": session["taskGoal"],
        "participants": session.get("participants") or [],
        "status": session["status"],
        "phase": session["phase"],
        "pending_decision": session.get("pendingDecision"),
        "current_agent": session.get("currentAgent"),
        "final_outcome": session.get("finalOutcome"),
        "snapshot": session,
        "version": version,
        "created_at": _parse_iso(session["createdAt"]),
        "updated_at": _parse_iso(session["updatedAt"]),
    }


def session_event_to_row(session_pk: str, sequence: int, event: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": new_database_id(),
        "public_id": event["id"],
        "session_id": session_pk,
        "sequence": sequence,
        "type": event["type"],
        "timestamp": _parse_iso(event["timestamp"]),
        "payload": event,
    }


def database_artifact_uri(session_id: str, artifact_id: str, extension: str) -> str:
    return f"db://relay/sessions/{safe_name(session_id)}/artifacts/{safe_name(artifact_id)}.{safe_name(extension)}"


def artifact_snapshot_extension(title: Any) -> str:
    """Derive a safe file extension for a workspace-artifact snapshot copy."""
    suffix = Path(str(title or "")).suffix.lstrip(".").lower()
    cleaned = "".join(ch for ch in suffix if ch.isalnum())
    return cleaned or "bin"


def session_artifact_to_row(session_pk: str, artifact: dict[str, Any], metadata: dict[str, Any] | None = None, *, content: str | None = None) -> dict[str, Any]:
    return {
        "id": new_database_id(),
        "public_id": artifact["id"],
        "session_id": session_pk,
        "agent_run_id": artifact.get("agentRunId"),
        "kind": artifact["kind"],
        "title": artifact["title"],
        "path": artifact.get("path"),
        "content": content,
        "content_type": artifact.get("contentType"),
        "byte_size": artifact.get("bytes", 0),
        "metadata": metadata or {},
        "created_at": _parse_iso(artifact["createdAt"]),
    }


def session_token_usage_to_row(session_pk: str, session: dict[str, Any]) -> dict[str, Any] | None:
    usage = session.get("tokenUsage")
    if not isinstance(usage, dict) or not int(usage.get("total") or 0):
        return None
    return {
        "id": new_database_id(),
        "session_id": session_pk,
        "session_public_id": session["id"],
        "owner_employee_id": session.get("ownerEmployeeId"),
        "input_tokens": int(usage.get("input") or 0),
        "output_tokens": int(usage.get("output") or 0),
        "cache_tokens": int(usage.get("cache") or 0),
        "total_tokens": int(usage.get("total") or 0),
        "updated_at": _parse_iso(session["updatedAt"]),
    }
