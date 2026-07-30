from __future__ import annotations

import base64
import json
import shutil
import time
from pathlib import Path
from threading import RLock
from typing import Any

from loguru import logger
from sqlalchemy import (
    JSON,
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Table,
    Text,
    UniqueConstraint,
    delete,
    insert,
    inspect,
    select,
    text,
    update,
)
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
    entity_uuid_type,
    create_all_tables,
    json_type,
    shared_engine,
    store_transaction,
    metadata as shared_metadata,
    materialize_events,
    new_database_id,
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

    def create_session(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            session_id = new_database_id()
            (self._session_dir(session_id) / "artifacts").mkdir(
                parents=True, exist_ok=True
            )
            logger.debug(
                "Creating session",
                session_id=session_id,
                workspace_path=payload.get("workspacePath"),
            )
            event = relay_event(
                "session.created",
                session_id,
                {
                    "workspacePath": payload["workspacePath"],
                    **(
                        {"ownerEmployeeId": payload["ownerEmployeeId"]}
                        if payload.get("ownerEmployeeId")
                        else {}
                    ),
                    **(
                        {"ownerAgentId": payload["ownerAgentId"]}
                        if payload.get("ownerAgentId")
                        else {}
                    ),
                    **({"teamId": payload["teamId"]} if payload.get("teamId") else {}),
                    **(
                        {"daemonNodeId": payload["daemonNodeId"]}
                        if payload.get("daemonNodeId")
                        else {}
                    ),
                    **(
                        {"managedNodeId": payload["managedNodeId"]}
                        if payload.get("managedNodeId")
                        else {}
                    ),
                    "taskGoal": payload["taskGoal"],
                    "participants": payload.get("participants", ["human"]),
                },
            )
            events = [event]
            if payload.get("status") or payload.get("pendingDecision"):
                events.append(
                    relay_event(
                        "session.status",
                        session_id,
                        {
                            "status": payload.get("status", "running"),
                            "phase": f"waiting:{payload['pendingDecision']}"
                            if payload.get("pendingDecision")
                            else "created",
                            **(
                                {"pendingDecision": payload["pendingDecision"]}
                                if payload.get("pendingDecision")
                                else {}
                            ),
                        },
                    )
                )
            session = materialize_events(events)
            self._events_path(session_id).write_text(
                "".join(
                    json.dumps(item, separators=(",", ":")) + "\n" for item in events
                ),
                encoding="utf-8",
            )
            _write_json(self._snapshot_path(session_id), session)
            return session

    def append_event(self, session_id: str, event: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            if self._tombstone_path(session_id).exists():
                raise KeyError(session_id)
            self._session_dir(session_id).mkdir(parents=True, exist_ok=True)
            _append_jsonl(self._events_path(session_id), event)
            logger.debug(
                "Session event appended",
                session_id=session_id,
                event_type=event.get("type"),
            )
            if self._snapshot_path(session_id).exists():
                events = [
                    *_read_json(self._snapshot_path(session_id)).get("events", []),
                    event,
                ]
            else:
                events = _read_jsonl(self._events_path(session_id))
            session = materialize_events(events)
            _write_json(self._snapshot_path(session_id), session)
            return session

    def get_session(self, session_id: str) -> dict[str, Any]:
        with self._lock:
            if self._tombstone_path(session_id).exists():
                raise KeyError(session_id)
            if self._snapshot_path(session_id).exists():
                return _read_json(self._snapshot_path(session_id))
            return materialize_events(_read_jsonl(self._events_path(session_id)))

    def delete_session(self, session_id: str, *, deleted_by: str | None = None) -> None:
        with self._lock:
            session_dir = self._session_dir(session_id)
            if not session_dir.is_dir():
                raise KeyError(session_id)
            snapshot = self.get_session(session_id)
            # Retain per-run token usage so dashboard history survives the
            # deletion of the originating thread.
            for row in session_run_token_usage_rows(snapshot):
                _append_jsonl(self._token_usage_ledger_path(), row)
            _write_json(
                self._tombstone_path(session_id),
                {
                    "id": session_id,
                    "taskGoal": snapshot.get("taskGoal"),
                    "title": snapshot.get("title"),
                    "ownerEmployeeId": snapshot.get("ownerEmployeeId"),
                    "deletedBy": deleted_by,
                    "deletedAt": now_iso(),
                },
            )
            shutil.rmtree(session_dir)

    def list_sessions(self) -> list[dict[str, Any]]:
        if not self.sessions_dir.exists():
            return []
        sessions = [
            self.get_session(path.name)
            for path in self.sessions_dir.iterdir()
            if path.is_dir()
        ]
        return sorted(sessions, key=lambda item: item["updatedAt"], reverse=True)

    def list_token_usage(self) -> list[dict[str, Any]]:
        rows = [
            row
            for session in self.list_sessions()
            for row in session_run_token_usage_rows(session)
        ]
        seen = {(row["sessionId"], row["runId"]) for row in rows}
        ledger_path = self._token_usage_ledger_path()
        if ledger_path.exists():
            for row in _read_jsonl(ledger_path):
                key = (row.get("sessionId"), row.get("runId"))
                if key in seen:
                    continue
                seen.add(key)
                rows.append(row)
        return sorted(rows, key=lambda item: item["completedAt"], reverse=True)

    def write_artifact(
        self, session_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        with self._lock:
            artifact_id = new_database_id()
            extension = payload.get("extension") or "txt"
            artifact_dir = self._session_dir(session_id) / "artifacts"
            artifact_dir.mkdir(parents=True, exist_ok=True)
            path = artifact_dir / f"{artifact_id}.{extension}"
            body = payload["body"]
            path.write_text(body, encoding="utf-8")
            logger.debug(
                "Artifact written",
                session_id=session_id,
                artifact_id=artifact_id,
                kind=payload.get("kind"),
                bytes=len(body.encode("utf-8")),
            )
            return {
                "id": artifact_id,
                "kind": payload["kind"],
                "title": payload["title"],
                "path": str(path),
                "createdAt": now_iso(),
                **(
                    {"agentRunId": payload["agentRunId"]}
                    if payload.get("agentRunId")
                    else {}
                ),
                "bytes": len(body.encode("utf-8")),
            }

    def create_artifact(
        self, session_id: str, payload: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        with self._lock:
            artifact = self.write_artifact(session_id, payload)
            event = relay_event("artifact.created", session_id, {"artifact": artifact})
            try:
                session = self.append_event(session_id, event)
            except Exception:
                Path(artifact["path"]).unlink(missing_ok=True)
                raise
            return artifact, session

    def index_workspace_artifact(
        self, session_id: str, artifact: dict[str, Any], content: bytes | None
    ) -> tuple[dict[str, Any], dict[str, Any]]:
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
                snapshot_path = (
                    artifact_dir
                    / f"{artifact['id']}.{artifact_snapshot_extension(artifact.get('title'))}"
                )
                snapshot_path.write_bytes(content)
                artifact = {
                    **artifact,
                    "snapshotPath": str(snapshot_path),
                    "bytes": len(content),
                }
            try:
                session = self.append_event(
                    session_id,
                    relay_event("artifact.created", session_id, {"artifact": artifact}),
                )
            except Exception:
                if snapshot_path is not None:
                    snapshot_path.unlink(missing_ok=True)
                raise
            logger.debug(
                "Workspace artifact indexed",
                session_id=session_id,
                artifact_id=artifact["id"],
                snapshot=snapshot_path is not None,
            )
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

    def _tombstone_path(self, session_id: str) -> Path:
        return self.sessions_dir / f"{Path(session_id).name}.deleted.json"

    def _token_usage_ledger_path(self) -> Path:
        return self.sessions_dir / "token-usage.jsonl"


class DatabaseSessionStore:
    REQUIRED_SCHEMA_REVISION = "20260729_0043"
    metadata = shared_metadata

    sessions = Table(
        "sessions",
        metadata,
        database_id_column(),
        Column("workspace_path", Text, nullable=False),
        Column("owner_employee_id", entity_uuid_type(), nullable=True),
        Column("title", Text, nullable=True),
        Column("task_goal", Text, nullable=False),
        Column("participants", json_type(), nullable=False),
        Column("status", Text, nullable=False),
        Column("phase", Text, nullable=False),
        Column("pending_decision", Text, nullable=True),
        Column("current_agent", Text, nullable=True),
        Column("final_outcome", json_type(), nullable=True),
        Column("snapshot", json_type(), nullable=False),
        Column("version", BigInteger, nullable=False),
        Column("created_at", DateTime(timezone=True), nullable=False),
        Column("updated_at", DateTime(timezone=True), nullable=False),
        Index("ix_sessions_updated_at", "updated_at"),
        Index("ix_sessions_owner_employee_id", "owner_employee_id"),
        Index("ix_sessions_status", "status"),
    )
    events = Table(
        "session_events",
        metadata,
        database_id_column(),
        Column(
            "session_id",
            entity_uuid_type(),
            ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        Column("sequence", BigInteger, nullable=False),
        Column("type", Text, nullable=False),
        Column("timestamp", DateTime(timezone=True), nullable=False),
        Column("payload", json_type(), nullable=False),
        UniqueConstraint(
            "session_id", "sequence", name="uq_session_events_session_sequence"
        ),
        Index("ix_session_events_session_id", "session_id"),
        Index("ix_session_events_timestamp", "timestamp"),
    )
    artifacts = Table(
        "session_artifacts",
        metadata,
        database_id_column(),
        Column(
            "session_id",
            entity_uuid_type(),
            ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        Column("agent_run_id", Text, nullable=True),
        Column("kind", Text, nullable=False),
        Column("title", Text, nullable=False),
        Column("path", Text, nullable=True),
        Column("content", Text, nullable=True),
        Column("content_type", Text, nullable=True),
        Column("byte_size", BigInteger, nullable=False),
        Column("metadata", json_type(), nullable=False),
        Column("created_at", DateTime(timezone=True), nullable=False),
        Index("ix_session_artifacts_session_id", "session_id"),
    )
    run_token_usage = Table(
        "session_run_token_usage",
        metadata,
        database_id_column(),
        # No FK to sessions: rows are retained after the originating thread
        # is permanently deleted so token-usage history survives.
        Column("session_id", entity_uuid_type(), nullable=False),
        Column("run_id", Text, nullable=False),
        Column("owner_employee_id", entity_uuid_type(), nullable=True),
        Column("task_goal", Text, nullable=True),
        Column("input_tokens", BigInteger, nullable=False),
        Column("output_tokens", BigInteger, nullable=False),
        Column("cache_tokens", BigInteger, nullable=False),
        Column("total_tokens", BigInteger, nullable=False),
        Column("completed_at", DateTime(timezone=True), nullable=False),
        UniqueConstraint(
            "session_id", "run_id", name="uq_session_run_token_usage_session_run"
        ),
        Index("ix_session_run_token_usage_completed_at", "completed_at"),
        Index("ix_session_run_token_usage_owner_employee_id", "owner_employee_id"),
    )
    tombstones = Table(
        "session_tombstones",
        metadata,
        database_id_column(),
        Column("session_id", entity_uuid_type(), nullable=False),
        Column("task_goal", Text, nullable=False),
        Column("title", Text, nullable=True),
        Column("owner_employee_id", entity_uuid_type(), nullable=True),
        Column("deleted_by", Text, nullable=True),
        Column("deleted_at", DateTime(timezone=True), nullable=False),
        UniqueConstraint("session_id", name="uq_session_tombstones_session"),
    )

    def __init__(
        self,
        database_url: str,
        *,
        create_schema: bool = False,
    ):
        self.engine = shared_engine(database_url)
        if create_schema:
            create_all_tables(self.engine)

    def verify_schema(self) -> None:
        """Fail startup before serving traffic when session migrations are absent."""
        schema = inspect(self.engine)
        required_tables = {
            "sessions",
            "session_events",
            "session_artifacts",
            "session_run_token_usage",
            "session_tombstones",
        }
        missing = required_tables.difference(schema.get_table_names())
        if missing:
            raise RuntimeError(
                f"Database is missing required thread tables: {', '.join(sorted(missing))}."
            )
        required_columns = {
            table.name: set(table.c.keys())
            for table in (
                self.sessions,
                self.events,
                self.artifacts,
                self.run_token_usage,
                self.tombstones,
            )
        }
        for table_name, expected in required_columns.items():
            actual = {column["name"] for column in schema.get_columns(table_name)}
            absent = expected.difference(actual)
            if absent:
                raise RuntimeError(
                    f"Database table {table_name} is missing required columns: "
                    f"{', '.join(sorted(absent))}."
                )
        required_unique_constraints = {
            "session_events": {("session_id", "sequence")},
            "session_run_token_usage": {("session_id", "run_id")},
        }
        for table_name, expected in required_unique_constraints.items():
            actual = {
                tuple(constraint.get("column_names") or ())
                for constraint in schema.get_unique_constraints(table_name)
            }
            absent = expected.difference(actual)
            if absent:
                rendered = ", ".join(
                    "(" + ", ".join(item) + ")" for item in sorted(absent)
                )
                raise RuntimeError(
                    f"Database table {table_name} is missing required unique "
                    f"constraints: {rendered}."
                )
        if self.engine.dialect.name != "sqlite":
            if "alembic_version" not in schema.get_table_names():
                raise RuntimeError("Database is missing the Alembic migration version.")
            with self.engine.connect() as conn:
                revision = conn.scalar(text("SELECT version_num FROM alembic_version"))
            if revision is None or revision < self.REQUIRED_SCHEMA_REVISION:
                raise RuntimeError(
                    "Database migration is behind the required revision "
                    f"{self.REQUIRED_SCHEMA_REVISION} (found {revision or 'none'})."
                )

    def create_session(self, payload: dict[str, Any]) -> dict[str, Any]:
        session_id = new_database_id()
        logger.debug(
            "Creating database session",
            session_id=session_id,
            workspace_path=payload.get("workspacePath"),
        )
        events = [
            relay_event(
                "session.created",
                session_id,
                {
                    "workspacePath": payload["workspacePath"],
                    **(
                        {"ownerEmployeeId": payload["ownerEmployeeId"]}
                        if payload.get("ownerEmployeeId")
                        else {}
                    ),
                    **(
                        {"ownerAgentId": payload["ownerAgentId"]}
                        if payload.get("ownerAgentId")
                        else {}
                    ),
                    **({"teamId": payload["teamId"]} if payload.get("teamId") else {}),
                    **(
                        {"daemonNodeId": payload["daemonNodeId"]}
                        if payload.get("daemonNodeId")
                        else {}
                    ),
                    **(
                        {"managedNodeId": payload["managedNodeId"]}
                        if payload.get("managedNodeId")
                        else {}
                    ),
                    "taskGoal": payload["taskGoal"],
                    "participants": payload.get("participants", ["human"]),
                },
            )
        ]
        if payload.get("status") or payload.get("pendingDecision"):
            events.append(
                relay_event(
                    "session.status",
                    session_id,
                    {
                        "status": payload.get("status", "running"),
                        "phase": f"waiting:{payload['pendingDecision']}"
                        if payload.get("pendingDecision")
                        else "created",
                        **(
                            {"pendingDecision": payload["pendingDecision"]}
                            if payload.get("pendingDecision")
                            else {}
                        ),
                    },
                )
            )
        session = materialize_events(events)
        with store_transaction(self.engine) as conn:
            session_row = session_to_row(session, version=len(events))
            conn.execute(insert(self.sessions).values(**session_row))
            for sequence, event in enumerate(events):
                conn.execute(
                    insert(self.events).values(
                        **session_event_to_row(session_row["id"], sequence, event)
                    )
                )
        return session

    def import_session(
        self,
        events: list[dict[str, Any]],
        artifact_contents: dict[str, tuple[str | None, dict[str, Any]]],
    ) -> str:
        """Import one validated legacy event log atomically.

        Returns ``imported`` or ``skipped``. Existing divergent histories are
        rejected; import never overwrites database state.
        """
        session = materialize_events(events)
        session_id = session["id"]
        with store_transaction(self.engine) as conn:
            outcome = self._existing_import_outcome(conn, session_id, events)
            if outcome:
                return outcome
            self._insert_import_session(conn, session, events, artifact_contents)
        return "imported"

    def validate_import_session(
        self,
        events: list[dict[str, Any]],
        artifact_contents: dict[str, tuple[str | None, dict[str, Any]]],
    ) -> str:
        """Exercise the real import inserts in a transaction that is rolled back."""
        session = materialize_events(events)
        conn = self.engine.connect()
        transaction = conn.begin()
        try:
            outcome = self._existing_import_outcome(conn, session["id"], events)
            if outcome:
                return outcome
            self._insert_import_session(conn, session, events, artifact_contents)
            return "validated"
        finally:
            transaction.rollback()
            conn.close()

    def _existing_import_outcome(
        self, conn: Any, session_id: str, events: list[dict[str, Any]]
    ) -> str | None:
        existing = (
            conn.execute(
                select(self.sessions.c.id).where(self.sessions.c.id == session_id)
            )
            .mappings()
            .first()
        )
        if not existing:
            return None
        if self._events_for_session(conn, existing["id"]) == events:
            return "skipped"
        raise ValueError(f"Database session {session_id} has divergent history.")

    def _insert_import_session(
        self,
        conn: Any,
        session: dict[str, Any],
        events: list[dict[str, Any]],
        artifact_contents: dict[str, tuple[str | None, dict[str, Any]]],
    ) -> None:
        session_row = session_to_row(session, version=len(events))
        conn.execute(insert(self.sessions).values(**session_row))
        for sequence, event in enumerate(events):
            conn.execute(
                insert(self.events).values(
                    **session_event_to_row(session_row["id"], sequence, event)
                )
            )
        for artifact in session.get("artifacts", []):
            content, metadata = artifact_contents.get(artifact["id"], (None, {}))
            conn.execute(
                insert(self.artifacts).values(
                    **session_artifact_to_row(
                        session_row["id"], artifact, metadata, content=content
                    )
                )
            )
        for run in session.get("agentRuns", []):
            if run.get("id"):
                self._sync_run_token_usage(
                    conn, session_row["id"], session, str(run["id"])
                )

    def append_event(self, session_id: str, event: dict[str, Any]) -> dict[str, Any]:
        for attempt in range(3):
            try:
                return self._append_event_once(session_id, event)
            except IntegrityError:
                if attempt == 2:
                    raise
                time.sleep(0.01 * (attempt + 1))
        raise RuntimeError("unreachable")

    def _append_event_once(
        self, session_id: str, event: dict[str, Any]
    ) -> dict[str, Any]:
        with store_transaction(self.engine) as conn:
            row = (
                conn.execute(
                    select(
                        self.sessions.c.id,
                        self.sessions.c.snapshot,
                        self.sessions.c.version,
                    )
                    .where(self.sessions.c.id == session_id)
                    .with_for_update()
                )
                .mappings()
                .first()
            )
            if not row:
                raise KeyError(session_id)
            session_pk = row["id"]
            sequence = int(row["version"] or 0)
            conn.execute(
                insert(self.events).values(
                    **session_event_to_row(session_pk, sequence, event)
                )
            )
            session = materialize_events(
                [*(row["snapshot"] or {}).get("events", []), event]
            )
            conn.execute(
                update(self.sessions)
                .where(self.sessions.c.id == session_pk)
                .values(
                    **session_to_row(
                        session, version=sequence + 1, database_id=session_pk
                    )
                )
            )
            if event.get("type") == "agent.completed":
                self._sync_run_token_usage(
                    conn, session_pk, session, str(event.get("runId") or "")
                )
        logger.debug(
            "Database session event appended",
            session_id=session_id,
            event_type=event.get("type"),
        )
        return session

    def get_session(self, session_id: str) -> dict[str, Any]:
        with store_transaction(self.engine) as conn:
            row = (
                conn.execute(
                    select(self.sessions.c.snapshot).where(self.sessions.c.id == session_id)
                )
                .mappings()
                .first()
            )
            if not row:
                raise KeyError(session_id)
        return row["snapshot"]

    def delete_session(self, session_id: str, *, deleted_by: str | None = None) -> None:
        with store_transaction(self.engine) as conn:
            row = (
                conn.execute(
                    select(self.sessions.c.id, self.sessions.c.snapshot)
                    .where(self.sessions.c.id == session_id)
                    .with_for_update()
                )
                .mappings()
                .first()
            )
            if not row:
                raise KeyError(session_id)
            session_pk = row["id"]
            self._insert_tombstone(conn, session_pk, row["snapshot"] or {}, deleted_by)
            conn.execute(
                delete(self.artifacts).where(self.artifacts.c.session_id == session_pk)
            )
            conn.execute(
                delete(self.events).where(self.events.c.session_id == session_pk)
            )
            conn.execute(delete(self.sessions).where(self.sessions.c.id == session_pk))

    def _insert_tombstone(
        self,
        conn: Any,
        session_pk: str,
        snapshot: dict[str, Any],
        deleted_by: str | None,
    ) -> None:
        conn.execute(
            delete(self.tombstones).where(self.tombstones.c.session_id == session_pk)
        )
        conn.execute(
            insert(self.tombstones).values(
                id=new_database_id(),
                session_id=session_pk,
                task_goal=snapshot.get("taskGoal") or "",
                title=snapshot.get("title"),
                owner_employee_id=snapshot.get("ownerEmployeeId"),
                deleted_by=deleted_by,
                deleted_at=_parse_iso(now_iso()),
            )
        )

    def delete_session_with_task_unlinks(
        self, session_id: str, task_store: Any, *, deleted_by: str | None = None
    ) -> bool:
        if str(self.engine.url) != str(task_store.engine.url):
            raise RuntimeError("Session and task stores must use the same database.")
        with store_transaction(self.engine) as conn:
            session_row = (
                conn.execute(
                    select(self.sessions.c.id, self.sessions.c.snapshot)
                    .where(self.sessions.c.id == session_id)
                    .with_for_update()
                )
                .mappings()
                .first()
            )
            if not session_row:
                raise KeyError(session_id)
            snapshot = session_row["snapshot"] or {}
            if snapshot.get("status") != "cancelled" and any(
                run.get("status") == "running"
                for run in snapshot.get("agentRuns", [])
            ):
                return False
            session_pk = session_row["id"]
            tasks = (
                conn.execute(
                    select(
                        task_store.tasks.c.id,
                        task_store.tasks.c.snapshot,
                    )
                    .select_from(
                        task_store.tasks.join(
                            task_store.task_sessions,
                            task_store.task_sessions.c.task_id
                            == task_store.tasks.c.id,
                        )
                    )
                    .where(
                        task_store.task_sessions.c.session_id == session_id
                    )
                    .with_for_update(of=task_store.tasks)
                )
                .mappings()
                .all()
            )
            for task in tasks:
                if session_id in (task["snapshot"] or {}).get("linkedSessionIds", []):
                    task_store.unlink_session_in_transaction(
                        conn, task["id"], session_id
                    )
            self._insert_tombstone(conn, session_pk, snapshot, deleted_by)
            conn.execute(
                delete(self.artifacts).where(self.artifacts.c.session_id == session_pk)
            )
            conn.execute(delete(self.events).where(self.events.c.session_id == session_pk))
            conn.execute(delete(self.sessions).where(self.sessions.c.id == session_pk))
        return True

    def list_sessions(self) -> list[dict[str, Any]]:
        with store_transaction(self.engine) as conn:
            rows = (
                conn.execute(
                    select(self.sessions.c.snapshot).order_by(
                        self.sessions.c.updated_at.desc()
                    )
                )
                .mappings()
                .all()
            )
        return [row["snapshot"] for row in rows]

    def list_token_usage(self) -> list[dict[str, Any]]:
        with store_transaction(self.engine) as conn:
            rows = (
                conn.execute(
                    select(
                        self.run_token_usage,
                        self.sessions.c.task_goal.label("session_task_goal"),
                    )
                    .select_from(
                        self.run_token_usage.outerjoin(
                            self.sessions,
                            self.run_token_usage.c.session_id == self.sessions.c.id,
                        )
                    )
                    .order_by(self.run_token_usage.c.completed_at.desc())
                )
                .mappings()
                .all()
            )
        return [
            {
                "sessionId": row["session_id"],
                "runId": row["run_id"],
                "ownerEmployeeId": row["owner_employee_id"],
                "taskGoal": row["task_goal"] or row["session_task_goal"],
                "input": int(row["input_tokens"] or 0),
                "output": int(row["output_tokens"] or 0),
                "cache": int(row["cache_tokens"] or 0),
                "total": int(row["total_tokens"] or 0),
                "completedAt": _format_iso(row["completed_at"]),
            }
            for row in rows
        ]

    def _new_artifact_record(
        self, session_id: str, payload: dict[str, Any]
    ) -> tuple[dict[str, Any], str, str]:
        artifact_id = new_database_id()
        extension = payload.get("extension") or "txt"
        body = payload["body"]
        artifact = {
            "id": artifact_id,
            "kind": payload["kind"],
            "title": payload["title"],
            "path": database_artifact_uri(session_id, artifact_id, extension),
            "createdAt": now_iso(),
            **(
                {"agentRunId": payload["agentRunId"]}
                if payload.get("agentRunId")
                else {}
            ),
            "bytes": len(body.encode("utf-8")),
        }
        return artifact, extension, body

    def write_artifact(
        self, session_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        if not self.get_session(session_id):
            raise KeyError(session_id)
        artifact, extension, body = self._new_artifact_record(session_id, payload)
        with store_transaction(self.engine) as conn:
            session_pk = self._session_pk(conn, session_id)
            conn.execute(
                insert(self.artifacts).values(
                    **session_artifact_to_row(
                        session_pk, artifact, {"extension": extension}, content=body
                    )
                )
            )
        logger.debug(
            "Database artifact written",
            session_id=session_id,
            artifact_id=artifact["id"],
            kind=payload.get("kind"),
            bytes=artifact["bytes"],
        )
        return artifact

    def create_artifact(
        self, session_id: str, payload: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        artifact, extension, body = self._new_artifact_record(session_id, payload)
        session = self._insert_artifact_with_event(
            session_id, artifact, {"extension": extension}, content=body
        )
        logger.debug(
            "Database artifact created",
            session_id=session_id,
            artifact_id=artifact["id"],
            kind=payload.get("kind"),
            bytes=artifact["bytes"],
        )
        return artifact, session

    def index_workspace_artifact(
        self, session_id: str, artifact: dict[str, Any], content: bytes | None
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Record a generated workspace file with an optional content snapshot.

        Binary content goes into the artifacts table base64-encoded so the
        backend can serve it without access to the daemon's filesystem.
        """
        metadata: dict[str, Any] = {
            "extension": artifact_snapshot_extension(artifact.get("title"))
        }
        encoded: str | None = None
        if content is not None:
            encoded = base64.b64encode(content).decode("ascii")
            metadata["contentEncoding"] = "base64"
            artifact = {**artifact, "bytes": len(content)}
        session = self._insert_artifact_with_event(
            session_id, artifact, metadata, content=encoded
        )
        logger.debug(
            "Database workspace artifact indexed",
            session_id=session_id,
            artifact_id=artifact["id"],
            snapshot=content is not None,
        )
        return artifact, session

    def _insert_artifact_with_event(
        self,
        session_id: str,
        artifact: dict[str, Any],
        metadata: dict[str, Any],
        *,
        content: str | None,
    ) -> dict[str, Any]:
        event = relay_event("artifact.created", session_id, {"artifact": artifact})
        with store_transaction(self.engine) as conn:
            row = (
                conn.execute(
                    select(
                        self.sessions.c.id,
                        self.sessions.c.snapshot,
                        self.sessions.c.version,
                    )
                    .where(self.sessions.c.id == session_id)
                    .with_for_update()
                )
                .mappings()
                .first()
            )
            if not row:
                raise KeyError(session_id)
            session_pk = row["id"]
            sequence = int(row["version"] or 0)
            conn.execute(
                insert(self.artifacts).values(
                    **session_artifact_to_row(
                        session_pk, artifact, metadata, content=content
                    )
                )
            )
            conn.execute(
                insert(self.events).values(
                    **session_event_to_row(session_pk, sequence, event)
                )
            )
            session = materialize_events(
                [*(row["snapshot"] or {}).get("events", []), event]
            )
            conn.execute(
                update(self.sessions)
                .where(self.sessions.c.id == session_pk)
                .values(
                    **session_to_row(
                        session, version=sequence + 1, database_id=session_pk
                    )
                )
            )
        return session

    def read_artifact_content(self, session_id: str, artifact_id: str) -> bytes | None:
        """Return the stored snapshot bytes for an artifact, if one was kept."""
        with store_transaction(self.engine) as conn:
            session_pk = self._session_pk(conn, session_id)
            row = (
                conn.execute(
                    select(self.artifacts.c.content, self.artifacts.c.metadata)
                    .where(self.artifacts.c.session_id == session_pk)
                    .where(self.artifacts.c.id == artifact_id)
                )
                .mappings()
                .first()
            )
        if not row or row["content"] is None:
            return None
        if (row["metadata"] or {}).get("contentEncoding") == "base64":
            try:
                return base64.b64decode(row["content"], validate=True)
            except (ValueError, TypeError):
                return None
        return str(row["content"]).encode("utf-8")

    def read_artifact(self, session_id: str, artifact_id: str) -> str:
        with store_transaction(self.engine) as conn:
            session_pk = self._session_pk(conn, session_id)
            row = (
                conn.execute(
                    select(self.artifacts.c.content)
                    .where(self.artifacts.c.session_id == session_pk)
                    .where(self.artifacts.c.id == artifact_id)
                )
                .mappings()
                .first()
            )
        if row and row["content"] is not None:
            return row["content"]
        raise KeyError(f"Unknown artifact {artifact_id} in session {session_id}.")

    def _session_pk(self, conn: Any, session_id: str, *, lock: bool = False) -> str:
        statement = select(self.sessions.c.id).where(self.sessions.c.id == session_id)
        if lock:
            statement = statement.with_for_update()
        session_pk = conn.scalar(statement)
        if not session_pk:
            raise KeyError(session_id)
        return session_pk

    def _events_for_session(self, conn: Any, session_pk: str) -> list[dict[str, Any]]:
        rows = (
            conn.execute(
                select(self.events.c.payload)
                .where(self.events.c.session_id == session_pk)
                .order_by(self.events.c.sequence)
            )
            .mappings()
            .all()
        )
        return [row["payload"] for row in rows]

    def _sync_run_token_usage(
        self, conn: Any, session_pk: str, session: dict[str, Any], run_id: str
    ) -> None:
        row = session_run_token_usage_to_row(session_pk, session, run_id)
        existing_id = conn.scalar(
            select(self.run_token_usage.c.id)
            .where(self.run_token_usage.c.session_id == session_pk)
            .where(self.run_token_usage.c.run_id == run_id)
        )
        if row:
            if existing_id:
                conn.execute(
                    update(self.run_token_usage)
                    .where(self.run_token_usage.c.id == existing_id)
                    .values({**row, "id": existing_id})
                )
            else:
                conn.execute(insert(self.run_token_usage).values(**row))
        elif existing_id:
            conn.execute(
                delete(self.run_token_usage).where(
                    self.run_token_usage.c.id == existing_id
                )
            )


def session_to_row(
    session: dict[str, Any], *, version: int, database_id: str | None = None
) -> dict[str, Any]:
    return {
        "id": database_id or session["id"],
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


def session_event_to_row(
    session_pk: str, sequence: int, event: dict[str, Any]
) -> dict[str, Any]:
    return {
        "id": new_database_id(),
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


def session_artifact_to_row(
    session_pk: str,
    artifact: dict[str, Any],
    metadata: dict[str, Any] | None = None,
    *,
    content: str | None = None,
) -> dict[str, Any]:
    return {
        "id": artifact["id"],
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


def session_run_token_usage_to_row(
    session_pk: str, session: dict[str, Any], run_id: str
) -> dict[str, Any] | None:
    run = next(
        (item for item in session.get("agentRuns", []) if item.get("id") == run_id),
        None,
    )
    usage = run.get("tokenUsage") if isinstance(run, dict) else None
    if (
        not isinstance(usage, dict)
        or not run.get("completedAt")
        or not int(usage.get("total") or 0)
    ):
        return None
    return {
        "id": new_database_id(),
        "session_id": session_pk,
        "run_id": run_id,
        "owner_employee_id": session.get("ownerEmployeeId"),
        "task_goal": session.get("taskGoal"),
        "input_tokens": int(usage.get("input") or 0),
        "output_tokens": int(usage.get("output") or 0),
        "cache_tokens": int(usage.get("cache") or 0),
        "total_tokens": int(usage.get("total") or 0),
        "completed_at": _parse_iso(run["completedAt"]),
    }


def session_run_token_usage_rows(session: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for run in session.get("agentRuns", []):
        usage = run.get("tokenUsage") if isinstance(run, dict) else None
        completed_at = run.get("completedAt") if isinstance(run, dict) else None
        if (
            not isinstance(usage, dict)
            or not completed_at
            or not int(usage.get("total") or 0)
        ):
            continue
        rows.append(
            {
                "sessionId": session["id"],
                "runId": run["id"],
                "ownerEmployeeId": session.get("ownerEmployeeId"),
                "taskGoal": session.get("taskGoal"),
                "input": int(usage.get("input") or 0),
                "output": int(usage.get("output") or 0),
                "cache": int(usage.get("cache") or 0),
                "total": int(usage.get("total") or 0),
                "completedAt": completed_at,
            }
        )
    return rows
