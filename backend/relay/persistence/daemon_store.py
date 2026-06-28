from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from threading import RLock
from typing import Any

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, MetaData, Table, Text, Uuid, create_engine, delete, insert, select, update

from .store_common import (
    DEFAULT_RELAY_DATA_DIR,
    _append_jsonl,
    _format_iso,
    _parse_iso,
    _read_json,
    _write_json,
    database_id_column,
    daemon_event,
    new_database_id,
    new_relay_id,
    now_iso,
    safe_name,
)


class LocalDaemonStore:
    def __init__(self, root_dir: str | Path = DEFAULT_RELAY_DATA_DIR):
        root = Path(root_dir)
        self._lock = RLock()
        self.nodes_dir = root / "daemon" / "nodes"
        self.commands_dir = root / "daemon" / "commands"
        self.runs_dir = root / "daemon" / "runs"
        self.run_requests_dir = root / "daemon" / "run-requests"
        self.events_dir = root / "daemon" / "events"
        for path in (self.nodes_dir, self.commands_dir, self.runs_dir, self.run_requests_dir, self.events_dir):
            path.mkdir(parents=True, exist_ok=True)

    def register_node(self, sandbox: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            node = {**sandbox, "token": None}
            _write_json(self.nodes_dir / f"{safe_name(node['id'])}.json", node, 0o600)
            self.append_daemon_event(daemon_event("daemon.node.registered", {"node": node}))
            return node

    def mark_node_seen(self, node_id: str, patch: dict[str, Any] | None = None) -> dict[str, Any] | None:
        with self._lock:
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

    def assign_node_employee(self, node_id: str, employee_id: str) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        if node.get("employeeId"):
            raise ValueError("Daemon node is already assigned.")
        updated = {**node, "employeeId": employee_id, "updatedAt": now_iso()}
        _write_json(self.nodes_dir / f"{safe_name(node_id)}.json", updated, 0o600)
        self.append_daemon_event(daemon_event("daemon.node.assigned", {"nodeId": node_id, "employeeId": employee_id}))
        return updated

    def update_node_disabled_agents(self, node_id: str, disabled_agents: list[str]) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        updated = {**node, "updatedAt": now_iso()}
        if disabled_agents:
            updated["disabledAgents"] = list(disabled_agents)
        else:
            updated.pop("disabledAgents", None)
        _write_json(self.nodes_dir / f"{safe_name(node_id)}.json", updated, 0o600)
        self.append_daemon_event(daemon_event("daemon.node.disabled_agents_updated", {
            "nodeId": node_id,
            "disabledAgents": list(disabled_agents),
        }))
        return updated

    def update_node_agent_role_defaults(self, node_id: str, role_defaults: dict[str, str]) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        updated = {**node, "updatedAt": now_iso()}
        if role_defaults:
            updated["agentRoleDefaults"] = dict(role_defaults)
        else:
            updated.pop("agentRoleDefaults", None)
        _write_json(self.nodes_dir / f"{safe_name(node_id)}.json", updated, 0o600)
        self.append_daemon_event(daemon_event("daemon.node.agent_role_defaults_updated", {
            "nodeId": node_id,
            "agentRoleDefaults": dict(role_defaults),
        }))
        return updated

    def update_node_agent_role_overrides(self, node_id: str, role_overrides: dict[str, str]) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        updated = {**node, "updatedAt": now_iso()}
        if role_overrides:
            updated["agentRoleOverrides"] = dict(role_overrides)
        else:
            updated.pop("agentRoleOverrides", None)
        _write_json(self.nodes_dir / f"{safe_name(node_id)}.json", updated, 0o600)
        self.append_daemon_event(daemon_event("daemon.node.agent_role_overrides_updated", {
            "nodeId": node_id,
            "agentRoleOverrides": dict(role_overrides),
        }))
        return updated

    def unassign_node_employee(self, node_id: str) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        previous = node.get("employeeId")
        updated = {k: v for k, v in node.items() if k not in ("employeeId", "agentRoleOverrides")}
        updated["updatedAt"] = now_iso()
        _write_json(self.nodes_dir / f"{safe_name(node_id)}.json", updated, 0o600)
        self.append_daemon_event(daemon_event("daemon.node.unassigned", {"nodeId": node_id, "previousEmployeeId": previous}))
        return updated

    def delete_node(self, node_id: str) -> None:
        node_path = self.nodes_dir / f"{safe_name(node_id)}.json"
        if not node_path.exists():
            raise KeyError(node_id)
        for record in self._list_commands():
            if record.get("nodeId") == node_id:
                command_path = self.commands_dir / f"{safe_name(record['id'])}.json"
                command_path.unlink(missing_ok=True)
        for path in self.runs_dir.glob("*.json"):
            run = _read_json(path)
            if run.get("nodeId") == node_id:
                path.unlink(missing_ok=True)
        for path in self.run_requests_dir.glob("*.json"):
            request = _read_json(path)
            if request.get("nodeId") == node_id:
                path.unlink(missing_ok=True)
        node_path.unlink()
        self.append_daemon_event(daemon_event("daemon.node.deleted", {"nodeId": node_id}))

    def get_node(self, node_id: str) -> dict[str, Any] | None:
        path = self.nodes_dir / f"{safe_name(node_id)}.json"
        return _read_json(path) if path.exists() else None

    def list_nodes(self) -> list[dict[str, Any]]:
        return [_read_json(path) for path in self.nodes_dir.glob("*.json")]

    def enqueue_command(self, node_id: str, command: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
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

    def take_queued_commands(self, node_id: str, limit: int = 2**53, lease_seconds: float = 60.0) -> list[dict[str, Any]]:
        with self._lock:
            now = now_iso()
            records = [
                record
                for record in self._list_commands()
                if record["nodeId"] == node_id and command_is_available(record, now)
            ]
            records = sorted(records, key=lambda item: item["createdAt"])[:limit]
            result = []
            for record in records:
                attempt = int(record.get("attempt") or 0) + 1
                updated = {
                    **record,
                    "status": "dispatched",
                    "updatedAt": now,
                    "dispatchedAt": now,
                    "leaseId": new_relay_id("lease"),
                    "leaseExpiresAt": lease_expires_at(now, lease_seconds),
                    "attempt": attempt,
                }
                if record["command"]["type"] == "run.cancel":
                    updated["status"] = "completed"
                    updated["completedAt"] = now
                _write_json(self.commands_dir / f"{safe_name(record['id'])}.json", updated)
                self.append_daemon_event(daemon_event("daemon.command.dispatched", {"nodeId": node_id, "commandId": record["id"]}))
                result.append(updated)
            return result

    def queued_command_count(self, node_id: str) -> int:
        now = now_iso()
        return len([record for record in self._list_commands() if record["nodeId"] == node_id and command_is_available(record, now)])

    def list_active_runs(self, node_id: str | None = None) -> list[dict[str, Any]]:
        runs = [_read_json(path) for path in self.runs_dir.glob("*.json")]
        return [run for run in runs if run.get("status") == "running" and (node_id is None or run.get("nodeId") == node_id)]

    def create_run_request(self, request: dict[str, Any]) -> dict[str, Any]:
        now = now_iso()
        record = {
            "id": request.get("id") or new_relay_id("drun"),
            "status": "running",
            "currentIndex": 0,
            "createdAt": now,
            "updatedAt": now,
            **request,
        }
        _write_json(self.run_requests_dir / f"{safe_name(record['id'])}.json", record)
        self.append_daemon_event(daemon_event("daemon.run_request.created", {
            "nodeId": record["nodeId"],
            "runRequestId": record["id"],
            "sessionId": record["sessionId"],
        }))
        return record

    def get_run_request(self, request_id: str) -> dict[str, Any] | None:
        path = self.run_requests_dir / f"{safe_name(request_id)}.json"
        return _read_json(path) if path.exists() else None

    def list_active_run_requests(self, node_id: str | None = None) -> list[dict[str, Any]]:
        requests = [_read_json(path) for path in self.run_requests_dir.glob("*.json")]
        return [
            request for request in requests
            if request.get("status") == "running" and (node_id is None or request.get("nodeId") == node_id)
        ]

    def active_run_request_for_session(self, node_id: str, session_id: str) -> dict[str, Any] | None:
        return next((request for request in self.list_active_run_requests(node_id) if request["sessionId"] == session_id), None)

    def run_request_for_command(self, command_id: str) -> dict[str, Any] | None:
        return next((request for request in self.list_active_run_requests() if request.get("currentCommandId") == command_id), None)

    def update_run_request(self, request_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            current = self.get_run_request(request_id)
            if not current:
                raise KeyError(request_id)
            now = now_iso()
            updated = {**current, **patch, "updatedAt": now}
            if patch.get("status") in ("completed", "failed", "cancelled"):
                updated["completedAt"] = now
            _write_json(self.run_requests_dir / f"{safe_name(request_id)}.json", updated)
            self.append_daemon_event(daemon_event("daemon.run_request.updated", {
                "nodeId": updated["nodeId"],
                "runRequestId": updated["id"],
                "status": updated["status"],
            }))
            return updated

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
        database_id_column(),
        Column("public_id", Text, nullable=False, unique=True),
        Column("employee_id", Text, nullable=True),
        Column("workspace_path", Text, nullable=True),
        Column("status", Text, nullable=False),
        Column("agents", JSON, nullable=False),
        Column("agent_details", JSON, nullable=False, default=dict),
        Column("max_concurrent_runs", Integer, nullable=False, default=1),
        Column("run_capacity_by_mode", JSON, nullable=False, default=dict),
        Column("disabled_agents", JSON, nullable=False, default=list),
        Column("agent_role_defaults", JSON, nullable=False, default=dict),
        Column("agent_role_overrides", JSON, nullable=False, default=dict),
        Column("ui_token_hash", Text, nullable=True),
        Column("node_token_hash", Text, nullable=True),
        Column("node_token", Text, nullable=True),
        Column("token_hash", Text, nullable=True),
        Column("last_error", Text, nullable=True),
        Column("created_at", DateTime(timezone=True), nullable=False),
        Column("updated_at", DateTime(timezone=True), nullable=False),
        Column("last_seen_at", DateTime(timezone=True), nullable=True),
    )
    commands = Table(
        "daemon_commands",
        metadata,
        database_id_column(),
        Column("public_id", Text, nullable=False, unique=True),
        Column("node_id", Uuid(as_uuid=False), ForeignKey("daemon_nodes.id", ondelete="CASCADE"), nullable=False),
        Column("node_public_id", Text, nullable=False),
        Column("type", Text, nullable=False),
        Column("status", Text, nullable=False),
        Column("command", JSON, nullable=False),
        Column("exit_code", Integer, nullable=True),
        Column("error", Text, nullable=True),
        Column("created_at", DateTime(timezone=True), nullable=False),
        Column("updated_at", DateTime(timezone=True), nullable=False),
        Column("dispatched_at", DateTime(timezone=True), nullable=True),
        Column("lease_id", Text, nullable=True),
        Column("lease_expires_at", DateTime(timezone=True), nullable=True),
        Column("attempt", Integer, nullable=False, default=0),
        Column("completed_at", DateTime(timezone=True), nullable=True),
    )
    runs = Table(
        "daemon_runs",
        metadata,
        database_id_column(),
        Column("public_id", Text, nullable=False, unique=True),
        Column("node_id", Uuid(as_uuid=False), ForeignKey("daemon_nodes.id", ondelete="CASCADE"), nullable=False),
        Column("node_public_id", Text, nullable=False),
        Column("command_id", Uuid(as_uuid=False), ForeignKey("daemon_commands.id", ondelete="SET NULL"), nullable=True),
        Column("command_public_id", Text, nullable=True),
        Column("session_public_id", Text, nullable=False),
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
    run_requests = Table(
        "daemon_run_requests",
        metadata,
        database_id_column(),
        Column("public_id", Text, nullable=False, unique=True),
        Column("node_id", Uuid(as_uuid=False), ForeignKey("daemon_nodes.id", ondelete="CASCADE"), nullable=False),
        Column("node_public_id", Text, nullable=False),
        Column("session_public_id", Text, nullable=False),
        Column("task_public_id", Text, nullable=True),
        Column("task_goal", Text, nullable=False),
        Column("assignments", JSON, nullable=False),
        Column("current_index", Integer, nullable=False),
        Column("state", JSON, nullable=False),
        Column("status", Text, nullable=False),
        Column("current_command_public_id", Text, nullable=True),
        Column("current_run_public_id", Text, nullable=True),
        Column("current_agent", Text, nullable=True),
        Column("current_mode", Text, nullable=True),
        Column("current_started_at", DateTime(timezone=True), nullable=True),
        Column("error", Text, nullable=True),
        Column("created_at", DateTime(timezone=True), nullable=False),
        Column("updated_at", DateTime(timezone=True), nullable=False),
        Column("completed_at", DateTime(timezone=True), nullable=True),
    )
    events = Table(
        "daemon_events",
        metadata,
        database_id_column(),
        Column("public_id", Text, nullable=False, unique=True),
        Column("node_id", Uuid(as_uuid=False), nullable=True),
        Column("node_public_id", Text, nullable=True),
        Column("command_id", Uuid(as_uuid=False), nullable=True),
        Column("command_public_id", Text, nullable=True),
        Column("run_id", Uuid(as_uuid=False), nullable=True),
        Column("run_public_id", Text, nullable=True),
        Column("type", Text, nullable=False),
        Column("timestamp", DateTime(timezone=True), nullable=False),
        Column("payload", JSON, nullable=False),
    )

    def __init__(self, database_url: str, *, create_schema: bool = False):
        self.engine = create_engine(database_url, future=True)
        if create_schema:
            self.metadata.create_all(self.engine)

    def register_node(self, sandbox: dict[str, Any]) -> dict[str, Any]:
        node = {**sandbox, "token": None}
        values = node_to_row(node)
        with self.engine.begin() as conn:
            existing = conn.scalar(select(self.nodes.c.id).where(self.nodes.c.public_id == node["id"]))
            if existing:
                conn.execute(update(self.nodes).where(self.nodes.c.id == existing).values(**node_to_row(node, database_id=existing)))
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
            node_pk = self._node_pk(conn, node_id)
            conn.execute(update(self.nodes).where(self.nodes.c.id == node_pk).values(**node_to_row(updated, database_id=node_pk)))
            self._append_daemon_event(conn, daemon_event("daemon.node.seen", {"nodeId": node_id, "patch": {**patch, "lastSeenAt": now}}))
        return updated

    def assign_node_employee(self, node_id: str, employee_id: str) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        if node.get("employeeId"):
            raise ValueError("Daemon node is already assigned.")
        updated = {**node, "employeeId": employee_id, "updatedAt": now_iso()}
        with self.engine.begin() as conn:
            node_pk = self._node_pk(conn, node_id)
            conn.execute(update(self.nodes).where(self.nodes.c.id == node_pk).values(**node_to_row(updated, database_id=node_pk)))
            self._append_daemon_event(conn, daemon_event("daemon.node.assigned", {"nodeId": node_id, "employeeId": employee_id}))
        return updated

    def update_node_disabled_agents(self, node_id: str, disabled_agents: list[str]) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        updated = {**node, "updatedAt": now_iso()}
        if disabled_agents:
            updated["disabledAgents"] = list(disabled_agents)
        else:
            updated.pop("disabledAgents", None)
        with self.engine.begin() as conn:
            node_pk = self._node_pk(conn, node_id)
            conn.execute(update(self.nodes).where(self.nodes.c.id == node_pk).values(**node_to_row(updated, database_id=node_pk)))
            self._append_daemon_event(conn, daemon_event("daemon.node.disabled_agents_updated", {
                "nodeId": node_id,
                "disabledAgents": list(disabled_agents),
            }))
        return updated

    def update_node_agent_role_defaults(self, node_id: str, role_defaults: dict[str, str]) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        updated = {**node, "updatedAt": now_iso()}
        if role_defaults:
            updated["agentRoleDefaults"] = dict(role_defaults)
        else:
            updated.pop("agentRoleDefaults", None)
        with self.engine.begin() as conn:
            node_pk = self._node_pk(conn, node_id)
            conn.execute(update(self.nodes).where(self.nodes.c.id == node_pk).values(**node_to_row(updated, database_id=node_pk)))
            self._append_daemon_event(conn, daemon_event("daemon.node.agent_role_defaults_updated", {
                "nodeId": node_id,
                "agentRoleDefaults": dict(role_defaults),
            }))
        return updated

    def update_node_agent_role_overrides(self, node_id: str, role_overrides: dict[str, str]) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        updated = {**node, "updatedAt": now_iso()}
        if role_overrides:
            updated["agentRoleOverrides"] = dict(role_overrides)
        else:
            updated.pop("agentRoleOverrides", None)
        with self.engine.begin() as conn:
            node_pk = self._node_pk(conn, node_id)
            conn.execute(update(self.nodes).where(self.nodes.c.id == node_pk).values(**node_to_row(updated, database_id=node_pk)))
            self._append_daemon_event(conn, daemon_event("daemon.node.agent_role_overrides_updated", {
                "nodeId": node_id,
                "agentRoleOverrides": dict(role_overrides),
            }))
        return updated

    def unassign_node_employee(self, node_id: str) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        previous = node.get("employeeId")
        updated = {k: v for k, v in node.items() if k not in ("employeeId", "agentRoleOverrides")}
        updated["updatedAt"] = now_iso()
        with self.engine.begin() as conn:
            node_pk = self._node_pk(conn, node_id)
            row = node_to_row(updated, database_id=node_pk)
            row["employee_id"] = None
            conn.execute(update(self.nodes).where(self.nodes.c.id == node_pk).values(**row))
            self._append_daemon_event(conn, daemon_event("daemon.node.unassigned", {"nodeId": node_id, "previousEmployeeId": previous}))
        return updated

    def delete_node(self, node_id: str) -> None:
        with self.engine.begin() as conn:
            node_pk = conn.scalar(select(self.nodes.c.id).where(self.nodes.c.public_id == node_id))
            if not node_pk:
                raise KeyError(node_id)
            conn.execute(delete(self.run_requests).where(self.run_requests.c.node_id == node_pk))
            conn.execute(delete(self.runs).where(self.runs.c.node_id == node_pk))
            conn.execute(delete(self.commands).where(self.commands.c.node_id == node_pk))
            conn.execute(delete(self.nodes).where(self.nodes.c.id == node_pk))
            self._append_daemon_event(conn, daemon_event("daemon.node.deleted", {"nodeId": node_id}))

    def get_node(self, node_id: str) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            row = conn.execute(select(self.nodes).where(self.nodes.c.public_id == node_id)).mappings().first()
        return row_to_node(row) if row else None

    def list_nodes(self) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = conn.execute(select(self.nodes)).mappings().all()
        return [row_to_node(row) for row in rows]

    def enqueue_command(self, node_id: str, command: dict[str, Any]) -> dict[str, Any]:
        now = now_iso()
        record = {"id": command["id"], "nodeId": node_id, "command": command, "status": "queued", "createdAt": now, "updatedAt": now}
        with self.engine.begin() as conn:
            node_pk = self._node_pk(conn, node_id)
            command_row = command_to_row(record, node_pk=node_pk)
            conn.execute(insert(self.commands).values(**command_row))
            if command["type"] == "run.start":
                self._write_run(conn, {
                    "nodeId": node_id,
                    "nodeDatabaseId": node_pk,
                    "commandId": command["id"],
                    "commandDatabaseId": command_row["id"],
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

    def take_queued_commands(self, node_id: str, limit: int = 2**53, lease_seconds: float = 60.0) -> list[dict[str, Any]]:
        now = now_iso()
        now_dt = _parse_iso(now)
        with self.engine.begin() as conn:
            node_pk = self._node_pk(conn, node_id)
            available_condition = (
                (self.commands.c.status == "queued")
                | ((self.commands.c.status == "dispatched") & (self.commands.c.lease_expires_at <= now_dt))
            )
            rows = conn.execute(
                select(self.commands)
                .where(self.commands.c.node_id == node_pk)
                .where(available_condition)
                .order_by(self.commands.c.created_at)
                .limit(limit)
                .with_for_update(skip_locked=True)
            ).mappings().all()
            result = []
            for row in rows:
                record = row_to_command(row)
                attempt = int(record.get("attempt") or 0) + 1
                updated = {
                    **record,
                    "status": "dispatched",
                    "updatedAt": now,
                    "dispatchedAt": now,
                    "leaseId": new_relay_id("lease"),
                    "leaseExpiresAt": lease_expires_at(now, lease_seconds),
                    "attempt": attempt,
                }
                if record["command"]["type"] == "run.cancel":
                    updated["status"] = "completed"
                    updated["completedAt"] = now
                claimed = conn.execute(
                    update(self.commands)
                    .where(self.commands.c.id == record["databaseId"])
                    .where(available_condition)
                    .values(**command_to_row(updated, database_id=record["databaseId"], node_pk=node_pk))
                )
                if claimed.rowcount != 1:
                    continue
                self._append_daemon_event(conn, daemon_event("daemon.command.dispatched", {"nodeId": node_id, "commandId": record["id"]}))
                result.append(updated)
        return result

    def queued_command_count(self, node_id: str) -> int:
        now = now_iso()
        now_dt = _parse_iso(now)
        with self.engine.begin() as conn:
            node_pk = self._node_pk(conn, node_id)
            return len(conn.execute(
                select(self.commands.c.id)
                .where(self.commands.c.node_id == node_pk)
                .where(
                    (self.commands.c.status == "queued")
                    | ((self.commands.c.status == "dispatched") & (self.commands.c.lease_expires_at <= now_dt))
                )
            ).all())

    def list_active_runs(self, node_id: str | None = None) -> list[dict[str, Any]]:
        statement = select(self.runs).where(self.runs.c.status == "running")
        if node_id is not None:
            statement = statement.where(self.runs.c.node_public_id == node_id)
        with self.engine.begin() as conn:
            rows = conn.execute(statement).mappings().all()
        return [row_to_run(row) for row in rows]

    def create_run_request(self, request: dict[str, Any]) -> dict[str, Any]:
        now = now_iso()
        record = {
            "id": request.get("id") or new_relay_id("drun"),
            "status": "running",
            "currentIndex": 0,
            "createdAt": now,
            "updatedAt": now,
            **request,
        }
        with self.engine.begin() as conn:
            node_pk = self._node_pk(conn, record["nodeId"])
            conn.execute(insert(self.run_requests).values(**run_request_to_row(record, node_pk=node_pk)))
            self._append_daemon_event(conn, daemon_event("daemon.run_request.created", {
                "nodeId": record["nodeId"],
                "runRequestId": record["id"],
                "sessionId": record["sessionId"],
            }))
        return record

    def get_run_request(self, request_id: str) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            row = conn.execute(select(self.run_requests).where(self.run_requests.c.public_id == request_id)).mappings().first()
        return row_to_run_request(row) if row else None

    def list_active_run_requests(self, node_id: str | None = None) -> list[dict[str, Any]]:
        statement = select(self.run_requests).where(self.run_requests.c.status == "running")
        if node_id is not None:
            statement = statement.where(self.run_requests.c.node_public_id == node_id)
        with self.engine.begin() as conn:
            rows = conn.execute(statement).mappings().all()
        return [row_to_run_request(row) for row in rows]

    def active_run_request_for_session(self, node_id: str, session_id: str) -> dict[str, Any] | None:
        return next((request for request in self.list_active_run_requests(node_id) if request["sessionId"] == session_id), None)

    def run_request_for_command(self, command_id: str) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            row = conn.execute(
                select(self.run_requests)
                .where(self.run_requests.c.status == "running")
                .where(self.run_requests.c.current_command_public_id == command_id)
            ).mappings().first()
        return row_to_run_request(row) if row else None

    def update_run_request(self, request_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        current = self.get_run_request(request_id)
        if not current:
            raise KeyError(request_id)
        now = now_iso()
        updated = {**current, **patch, "updatedAt": now}
        if patch.get("status") in ("completed", "failed", "cancelled"):
            updated["completedAt"] = now
        with self.engine.begin() as conn:
            node_pk = self._node_pk(conn, updated["nodeId"])
            conn.execute(
                update(self.run_requests)
                .where(self.run_requests.c.public_id == request_id)
                .values(**run_request_to_row(updated, database_id=current.get("databaseId"), node_pk=node_pk))
            )
            self._append_daemon_event(conn, daemon_event("daemon.run_request.updated", {
                "nodeId": updated["nodeId"],
                "runRequestId": updated["id"],
                "status": updated["status"],
            }))
        return updated

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
            node_pk = self._node_pk(conn, node_id)
            row = conn.execute(select(self.commands).where(self.commands.c.public_id == event["commandId"])).mappings().first()
            if row:
                command = row_to_command(row)
                conn.execute(update(self.commands).where(self.commands.c.id == command["databaseId"]).values(**command_to_row({
                    **command,
                    "status": status,
                    "updatedAt": now,
                    "completedAt": now,
                    **({"exitCode": exit_code} if exit_code is not None else {}),
                    **({"error": error} if error else {}),
                }, database_id=command["databaseId"], node_pk=node_pk)))
            run_row = conn.execute(select(self.runs).where(self.runs.c.public_id == event["runId"])).mappings().first()
            run = row_to_run(run_row, include_database=True) if run_row else {
                "nodeId": node_id,
                "nodeDatabaseId": node_pk,
                "commandId": event["commandId"],
                **({"commandDatabaseId": row["id"]} if row else {}),
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
        existing = conn.scalar(select(self.runs.c.id).where(self.runs.c.public_id == run["runId"]))
        if existing:
            conn.execute(update(self.runs).where(self.runs.c.id == existing).values(**run_to_row(run, database_id=existing)))
        else:
            conn.execute(insert(self.runs).values(**values))

    def _append_daemon_event(self, conn: Any, event: dict[str, Any]) -> None:
        conn.execute(insert(self.events).values(**daemon_event_to_row(conn, self, event)))

    def _node_pk(self, conn: Any, node_id: str) -> str:
        node_pk = conn.scalar(select(self.nodes.c.id).where(self.nodes.c.public_id == node_id))
        if not node_pk:
            raise KeyError(node_id)
        return node_pk

def node_to_row(node: dict[str, Any], *, database_id: str | None = None) -> dict[str, Any]:
    return {
        "id": database_id or new_database_id(),
        "public_id": node["id"],
        "employee_id": node.get("employeeId"),
        "workspace_path": node.get("workspacePath"),
        "status": node["status"],
        "agents": node.get("agents") or {},
        "agent_details": node.get("agentDetails") or {},
        "max_concurrent_runs": int(node.get("maxConcurrentRuns") or 1),
        "run_capacity_by_mode": node.get("runCapacityByMode") or {},
        "disabled_agents": list(node.get("disabledAgents") or []),
        "agent_role_defaults": node.get("agentRoleDefaults") or {},
        "agent_role_overrides": node.get("agentRoleOverrides") or {},
        "ui_token_hash": node.get("uiTokenHash"),
        "node_token_hash": node.get("nodeTokenHash"),
        # Legacy column kept for migrations/backward compatibility. Plaintext
        # node tokens are intentionally process-local and must not be persisted.
        "node_token": None,
        "token_hash": node.get("tokenHash"),
        "last_error": node.get("lastError"),
        "created_at": _parse_iso(node["createdAt"]),
        "updated_at": _parse_iso(node["updatedAt"]),
        "last_seen_at": _parse_iso(node.get("lastSeenAt")),
    }


def row_to_node(row: Any) -> dict[str, Any]:
    return {
        "id": row["public_id"],
        **({"employeeId": row["employee_id"]} if row.get("employee_id") else {}),
        **({"workspacePath": row["workspace_path"]} if row.get("workspace_path") else {}),
        "status": row["status"],
        "agents": row["agents"] or {},
        **({"agentDetails": row["agent_details"]} if row.get("agent_details") else {}),
        "maxConcurrentRuns": int(row.get("max_concurrent_runs") or 1),
        "runCapacityByMode": row.get("run_capacity_by_mode") or {},
        **({"disabledAgents": list(row["disabled_agents"])} if row.get("disabled_agents") else {}),
        **({"agentRoleDefaults": dict(row["agent_role_defaults"])} if row.get("agent_role_defaults") else {}),
        **({"agentRoleOverrides": dict(row["agent_role_overrides"])} if row.get("agent_role_overrides") else {}),
        "token": None,
        **({"tokenHash": row["token_hash"]} if row.get("token_hash") else {}),
        **({"uiTokenHash": row["ui_token_hash"]} if row.get("ui_token_hash") else {}),
        **({"nodeTokenHash": row["node_token_hash"]} if row.get("node_token_hash") else {}),
        **({"lastError": row["last_error"]} if row.get("last_error") else {}),
        "createdAt": _format_iso(row["created_at"]),
        "updatedAt": _format_iso(row["updated_at"]),
        **({"lastSeenAt": _format_iso(row["last_seen_at"])} if row.get("last_seen_at") else {}),
    }


def command_to_row(record: dict[str, Any], *, database_id: str | None = None, node_pk: str | None = None) -> dict[str, Any]:
    return {
        "id": database_id or record.get("databaseId") or new_database_id(),
        "public_id": record["id"],
        "node_id": node_pk or record.get("nodeDatabaseId"),
        "node_public_id": record["nodeId"],
        "type": record["command"]["type"],
        "status": record["status"],
        "command": record["command"],
        "exit_code": record.get("exitCode"),
        "error": record.get("error"),
        "created_at": _parse_iso(record["createdAt"]),
        "updated_at": _parse_iso(record["updatedAt"]),
        "dispatched_at": _parse_iso(record.get("dispatchedAt")),
        "lease_id": record.get("leaseId"),
        "lease_expires_at": _parse_iso(record.get("leaseExpiresAt")),
        "attempt": int(record.get("attempt") or 0),
        "completed_at": _parse_iso(record.get("completedAt")),
    }


def row_to_command(row: Any) -> dict[str, Any]:
    return {
        "databaseId": row["id"],
        "id": row["public_id"],
        "nodeId": row["node_public_id"],
        "command": row["command"],
        "status": row["status"],
        "createdAt": _format_iso(row["created_at"]),
        "updatedAt": _format_iso(row["updated_at"]),
        **({"dispatchedAt": _format_iso(row["dispatched_at"])} if row.get("dispatched_at") else {}),
        **({"leaseId": row["lease_id"]} if row.get("lease_id") else {}),
        **({"leaseExpiresAt": _format_iso(row["lease_expires_at"])} if row.get("lease_expires_at") else {}),
        "attempt": row.get("attempt") or 0,
        **({"completedAt": _format_iso(row["completed_at"])} if row.get("completed_at") else {}),
        **({"exitCode": row["exit_code"]} if row.get("exit_code") is not None else {}),
        **({"error": row["error"]} if row.get("error") else {}),
    }


def lease_expires_at(now: str, lease_seconds: float) -> str:
    expires_at = _parse_iso(now) + timedelta(seconds=max(0.001, lease_seconds))
    return _format_iso(expires_at)


def command_is_available(record: dict[str, Any], now: str) -> bool:
    status = record.get("status")
    if status == "queued":
        return True
    if status != "dispatched":
        return False
    lease_expires_at_value = record.get("leaseExpiresAt")
    return bool(lease_expires_at_value and _parse_iso(lease_expires_at_value) <= _parse_iso(now))


def run_to_row(run: dict[str, Any], *, database_id: str | None = None) -> dict[str, Any]:
    return {
        "id": database_id or run.get("databaseId") or new_database_id(),
        "public_id": run["runId"],
        "node_id": run["nodeDatabaseId"],
        "node_public_id": run["nodeId"],
        "command_id": run.get("commandDatabaseId"),
        "command_public_id": run.get("commandId"),
        "session_public_id": run["sessionId"],
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


def row_to_run(row: Any, *, include_database: bool = False) -> dict[str, Any]:
    return {
        **({"databaseId": row["id"]} if include_database else {}),
        "nodeId": row["node_public_id"],
        **({"nodeDatabaseId": row["node_id"]} if include_database else {}),
        **({"commandId": row["command_public_id"]} if row.get("command_public_id") else {}),
        **({"commandDatabaseId": row["command_id"]} if include_database and row.get("command_id") else {}),
        "sessionId": row["session_public_id"],
        "runId": row["public_id"],
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


def run_request_to_row(record: dict[str, Any], *, database_id: str | None = None, node_pk: str | None = None) -> dict[str, Any]:
    return {
        "id": database_id or record.get("databaseId") or new_database_id(),
        "public_id": record["id"],
        "node_id": node_pk or record.get("nodeDatabaseId"),
        "node_public_id": record["nodeId"],
        "session_public_id": record["sessionId"],
        "task_public_id": record.get("taskId"),
        "task_goal": record["taskGoal"],
        "assignments": record["assignments"],
        "current_index": record.get("currentIndex", 0),
        "state": record.get("state") or {},
        "status": record["status"],
        "current_command_public_id": record.get("currentCommandId"),
        "current_run_public_id": record.get("currentRunId"),
        "current_agent": record.get("currentAgent"),
        "current_mode": record.get("currentMode"),
        "current_started_at": _parse_iso(record.get("currentStartedAt")),
        "error": record.get("error"),
        "created_at": _parse_iso(record["createdAt"]),
        "updated_at": _parse_iso(record["updatedAt"]),
        "completed_at": _parse_iso(record.get("completedAt")),
    }


def row_to_run_request(row: Any) -> dict[str, Any]:
    return {
        "databaseId": row["id"],
        "nodeId": row["node_public_id"],
        "nodeDatabaseId": row["node_id"],
        "id": row["public_id"],
        "sessionId": row["session_public_id"],
        **({"taskId": row["task_public_id"]} if row.get("task_public_id") else {}),
        "taskGoal": row["task_goal"],
        "assignments": row["assignments"] or [],
        "currentIndex": row["current_index"],
        "state": row["state"] or {},
        "status": row["status"],
        **({"currentCommandId": row["current_command_public_id"]} if row.get("current_command_public_id") else {}),
        **({"currentRunId": row["current_run_public_id"]} if row.get("current_run_public_id") else {}),
        **({"currentAgent": row["current_agent"]} if row.get("current_agent") else {}),
        **({"currentMode": row["current_mode"]} if row.get("current_mode") else {}),
        **({"currentStartedAt": _format_iso(row["current_started_at"])} if row.get("current_started_at") else {}),
        **({"error": row["error"]} if row.get("error") else {}),
        "createdAt": _format_iso(row["created_at"]),
        "updatedAt": _format_iso(row["updated_at"]),
        **({"completedAt": _format_iso(row["completed_at"])} if row.get("completed_at") else {}),
    }


def daemon_event_to_row(conn: Any, store: DatabaseDaemonStore, event: dict[str, Any]) -> dict[str, Any]:
    node_id = event.get("nodeId")
    command_id = event.get("commandId")
    run_id = event.get("runId")
    return {
        "id": new_database_id(),
        "public_id": event["id"],
        "node_id": conn.scalar(select(store.nodes.c.id).where(store.nodes.c.public_id == node_id)) if node_id else None,
        "node_public_id": node_id,
        "command_id": conn.scalar(select(store.commands.c.id).where(store.commands.c.public_id == command_id)) if command_id else None,
        "command_public_id": command_id,
        "run_id": conn.scalar(select(store.runs.c.id).where(store.runs.c.public_id == run_id)) if run_id else None,
        "run_public_id": run_id,
        "type": event["type"],
        "timestamp": _parse_iso(event["timestamp"]),
        "payload": event,
    }
