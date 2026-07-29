from __future__ import annotations

import fcntl
from collections import defaultdict
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path
from threading import RLock
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    PrimaryKeyConstraint,
    Table,
    Text,
    delete,
    func,
    insert,
    select,
    text,
    update,
)
from sqlalchemy.exc import IntegrityError

from ..core.ids import new_relay_id
from .store_common import (
    DEFAULT_RELAY_DATA_DIR,
    _append_jsonl,
    _format_iso,
    _parse_iso,
    _read_json,
    _read_jsonl,
    _write_json,
    _write_jsonl,
    daemon_event,
    database_id_column,
    entity_uuid_type,
    create_all_tables,
    json_type,
    shared_engine,
    store_transaction,
    metadata as shared_metadata,
    new_database_id,
    now_iso,
    safe_name,
)

TERMINAL_DAEMON_STATUSES = frozenset({"completed", "failed", "cancelled"})
# Command-lifecycle events describe records that `prune_terminal_records`
# deletes, so they are pruned on the same retention cutoff. Node-lifecycle
# events are kept indefinitely: `delete_node` hard-deletes the node row, which
# makes the event log the only surviving record of a node incarnation (see
# `historical_managed_runtime_ids`).
PRUNABLE_DAEMON_EVENT_PREFIX = "daemon.command."
ACTIVE_RUN_REQUEST_STATUSES = frozenset({"running", "dispatching", "finalizing"})
DISPATCH_CLAIM_ID_STATE_KEY = "_relay_dispatch_claim_id"
DISPATCH_CLAIM_EXPIRES_STATE_KEY = "_relay_dispatch_claim_expires_at"
TERMINAL_EVENT_STATE_KEY = "_relay_terminal_event"
TERMINAL_CLAIM_ID_STATE_KEY = "_relay_terminal_claim_id"
TERMINAL_CLAIM_EXPIRES_STATE_KEY = "_relay_terminal_claim_expires_at"


def _node_for_storage(node: dict[str, Any]) -> dict[str, Any]:
    stored = {**node, "token": None}
    stored.pop("nodeToken", None)
    return stored


def infer_node_location(node: dict[str, Any]) -> str | None:
    """Infer location only from explicit or managed control-plane state."""
    explicit = node.get("nodeLocation")
    if explicit:
        return str(explicit)
    if node.get("managedNodeId"):
        return "managed"
    return None


def assigned_node_location(node: dict[str, Any]) -> str:
    """Classify a node during an authorized control-plane assignment."""
    if node.get("nodeLocation"):
        return str(node["nodeLocation"])
    if node.get("managedNodeId"):
        return "managed"
    return "employee-device"


def _terminal_timestamp(record: dict[str, Any]) -> str:
    return (
        record.get("completedAt")
        or record.get("updatedAt")
        or record.get("createdAt")
        or ""
    )


def _database_terminal_timestamp(row: Any) -> str:
    value = row.get("completed_at") or row.get("updated_at") or row.get("created_at")
    if isinstance(value, str):
        return value
    return _format_iso(value) or ""


def completed_cancel_record(
    record: dict[str, Any], now: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    command = record["command"]
    updated = {
        **record,
        "status": "completed",
        "updatedAt": now,
        "completedAt": now,
    }
    event = daemon_event(
        "daemon.command.completed",
        {
            "nodeId": record["nodeId"],
            "commandId": record["id"],
            "targetCommandId": command["commandId"],
            "runId": command["runId"],
        },
    )
    return updated, event


def terminal_database_ids_to_prune(
    rows: list[Any], cutoff: str, per_node_limit: int
) -> list[str]:
    records_by_node: dict[str, list[Any]] = defaultdict(list)
    for row in rows:
        records_by_node[row["node_id"]].append(row)
    database_ids: list[str] = []
    for records in records_by_node.values():
        records.sort(key=_database_terminal_timestamp, reverse=True)
        for index, row in enumerate(records):
            if index < per_node_limit and _database_terminal_timestamp(row) > cutoff:
                continue
            database_ids.append(row["id"])
    return database_ids


def _managed_runtime_identity_map(
    events: list[dict[str, Any]],
) -> dict[str, str]:
    identities: dict[str, str] = {}
    for event in events:
        node = event.get("node") if isinstance(event, dict) else None
        if (
            event.get("type") == "daemon.node.registered"
            and isinstance(node, dict)
            and isinstance(node.get("id"), str)
            and isinstance(node.get("managedNodeId"), str)
        ):
            identities[node["id"]] = node["managedNodeId"]
    return identities


class LocalDaemonStore:
    """File-backed daemon store for a single backend process.

    The in-process lock and queued-command index are intentionally not
    interprocess coordination primitives. Multi-process deployments must use
    DatabaseDaemonStore.
    """

    def __init__(self, root_dir: str | Path = DEFAULT_RELAY_DATA_DIR):
        root = Path(root_dir)
        self._lock = RLock()
        self._nonterminal_command_ids_by_node: dict[str, set[str]] = {}
        self.nodes_dir = root / "daemon" / "nodes"
        self.commands_dir = root / "daemon" / "commands"
        self.runs_dir = root / "daemon" / "runs"
        self.run_requests_dir = root / "daemon" / "run-requests"
        self.run_request_claim_lock_path = root / "daemon" / ".run-request-claims.lock"
        self.events_dir = root / "daemon" / "events"
        for path in (
            self.nodes_dir,
            self.commands_dir,
            self.runs_dir,
            self.run_requests_dir,
            self.events_dir,
        ):
            path.mkdir(parents=True, exist_ok=True)
        self._rebuild_command_index()

    def register_node(self, sandbox: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            node = _node_for_storage(sandbox)
            self._write_node(node)
            self.append_daemon_event(
                daemon_event("daemon.node.registered", {"node": node})
            )
            return node

    def mark_node_seen(
        self, node_id: str, patch: dict[str, Any] | None = None
    ) -> dict[str, Any] | None:
        with self._lock:
            node = self.get_node(node_id)
            if not node:
                return None
            now = now_iso()
            patch = patch or {}
            updated = {
                **node,
                **{k: v for k, v in patch.items() if v is not None},
                "updatedAt": now,
                "lastSeenAt": now,
            }
            if patch.get("lastError") is None and "lastError" in patch:
                updated.pop("lastError", None)
            self._write_node(updated)
            # Deliberately not logged as a daemon event: heartbeats arrive
            # several times per second per node, and `lastSeenAt` on the node
            # record is the only thing anything reads.
            return updated

    def assign_node_employee(self, node_id: str, employee_id: str) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        if node.get("employeeId"):
            raise ValueError("Daemon node is already assigned.")
        updated = {**node, "employeeId": employee_id, "updatedAt": now_iso()}
        updated["nodeLocation"] = assigned_node_location(updated)
        self._write_node(updated)
        self.append_daemon_event(
            daemon_event(
                "daemon.node.assigned", {"nodeId": node_id, "employeeId": employee_id}
            )
        )
        return updated

    def update_node_disabled_agents(
        self, node_id: str, disabled_agents: list[str]
    ) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        updated = {**node, "updatedAt": now_iso()}
        if disabled_agents:
            updated["disabledAgents"] = list(disabled_agents)
        else:
            updated.pop("disabledAgents", None)
        self._write_node(updated)
        self.append_daemon_event(
            daemon_event(
                "daemon.node.disabled_agents_updated",
                {
                    "nodeId": node_id,
                    "disabledAgents": list(disabled_agents),
                },
            )
        )
        return updated

    def update_node_display_name(
        self, node_id: str, display_name: str | None
    ) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        updated = {**node, "updatedAt": now_iso()}
        if display_name:
            updated["displayName"] = display_name
        else:
            updated.pop("displayName", None)
        self._write_node(updated)
        self.append_daemon_event(
            daemon_event(
                "daemon.node.display_name_updated",
                {"nodeId": node_id, "displayName": display_name},
            )
        )
        return updated

    def update_node_agent_role_defaults(
        self, node_id: str, role_defaults: dict[str, str]
    ) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        updated = {**node, "updatedAt": now_iso()}
        if role_defaults:
            updated["agentRoleDefaults"] = dict(role_defaults)
        else:
            updated.pop("agentRoleDefaults", None)
        self._write_node(updated)
        self.append_daemon_event(
            daemon_event(
                "daemon.node.agent_role_defaults_updated",
                {
                    "nodeId": node_id,
                    "agentRoleDefaults": dict(role_defaults),
                },
            )
        )
        return updated

    def update_node_agent_role_overrides(
        self, node_id: str, role_overrides: dict[str, str]
    ) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        updated = {**node, "updatedAt": now_iso()}
        if role_overrides:
            updated["agentRoleOverrides"] = dict(role_overrides)
        else:
            updated.pop("agentRoleOverrides", None)
        self._write_node(updated)
        self.append_daemon_event(
            daemon_event(
                "daemon.node.agent_role_overrides_updated",
                {
                    "nodeId": node_id,
                    "agentRoleOverrides": dict(role_overrides),
                },
            )
        )
        return updated

    def unassign_node_employee(self, node_id: str) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        previous = node.get("employeeId")
        updated = {
            k: v
            for k, v in node.items()
            if k not in ("employeeId", "agentRoleOverrides")
        }
        updated["updatedAt"] = now_iso()
        self._write_node(updated)
        self.append_daemon_event(
            daemon_event(
                "daemon.node.unassigned",
                {"nodeId": node_id, "previousEmployeeId": previous},
            )
        )
        return updated

    def delete_node(self, node_id: str) -> None:
        node_path = self.nodes_dir / f"{safe_name(node_id)}.json"
        if not node_path.exists():
            raise KeyError(node_id)
        for record in self._list_commands():
            if record.get("nodeId") == node_id:
                command_path = self.commands_dir / f"{safe_name(record['id'])}.json"
                command_path.unlink(missing_ok=True)
                self._remove_command_from_index(node_id, record["id"])
        for path in self.runs_dir.glob("*.json"):
            run = _read_json(path)
            if run.get("nodeId") == node_id:
                path.unlink(missing_ok=True)
        for path in self.run_requests_dir.glob("*.json"):
            request = _read_json(path)
            if request.get("nodeId") == node_id:
                path.unlink(missing_ok=True)
        node_path.unlink()
        self.append_daemon_event(
            daemon_event("daemon.node.deleted", {"nodeId": node_id})
        )

    def get_node(self, node_id: str) -> dict[str, Any] | None:
        path = self.nodes_dir / f"{safe_name(node_id)}.json"
        return _read_json(path) if path.exists() else None

    def list_nodes(self) -> list[dict[str, Any]]:
        return [_read_json(path) for path in self.nodes_dir.glob("*.json")]

    def get_command(self, command_id: str) -> dict[str, Any] | None:
        with self._lock:
            return self._get_command(command_id)

    def enqueue_command(self, node_id: str, command: dict[str, Any]) -> dict[str, Any]:
        self.stage_command(node_id, command)
        return self.publish_command(command["id"])

    def stage_command(
        self,
        node_id: str,
        command: dict[str, Any],
        *,
        request_id: str | None = None,
        claim_id: str | None = None,
    ) -> dict[str, Any] | None:
        with self._lock:
            if request_id is not None:
                request = self.get_run_request(request_id)
                if (
                    not request
                    or (request.get("state") or {}).get(DISPATCH_CLAIM_ID_STATE_KEY)
                    != claim_id
                ):
                    return None
            now = now_iso()
            record = {
                "id": command["id"],
                "nodeId": node_id,
                "command": command,
                "status": "pending",
                "createdAt": now,
                "updatedAt": now,
            }
            _write_json(self.commands_dir / f"{safe_name(record['id'])}.json", record)
            if command["type"] == "run.start":
                self._write_run(
                    {
                        "nodeId": node_id,
                        "commandId": command["id"],
                        "sessionId": command["sessionId"],
                        "runId": command["runId"],
                        "agent": command["agent"],
                        **(
                            {"logicalAgentId": command["logicalAgentId"]}
                            if command.get("logicalAgentId")
                            else {}
                        ),
                        **(
                            {"placementId": command["placementId"]}
                            if command.get("placementId")
                            else {}
                        ),
                        "mode": command["mode"],
                        "taskGoal": command["taskGoal"],
                        **(
                            {"workspacePath": command["workspacePath"]}
                            if command.get("workspacePath")
                            else {}
                        ),
                        "status": "pending",
                        "startedAt": now,
                    }
                )
            self.append_daemon_event(
                daemon_event(
                    "daemon.command.staged",
                    {"nodeId": node_id, "commandId": command["id"]},
                )
            )
            return record

    def publish_command(self, command_id: str) -> dict[str, Any]:
        with self._lock:
            record = self._get_command(command_id)
            if not record:
                raise KeyError(command_id)
            if record["status"] != "pending":
                return record
            now = now_iso()
            updated = {**record, "status": "queued", "updatedAt": now}
            _write_json(self.commands_dir / f"{safe_name(command_id)}.json", updated)
            run = self._get_run(record["command"].get("runId", ""))
            if run and run.get("status") == "pending":
                self._write_run({**run, "status": "running"})
            self._index_command(updated)
            self.append_daemon_event(
                daemon_event(
                    "daemon.command.queued",
                    {"nodeId": record["nodeId"], "commandId": command_id},
                )
            )
            return updated

    def discard_staged_command(self, command_id: str) -> None:
        with self._lock:
            record = self._get_command(command_id)
            if not record or record.get("status") != "pending":
                return
            (self.commands_dir / f"{safe_name(command_id)}.json").unlink(
                missing_ok=True
            )
            run_id = record.get("command", {}).get("runId")
            if run_id:
                (self.runs_dir / f"{safe_name(run_id)}.json").unlink(missing_ok=True)

    def update_staged_command(
        self, command_id: str, command: dict[str, Any]
    ) -> dict[str, Any] | None:
        with self._lock:
            record = self._get_command(command_id)
            if not record or record.get("status") != "pending":
                return None
            updated = {**record, "command": command, "updatedAt": now_iso()}
            _write_json(self.commands_dir / f"{safe_name(command_id)}.json", updated)
            return updated

    def take_queued_commands(
        self, node_id: str, limit: int = 2**53, lease_seconds: float = 60.0
    ) -> list[dict[str, Any]]:
        with self._lock:
            now = now_iso()
            # Safe only inside the single backend process that owns this store.
            records = [
                record
                for record in self._command_records_for_node(node_id)
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
                _write_json(
                    self.commands_dir / f"{safe_name(record['id'])}.json", updated
                )
                if updated["status"] in TERMINAL_DAEMON_STATUSES:
                    self._remove_command_from_index(node_id, updated["id"])
                else:
                    self._index_command(updated)
                self.append_daemon_event(
                    daemon_event(
                        "daemon.command.dispatched",
                        {"nodeId": node_id, "commandId": record["id"]},
                    )
                )
                result.append(updated)
            return result

    def queued_command_count(self, node_id: str) -> int:
        now = now_iso()
        return len(
            [
                record
                for record in self._command_records_for_node(node_id)
                if command_is_available(record, now)
            ]
        )

    def queued_command_counts(self) -> dict[str, int]:
        now = now_iso()
        return {
            node_id: len(
                [
                    record
                    for record in self._command_records_for_node(node_id)
                    if command_is_available(record, now)
                ]
            )
            for node_id in list(self._nonterminal_command_ids_by_node.keys())
        }

    def renew_command_leases(
        self,
        node_id: str,
        command_leases: list[tuple[str, str | None]],
        lease_seconds: float = 60.0,
    ) -> None:
        if not command_leases:
            return
        with self._lock:
            now = now_iso()
            requested = dict(command_leases)
            for record in self._command_records_for_node(node_id):
                expected_lease_id = requested.get(record["id"])
                if (
                    record["nodeId"] != node_id
                    or record["id"] not in requested
                    or record.get("status") != "dispatched"
                    or (
                        expected_lease_id is not None
                        and record.get("leaseId") != expected_lease_id
                    )
                ):
                    continue
                updated = {
                    **record,
                    "updatedAt": now,
                    "leaseExpiresAt": lease_expires_at(now, lease_seconds),
                }
                _write_json(
                    self.commands_dir / f"{safe_name(record['id'])}.json", updated
                )
                self.append_daemon_event(
                    daemon_event(
                        "daemon.command.lease_renewed",
                        {
                            "nodeId": node_id,
                            "commandId": record["id"],
                            "leaseId": record.get("leaseId"),
                            "leaseExpiresAt": updated["leaseExpiresAt"],
                        },
                    )
                )

    def list_active_runs(self, node_id: str | None = None) -> list[dict[str, Any]]:
        runs = [_read_json(path) for path in self.runs_dir.glob("*.json")]
        return [
            run
            for run in runs
            if run.get("status") == "running"
            and (node_id is None or run.get("nodeId") == node_id)
        ]

    def create_run_request(self, request: dict[str, Any]) -> dict[str, Any]:
        now = now_iso()
        record = {
            "id": request.get("id") or new_database_id(),
            "status": "running",
            "currentIndex": 0,
            "createdAt": now,
            "updatedAt": now,
            **request,
        }
        with self._lock, self._run_request_claim_lock():
            if self.active_run_request_for_session_any_node(record["sessionId"]):
                raise ValueError(
                    f"Session {record['sessionId']} already has an active daemon run."
                )
            _write_json(
                self.run_requests_dir / f"{safe_name(record['id'])}.json", record
            )
            self.append_daemon_event(
                daemon_event(
                    "daemon.run_request.created",
                    {
                        "nodeId": record["nodeId"],
                        "runRequestId": record["id"],
                        "sessionId": record["sessionId"],
                    },
                )
            )
        return record

    @contextmanager
    def _run_request_claim_lock(self) -> Iterator[None]:
        with self.run_request_claim_lock_path.open("a+", encoding="utf-8") as lock_file:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)

    def get_run_request(self, request_id: str) -> dict[str, Any] | None:
        path = self.run_requests_dir / f"{safe_name(request_id)}.json"
        return _read_json(path) if path.exists() else None

    def list_active_run_requests(
        self, node_id: str | None = None
    ) -> list[dict[str, Any]]:
        requests = [_read_json(path) for path in self.run_requests_dir.glob("*.json")]
        return [
            request
            for request in requests
            if request.get("status") in ACTIVE_RUN_REQUEST_STATUSES
            and (node_id is None or request.get("nodeId") == node_id)
        ]

    def active_run_request_for_session(
        self, node_id: str, session_id: str
    ) -> dict[str, Any] | None:
        return next(
            (
                request
                for request in self.list_active_run_requests(node_id)
                if request["sessionId"] == session_id
            ),
            None,
        )

    def active_run_request_for_session_any_node(
        self, session_id: str
    ) -> dict[str, Any] | None:
        return next(
            (
                request
                for request in self.list_active_run_requests()
                if request["sessionId"] == session_id
            ),
            None,
        )

    def run_request_for_command(self, command_id: str) -> dict[str, Any] | None:
        return next(
            (
                request
                for request in self.list_active_run_requests()
                if request.get("currentCommandId") == command_id
            ),
            None,
        )

    def pending_command_for_run_request(self, request_id: str) -> dict[str, Any] | None:
        with self._lock:
            return next(
                (
                    record
                    for record in self._list_commands()
                    if record.get("status") == "pending"
                    and record.get("command", {}).get("_runRequestId") == request_id
                ),
                None,
            )

    def claim_terminal_run_request(
        self,
        command_id: str,
        event: dict[str, Any],
        claim_id: str,
        lease_seconds: float,
    ) -> dict[str, Any] | None:
        with self._lock:
            request = self.run_request_for_command(command_id)
            if not request:
                return None
            state = dict(request.get("state") or {})
            now = now_iso()
            if request.get("status") == "finalizing":
                expires_at = state.get(TERMINAL_CLAIM_EXPIRES_STATE_KEY)
                if expires_at and _parse_iso(expires_at) > _parse_iso(now):
                    return None
            state.update(
                {
                    TERMINAL_EVENT_STATE_KEY: event,
                    TERMINAL_CLAIM_ID_STATE_KEY: claim_id,
                    TERMINAL_CLAIM_EXPIRES_STATE_KEY: lease_expires_at(
                        now, lease_seconds
                    ),
                }
            )
            return self.update_run_request(
                request["id"], {"status": "finalizing", "state": state}
            )

    def claim_run_request_dispatch(
        self, request_id: str, claim_id: str, lease_seconds: float
    ) -> dict[str, Any] | None:
        with self._lock:
            request = self.get_run_request(request_id)
            if (
                not request
                or request.get("status") not in ("running", "dispatching")
                or request.get("currentCommandId")
            ):
                return None
            state = dict(request.get("state") or {})
            now = now_iso()
            if request.get("status") == "dispatching":
                expires_at = state.get(DISPATCH_CLAIM_EXPIRES_STATE_KEY)
                if expires_at and _parse_iso(expires_at) > _parse_iso(now):
                    return None
            state.update(
                {
                    DISPATCH_CLAIM_ID_STATE_KEY: claim_id,
                    DISPATCH_CLAIM_EXPIRES_STATE_KEY: lease_expires_at(
                        now, lease_seconds
                    ),
                }
            )
            return self.update_run_request(
                request_id, {"status": "dispatching", "state": state}
            )

    def update_run_request(
        self, request_id: str, patch: dict[str, Any]
    ) -> dict[str, Any]:
        with self._lock:
            current = self.get_run_request(request_id)
            if not current:
                raise KeyError(request_id)
            now = now_iso()
            updated = {**current, **patch, "updatedAt": now}
            if patch.get("status") in ("completed", "failed", "cancelled"):
                updated["completedAt"] = now
            _write_json(
                self.run_requests_dir / f"{safe_name(request_id)}.json", updated
            )
            self.append_daemon_event(
                daemon_event(
                    "daemon.run_request.updated",
                    {
                        "nodeId": updated["nodeId"],
                        "runRequestId": updated["id"],
                        "status": updated["status"],
                    },
                )
            )
            return updated

    def update_run_request_if_claimed(
        self,
        request_id: str,
        claim_key: str,
        claim_id: str,
        patch: dict[str, Any],
    ) -> dict[str, Any] | None:
        with self._lock:
            current = self.get_run_request(request_id)
            if not current or (current.get("state") or {}).get(claim_key) != claim_id:
                return None
            return self.update_run_request(request_id, patch)

    def mark_command_completed(self, node_id: str, event: dict[str, Any]) -> bool:
        return self._mark_command_terminal(
            node_id, event, "completed", event.get("exitCode"), None
        )

    def mark_command_failed(self, node_id: str, event: dict[str, Any]) -> bool:
        return self._mark_command_terminal(
            node_id, event, "failed", event.get("exitCode"), event.get("error")
        )

    def mark_command_cancelled(self, node_id: str, event: dict[str, Any]) -> bool:
        return self._mark_command_terminal(
            node_id, event, "cancelled", None, event.get("reason")
        )

    def mark_cancel_commands_completed(
        self, node_id: str, target_command_id: str
    ) -> None:
        with self._lock:
            now = now_iso()
            for record in self._command_records_for_node(node_id):
                command = record["command"]
                if (
                    command["type"] != "run.cancel"
                    or command.get("commandId") != target_command_id
                ):
                    continue
                updated, completion_event = completed_cancel_record(record, now)
                _write_json(
                    self.commands_dir / f"{safe_name(record['id'])}.json", updated
                )
                self._remove_command_from_index(node_id, record["id"])
                self.append_daemon_event(completion_event)

    def prune_terminal_records(
        self, retention_seconds: float, per_node_limit: int
    ) -> dict[str, int]:
        cutoff = _format_iso(
            _parse_iso(now_iso()) - timedelta(seconds=max(0.0, retention_seconds))
        )
        per_node_limit = max(0, per_node_limit)
        with self._lock:
            deleted_commands = self._prune_terminal_files(
                self.commands_dir,
                cutoff=cutoff,
                per_node_limit=per_node_limit,
                on_delete=lambda record: self._remove_command_from_index(
                    record["nodeId"], record["id"]
                ),
            )
            deleted_runs = self._prune_terminal_files(
                self.runs_dir,
                cutoff=cutoff,
                per_node_limit=per_node_limit,
            )
            deleted_events = self._prune_command_events(cutoff)
        return {
            "commands": deleted_commands,
            "runs": deleted_runs,
            "events": deleted_events,
        }

    def _prune_command_events(self, cutoff: str) -> int:
        events_path = self.events_dir / "events.jsonl"
        if not events_path.exists():
            return 0
        events = _read_jsonl(events_path)
        retained = [
            event
            for event in events
            if not (
                str(event.get("type", "")).startswith(PRUNABLE_DAEMON_EVENT_PREFIX)
                and str(event.get("timestamp", "")) <= cutoff
            )
        ]
        deleted = len(events) - len(retained)
        if deleted:
            _write_jsonl(events_path, retained)
        return deleted

    def append_daemon_event(self, event: dict[str, Any]) -> None:
        _append_jsonl(self.events_dir / "events.jsonl", event)

    def historical_managed_runtime_ids(self, managed_node_id: str) -> set[str]:
        events_path = self.events_dir / "events.jsonl"
        if not events_path.exists():
            return set()
        return {
            runtime_id
            for runtime_id, current_managed_node_id in _managed_runtime_identity_map(
                _read_jsonl(events_path)
            ).items()
            if current_managed_node_id == managed_node_id
        }

    def historical_managed_node_id(self, runtime_id: str) -> str | None:
        return self.historical_managed_node_ids({runtime_id}).get(runtime_id)

    def historical_managed_node_ids(
        self, runtime_ids: set[str]
    ) -> dict[str, str]:
        events_path = self.events_dir / "events.jsonl"
        if not events_path.exists():
            return {}
        identities = _managed_runtime_identity_map(_read_jsonl(events_path))
        return {
            current_runtime_id: managed_node_id
            for current_runtime_id, managed_node_id in identities.items()
            if current_runtime_id in runtime_ids
        }

    def _mark_command_terminal(
        self,
        node_id: str,
        event: dict[str, Any],
        status: str,
        exit_code: int | None,
        error: str | None,
    ) -> bool:
        with self._lock:
            now = now_iso()
            command = self._get_command(event["commandId"])
            if (
                not command
                or command.get("status") not in ("queued", "dispatched")
                or (
                    event.get("leaseId") is not None
                    and (
                        command.get("status") != "dispatched"
                        or command.get("leaseId") != event["leaseId"]
                    )
                )
            ):
                return False
            _write_json(
                self.commands_dir / f"{safe_name(command['id'])}.json",
                {
                    **command,
                    "command": {
                        **command["command"],
                        "_terminalEvent": event,
                    },
                    "status": status,
                    "updatedAt": now,
                    "completedAt": now,
                    **({"exitCode": exit_code} if exit_code is not None else {}),
                    **({"error": error} if error else {}),
                },
            )
            self._remove_command_from_index(node_id, command["id"])
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
            self._write_run(
                {
                    **run,
                    "status": status,
                    "completedAt": now,
                    **({"exitCode": exit_code} if exit_code is not None else {}),
                    **({"error": error} if error else {}),
                }
            )
            event_type = {
                "completed": "daemon.command.completed",
                "failed": "daemon.command.failed",
                "cancelled": "daemon.command.cancelled",
            }[status]
            self.append_daemon_event(
                daemon_event(
                    event_type,
                    {
                        "nodeId": node_id,
                        "commandId": event["commandId"],
                        "runId": event["runId"],
                        **({"exitCode": exit_code} if exit_code is not None else {}),
                        **({"error": error} if error else {}),
                    },
                )
            )
            return True

    def _write_node(self, node: dict[str, Any]) -> None:
        stored = _node_for_storage(node)
        _write_json(self.nodes_dir / f"{safe_name(stored['id'])}.json", stored, 0o600)

    def _list_commands(self) -> list[dict[str, Any]]:
        return [_read_json(path) for path in self.commands_dir.glob("*.json")]

    def _get_command(self, command_id: str) -> dict[str, Any] | None:
        path = self.commands_dir / f"{safe_name(command_id)}.json"
        return _read_json(path) if path.exists() else None

    def _rebuild_command_index(self) -> None:
        self._nonterminal_command_ids_by_node = {}
        for record in self._list_commands():
            self._index_command(record)

    def _index_command(self, record: dict[str, Any]) -> None:
        if record.get("status") in TERMINAL_DAEMON_STATUSES:
            self._remove_command_from_index(record["nodeId"], record["id"])
            return
        self._nonterminal_command_ids_by_node.setdefault(record["nodeId"], set()).add(
            record["id"]
        )

    def _remove_command_from_index(self, node_id: str, command_id: str) -> None:
        command_ids = self._nonterminal_command_ids_by_node.get(node_id)
        if not command_ids:
            return
        command_ids.discard(command_id)
        if not command_ids:
            self._nonterminal_command_ids_by_node.pop(node_id, None)

    def _command_records_for_node(self, node_id: str) -> list[dict[str, Any]]:
        records = []
        for command_id in list(
            self._nonterminal_command_ids_by_node.get(node_id, set())
        ):
            record = self._get_command(command_id)
            if not record:
                self._remove_command_from_index(node_id, command_id)
                continue
            if record.get("status") in TERMINAL_DAEMON_STATUSES:
                self._remove_command_from_index(node_id, command_id)
                continue
            records.append(record)
        return records

    def _prune_terminal_files(
        self,
        directory: Path,
        *,
        cutoff: str,
        per_node_limit: int,
        on_delete: Any | None = None,
    ) -> int:
        records_by_node: dict[str, list[tuple[dict[str, Any], Path]]] = defaultdict(
            list
        )
        for path in directory.glob("*.json"):
            record = _read_json(path)
            if record.get("status") in TERMINAL_DAEMON_STATUSES:
                records_by_node[record["nodeId"]].append((record, path))
        deleted = 0
        for records in records_by_node.values():
            records.sort(key=lambda item: _terminal_timestamp(item[0]), reverse=True)
            for index, (record, path) in enumerate(records):
                if index < per_node_limit and _terminal_timestamp(record) > cutoff:
                    continue
                path.unlink(missing_ok=True)
                if on_delete:
                    on_delete(record)
                deleted += 1
        return deleted

    def _get_run(self, run_id: str) -> dict[str, Any] | None:
        path = self.runs_dir / f"{safe_name(run_id)}.json"
        return _read_json(path) if path.exists() else None

    def _write_run(self, run: dict[str, Any]) -> None:
        _write_json(self.runs_dir / f"{safe_name(run['runId'])}.json", run)


class DatabaseDaemonStore:
    metadata = shared_metadata

    nodes = Table(
        "daemon_nodes",
        metadata,
        database_id_column(),
        Column(
            "employee_id",
            entity_uuid_type(),
            ForeignKey(
                "employees.id",
                ondelete="SET NULL",
                name="fk_daemon_nodes_employee",
            ),
            nullable=True,
        ),
        Column("display_name", Text, nullable=True),
        Column("workspace_path", Text, nullable=True),
        Column("workspace_id", Text, nullable=True),
        Column("sandbox_mode", Text, nullable=True),
        Column("node_location", Text, nullable=True),
        Column("managed_node_id", entity_uuid_type(), nullable=True),
        Column("provisioning_attempt_id", Text, nullable=True),
        Column("credential_version", Integer, nullable=False, default=1),
        Column("retired_at", DateTime(timezone=True), nullable=True),
        Column("status", Text, nullable=False),
        Column("max_concurrent_runs", Integer, nullable=False, default=1),
        Column("run_capacity_by_mode", json_type(), nullable=False, default=dict),
        Column("ui_token_hash", Text, nullable=True),
        Column("node_token_hash", Text, nullable=True),
        Column("last_error", Text, nullable=True),
        Column("created_at", DateTime(timezone=True), nullable=False),
        Column("updated_at", DateTime(timezone=True), nullable=False),
        Column("last_seen_at", DateTime(timezone=True), nullable=True),
        Index("ix_daemon_nodes_employee_id", "employee_id"),
        Index("ix_daemon_nodes_updated_at", "updated_at"),
        Index("ix_daemon_nodes_last_seen_at", "last_seen_at"),
        Index("ix_daemon_nodes_managed_node_id", "managed_node_id"),
        Index("ix_daemon_nodes_workspace_id", "workspace_id"),
        Index("ix_daemon_nodes_retired_at", "retired_at"),
        # A Computer is (employee_id, workspace_id) for an employee device and
        # managed_node_id for a managed one -- never the daemon's own id, which
        # changes every time the daemon process is replaced.
        Index(
            "uq_daemon_nodes_computer",
            "employee_id",
            "workspace_id",
            unique=True,
            postgresql_where=text("managed_node_id IS NULL AND retired_at IS NULL"),
            sqlite_where=text("managed_node_id IS NULL AND retired_at IS NULL"),
        ),
        Index(
            "uq_daemon_nodes_managed_runtime",
            "managed_node_id",
            unique=True,
            postgresql_where=text(
                "managed_node_id IS NOT NULL AND retired_at IS NULL"
            ),
            sqlite_where=text("managed_node_id IS NOT NULL AND retired_at IS NULL"),
        ),
    )
    # One row per agent a node knows about, replacing five parallel JSON maps
    # (agents, agent_details, disabled_agents, agent_role_defaults,
    # agent_role_overrides) that all keyed off the same agent name and had to be
    # kept aligned by convention. `run_capacity_by_mode` stays on the node: it
    # is keyed by run mode, not by agent.
    node_agents = Table(
        "daemon_node_agents",
        metadata,
        Column(
            "node_id",
            entity_uuid_type(),
            ForeignKey("daemon_nodes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        Column("agent", Text, nullable=False),
        Column("status", Text, nullable=False),
        Column("details", json_type(), nullable=True),
        Column("disabled", Boolean, nullable=False),
        Column("role_default", Text, nullable=True),
        Column("role_override", Text, nullable=True),
        PrimaryKeyConstraint("node_id", "agent", name="pk_daemon_node_agents"),
    )
    commands = Table(
        "daemon_commands",
        metadata,
        database_id_column(),
        Column(
            "node_id",
            entity_uuid_type(),
            ForeignKey("daemon_nodes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        Column("type", Text, nullable=False),
        Column("status", Text, nullable=False),
        Column("command", json_type(), nullable=False),
        Column("exit_code", Integer, nullable=True),
        Column("error", Text, nullable=True),
        Column("created_at", DateTime(timezone=True), nullable=False),
        Column("updated_at", DateTime(timezone=True), nullable=False),
        Column("dispatched_at", DateTime(timezone=True), nullable=True),
        Column("lease_id", Text, nullable=True),
        Column("lease_expires_at", DateTime(timezone=True), nullable=True),
        Column("attempt", Integer, nullable=False, default=0),
        Column("completed_at", DateTime(timezone=True), nullable=True),
        Index("ix_daemon_commands_node_status", "node_id", "status"),
        Index("ix_daemon_commands_created_at", "created_at"),
        Index("ix_daemon_commands_lease_expires_at", "lease_expires_at"),
    )
    runs = Table(
        "daemon_runs",
        metadata,
        database_id_column(),
        Column(
            "node_id",
            entity_uuid_type(),
            ForeignKey("daemon_nodes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        Column(
            "command_id",
            entity_uuid_type(),
            ForeignKey("daemon_commands.id", ondelete="SET NULL"),
            nullable=True,
        ),
        Column("session_id", entity_uuid_type(), nullable=False),
        Column("agent", Text, nullable=False),
        Column("logical_agent_id", entity_uuid_type(), nullable=True),
        Column("placement_id", entity_uuid_type(), nullable=True),
        Column("mode", Text, nullable=False),
        Column("task_goal", Text, nullable=False),
        Column("workspace_path", Text, nullable=True),
        Column("status", Text, nullable=False),
        Column("exit_code", Integer, nullable=True),
        Column("error", Text, nullable=True),
        Column("started_at", DateTime(timezone=True), nullable=False),
        Column("completed_at", DateTime(timezone=True), nullable=True),
        Index("ix_daemon_runs_node_status", "node_id", "status"),
        Index("ix_daemon_runs_session_id", "session_id"),
    )
    run_requests = Table(
        "daemon_run_requests",
        metadata,
        database_id_column(),
        Column(
            "node_id",
            entity_uuid_type(),
            ForeignKey("daemon_nodes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        Column("session_id", entity_uuid_type(), nullable=False),
        Column("task_id", entity_uuid_type(), nullable=True),
        Column("task_goal", Text, nullable=False),
        Column("assignments", json_type(), nullable=False),
        Column("current_index", Integer, nullable=False),
        Column("state", json_type(), nullable=False),
        Column("status", Text, nullable=False),
        Column("current_command_id", entity_uuid_type(), nullable=True),
        Column("current_run_id", entity_uuid_type(), nullable=True),
        Column("current_agent", Text, nullable=True),
        Column("current_mode", Text, nullable=True),
        Column("current_started_at", DateTime(timezone=True), nullable=True),
        Column("error", Text, nullable=True),
        Column("created_at", DateTime(timezone=True), nullable=False),
        Column("updated_at", DateTime(timezone=True), nullable=False),
        Column("completed_at", DateTime(timezone=True), nullable=True),
        Index("ix_daemon_run_requests_status", "status"),
        Index("ix_daemon_run_requests_node_status", "node_id", "status"),
        Index("ix_daemon_run_requests_session_id", "session_id"),
        Index("ix_daemon_run_requests_task_id", "task_id"),
    )
    Index(
        "uq_daemon_run_requests_active_session",
        run_requests.c.session_id,
        unique=True,
        postgresql_where=run_requests.c.status.in_(ACTIVE_RUN_REQUEST_STATUSES),
        sqlite_where=run_requests.c.status.in_(ACTIVE_RUN_REQUEST_STATUSES),
    )
    events = Table(
        "daemon_events",
        metadata,
        database_id_column(),
        Column("node_id", entity_uuid_type(), nullable=True),
        Column("command_id", entity_uuid_type(), nullable=True),
        Column("run_id", entity_uuid_type(), nullable=True),
        Column("type", Text, nullable=False),
        Column("timestamp", DateTime(timezone=True), nullable=False),
        Column("payload", json_type(), nullable=False),
        Index("ix_daemon_events_node_id", "node_id"),
        Index("ix_daemon_events_timestamp", "timestamp"),
    )

    def __init__(self, database_url: str, *, create_schema: bool = False):
        self.engine = shared_engine(database_url)
        if create_schema:
            create_all_tables(self.engine)

    def _write_node_agents(self, conn: Any, node_pk: str, node: dict[str, Any]) -> None:
        """Replace a node's daemon_node_agents rows.

        Delete-then-insert rather than a merge: the five maps are always written as
        a complete set, so an agent dropped from the payload must disappear.
        """
        conn.execute(
            delete(self.node_agents).where(self.node_agents.c.node_id == node_pk)
        )
        rows = node_agent_rows(node, node_pk)
        if rows:
            conn.execute(insert(self.node_agents), rows)

    def _save_node(
        self, conn: Any, node: dict[str, Any], *, database_id: str | None = None
    ) -> None:
        """Write a node row and its per-agent rows together."""
        node_pk = database_id or node["id"]
        values = node_to_row(node, database_id=node_pk)
        existing = conn.scalar(
            select(self.nodes.c.id).where(self.nodes.c.id == node_pk)
        )
        if existing:
            conn.execute(
                update(self.nodes).where(self.nodes.c.id == existing).values(**values)
            )
        else:
            conn.execute(insert(self.nodes).values(**values))
        self._write_node_agents(conn, node_pk, node)

    def register_node(self, sandbox: dict[str, Any]) -> dict[str, Any]:
        node = _node_for_storage(sandbox)
        with store_transaction(self.engine) as conn:
            self._save_node(conn, node)
            self._append_daemon_event(
                conn, daemon_event("daemon.node.registered", {"node": node})
            )
        return node

    def mark_node_seen(
        self, node_id: str, patch: dict[str, Any] | None = None
    ) -> dict[str, Any] | None:
        node = self.get_node(node_id)
        if not node:
            return None
        now = now_iso()
        patch = patch or {}
        updated = {
            **node,
            **{k: v for k, v in patch.items() if v is not None},
            "updatedAt": now,
            "lastSeenAt": now,
        }
        if patch.get("lastError") is None and "lastError" in patch:
            updated.pop("lastError", None)
        with store_transaction(self.engine) as conn:
            node_pk = self._node_pk(conn, node_id)
            self._save_node(conn, updated, database_id=node_pk)
            # Deliberately not logged as a daemon event: heartbeats arrive
            # several times per second per node, and `lastSeenAt` on the node
            # record is the only thing anything reads.
        return updated

    def assign_node_employee(self, node_id: str, employee_id: str) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        if node.get("employeeId"):
            raise ValueError("Daemon node is already assigned.")
        updated = {**node, "employeeId": employee_id, "updatedAt": now_iso()}
        updated["nodeLocation"] = assigned_node_location(updated)
        with store_transaction(self.engine) as conn:
            node_pk = self._node_pk(conn, node_id)
            self._save_node(conn, updated, database_id=node_pk)
            self._append_daemon_event(
                conn,
                daemon_event(
                    "daemon.node.assigned",
                    {"nodeId": node_id, "employeeId": employee_id},
                ),
            )
        return updated

    def update_node_disabled_agents(
        self, node_id: str, disabled_agents: list[str]
    ) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        updated = {**node, "updatedAt": now_iso()}
        if disabled_agents:
            updated["disabledAgents"] = list(disabled_agents)
        else:
            updated.pop("disabledAgents", None)
        with store_transaction(self.engine) as conn:
            node_pk = self._node_pk(conn, node_id)
            self._save_node(conn, updated, database_id=node_pk)
            self._append_daemon_event(
                conn,
                daemon_event(
                    "daemon.node.disabled_agents_updated",
                    {
                        "nodeId": node_id,
                        "disabledAgents": list(disabled_agents),
                    },
                ),
            )
        return updated

    def update_node_display_name(
        self, node_id: str, display_name: str | None
    ) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        updated = {**node, "updatedAt": now_iso()}
        if display_name:
            updated["displayName"] = display_name
        else:
            updated.pop("displayName", None)
        with store_transaction(self.engine) as conn:
            node_pk = self._node_pk(conn, node_id)
            self._save_node(conn, updated, database_id=node_pk)
            self._append_daemon_event(
                conn,
                daemon_event(
                    "daemon.node.display_name_updated",
                    {"nodeId": node_id, "displayName": display_name},
                ),
            )
        return updated

    def update_node_agent_role_defaults(
        self, node_id: str, role_defaults: dict[str, str]
    ) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        updated = {**node, "updatedAt": now_iso()}
        if role_defaults:
            updated["agentRoleDefaults"] = dict(role_defaults)
        else:
            updated.pop("agentRoleDefaults", None)
        with store_transaction(self.engine) as conn:
            node_pk = self._node_pk(conn, node_id)
            self._save_node(conn, updated, database_id=node_pk)
            self._append_daemon_event(
                conn,
                daemon_event(
                    "daemon.node.agent_role_defaults_updated",
                    {
                        "nodeId": node_id,
                        "agentRoleDefaults": dict(role_defaults),
                    },
                ),
            )
        return updated

    def update_node_agent_role_overrides(
        self, node_id: str, role_overrides: dict[str, str]
    ) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        updated = {**node, "updatedAt": now_iso()}
        if role_overrides:
            updated["agentRoleOverrides"] = dict(role_overrides)
        else:
            updated.pop("agentRoleOverrides", None)
        with store_transaction(self.engine) as conn:
            node_pk = self._node_pk(conn, node_id)
            self._save_node(conn, updated, database_id=node_pk)
            self._append_daemon_event(
                conn,
                daemon_event(
                    "daemon.node.agent_role_overrides_updated",
                    {
                        "nodeId": node_id,
                        "agentRoleOverrides": dict(role_overrides),
                    },
                ),
            )
        return updated

    def unassign_node_employee(self, node_id: str) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise KeyError(node_id)
        previous = node.get("employeeId")
        updated = {
            k: v
            for k, v in node.items()
            if k not in ("employeeId", "agentRoleOverrides")
        }
        updated["updatedAt"] = now_iso()
        with store_transaction(self.engine) as conn:
            node_pk = self._node_pk(conn, node_id)
            # `updated` drops employeeId entirely, so node_to_row would leave the
            # column untouched rather than clearing it.
            self._save_node(conn, {**updated, "employeeId": None}, database_id=node_pk)
            self._append_daemon_event(
                conn,
                daemon_event(
                    "daemon.node.unassigned",
                    {"nodeId": node_id, "previousEmployeeId": previous},
                ),
            )
        return updated

    def delete_node(self, node_id: str) -> None:
        with store_transaction(self.engine) as conn:
            node_pk = conn.scalar(
                select(self.nodes.c.id).where(self.nodes.c.id == node_id)
            )
            if not node_pk:
                raise KeyError(node_id)
            conn.execute(
                delete(self.run_requests).where(self.run_requests.c.node_id == node_pk)
            )
            conn.execute(delete(self.runs).where(self.runs.c.node_id == node_pk))
            conn.execute(
                delete(self.commands).where(self.commands.c.node_id == node_pk)
            )
            conn.execute(delete(self.nodes).where(self.nodes.c.id == node_pk))
            self._append_daemon_event(
                conn, daemon_event("daemon.node.deleted", {"nodeId": node_id})
            )

    def _node_agents_by_node(
        self, conn: Any, node_pks: list[str]
    ) -> dict[str, list[Any]]:
        if not node_pks:
            return {}
        rows = (
            conn.execute(
                select(self.node_agents)
                .where(self.node_agents.c.node_id.in_(node_pks))
                .order_by(self.node_agents.c.node_id, self.node_agents.c.agent)
            )
            .mappings()
            .all()
        )
        grouped: dict[str, list[Any]] = {}
        for row in rows:
            grouped.setdefault(str(row["node_id"]), []).append(row)
        return grouped

    def get_node(self, node_id: str) -> dict[str, Any] | None:
        with store_transaction(self.engine) as conn:
            row = (
                conn.execute(
                    select(self.nodes).where(self.nodes.c.id == node_id)
                )
                .mappings()
                .first()
            )
            if not row:
                return None
            agents = self._node_agents_by_node(conn, [str(row["id"])])
        return apply_node_agents(row_to_node(row), agents.get(str(row["id"]), []))

    def list_nodes(self) -> list[dict[str, Any]]:
        with store_transaction(self.engine) as conn:
            rows = conn.execute(select(self.nodes)).mappings().all()
            agents = self._node_agents_by_node(conn, [str(row["id"]) for row in rows])
        return [
            apply_node_agents(row_to_node(row), agents.get(str(row["id"]), []))
            for row in rows
        ]

    def get_command(self, command_id: str) -> dict[str, Any] | None:
        with store_transaction(self.engine) as conn:
            row = (
                conn.execute(
                    select(self.commands).where(self.commands.c.id == command_id)
                )
                .mappings()
                .first()
            )
        return row_to_command(row) if row else None

    def enqueue_command(self, node_id: str, command: dict[str, Any]) -> dict[str, Any]:
        self.stage_command(node_id, command)
        return self.publish_command(command["id"])

    def stage_command(
        self,
        node_id: str,
        command: dict[str, Any],
        *,
        request_id: str | None = None,
        claim_id: str | None = None,
    ) -> dict[str, Any] | None:
        now = now_iso()
        record = {
            "id": command["id"],
            "nodeId": node_id,
            "command": command,
            "status": "pending",
            "createdAt": now,
            "updatedAt": now,
        }
        with store_transaction(self.engine) as conn:
            if request_id is not None:
                request_row = (
                    conn.execute(
                        select(self.run_requests)
                        .where(self.run_requests.c.id == request_id)
                        .with_for_update()
                    )
                    .mappings()
                    .first()
                )
                if (
                    not request_row
                    or (request_row.get("state") or {}).get(DISPATCH_CLAIM_ID_STATE_KEY)
                    != claim_id
                ):
                    return None
            node_pk = self._node_pk(conn, node_id)
            command_row = command_to_row(record, node_pk=node_pk)
            conn.execute(insert(self.commands).values(**command_row))
            if command["type"] == "run.start":
                self._write_run(
                    conn,
                    {
                        "nodeId": node_id,
                        "commandId": command["id"],
                        "sessionId": command["sessionId"],
                        "runId": command["runId"],
                        "agent": command["agent"],
                        **(
                            {"logicalAgentId": command["logicalAgentId"]}
                            if command.get("logicalAgentId")
                            else {}
                        ),
                        **(
                            {"placementId": command["placementId"]}
                            if command.get("placementId")
                            else {}
                        ),
                        "mode": command["mode"],
                        "taskGoal": command["taskGoal"],
                        **(
                            {"workspacePath": command["workspacePath"]}
                            if command.get("workspacePath")
                            else {}
                        ),
                        "status": "pending",
                        "startedAt": now,
                    },
                )
            self._append_daemon_event(
                conn,
                daemon_event(
                    "daemon.command.staged",
                    {"nodeId": node_id, "commandId": command["id"]},
                ),
            )
        return record

    def publish_command(self, command_id: str) -> dict[str, Any]:
        now = now_iso()
        with store_transaction(self.engine) as conn:
            row = (
                conn.execute(
                    select(self.commands)
                    .where(self.commands.c.id == command_id)
                    .with_for_update()
                )
                .mappings()
                .first()
            )
            if not row:
                raise KeyError(command_id)
            record = row_to_command(row)
            if record["status"] != "pending":
                return record
            updated = {**record, "status": "queued", "updatedAt": now}
            conn.execute(
                update(self.commands)
                .where(self.commands.c.id == record["id"])
                .values(
                    **command_to_row(
                        updated,
                        database_id=record["id"],
                        node_pk=row["node_id"],
                    )
                )
            )
            conn.execute(
                update(self.runs)
                .where(self.runs.c.command_id == command_id)
                .where(self.runs.c.status == "pending")
                .values(status="running")
            )
            self._append_daemon_event(
                conn,
                daemon_event(
                    "daemon.command.queued",
                    {"nodeId": record["nodeId"], "commandId": command_id},
                ),
            )
        return updated

    def discard_staged_command(self, command_id: str) -> None:
        with store_transaction(self.engine) as conn:
            row = (
                conn.execute(
                    select(self.commands)
                    .where(self.commands.c.id == command_id)
                    .where(self.commands.c.status == "pending")
                )
                .mappings()
                .first()
            )
            if not row:
                return
            conn.execute(
                delete(self.runs).where(self.runs.c.command_id == command_id)
            )
            conn.execute(delete(self.commands).where(self.commands.c.id == row["id"]))

    def update_staged_command(
        self, command_id: str, command: dict[str, Any]
    ) -> dict[str, Any] | None:
        now = now_iso()
        with store_transaction(self.engine) as conn:
            row = (
                conn.execute(
                    select(self.commands)
                    .where(self.commands.c.id == command_id)
                    .where(self.commands.c.status == "pending")
                    .with_for_update()
                )
                .mappings()
                .first()
            )
            if not row:
                return None
            record = row_to_command(row)
            updated = {**record, "command": command, "updatedAt": now}
            conn.execute(
                update(self.commands)
                .where(self.commands.c.id == row["id"])
                .values(
                    **command_to_row(
                        updated, database_id=row["id"], node_pk=row["node_id"]
                    )
                )
            )
        return updated

    def take_queued_commands(
        self, node_id: str, limit: int = 2**53, lease_seconds: float = 60.0
    ) -> list[dict[str, Any]]:
        now = now_iso()
        now_dt = _parse_iso(now)
        with store_transaction(self.engine) as conn:
            node_pk = self._node_pk(conn, node_id)
            available_condition = (self.commands.c.status == "queued") | (
                (self.commands.c.status == "dispatched")
                & (self.commands.c.lease_expires_at <= now_dt)
            )
            rows = (
                conn.execute(
                    select(self.commands)
                    .where(self.commands.c.node_id == node_pk)
                    .where(available_condition)
                    .order_by(self.commands.c.created_at)
                    .limit(limit)
                    .with_for_update(skip_locked=True)
                )
                .mappings()
                .all()
            )
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
                claimed = conn.execute(
                    update(self.commands)
                    .where(self.commands.c.id == record["id"])
                    .where(available_condition)
                    .values(
                        **command_to_row(
                            updated, database_id=record["id"], node_pk=node_pk
                        )
                    )
                )
                if claimed.rowcount != 1:
                    continue
                self._append_daemon_event(
                    conn,
                    daemon_event(
                        "daemon.command.dispatched",
                        {"nodeId": node_id, "commandId": record["id"]},
                    ),
                )
                result.append(updated)
        return result

    def queued_command_count(self, node_id: str) -> int:
        now = now_iso()
        now_dt = _parse_iso(now)
        with store_transaction(self.engine) as conn:
            node_pk = self._node_pk(conn, node_id)
            return len(
                conn.execute(
                    select(self.commands.c.id)
                    .where(self.commands.c.node_id == node_pk)
                    .where(
                        (self.commands.c.status == "queued")
                        | (
                            (self.commands.c.status == "dispatched")
                            & (self.commands.c.lease_expires_at <= now_dt)
                        )
                    )
                ).all()
            )

    def queued_command_counts(self) -> dict[str, int]:
        now = now_iso()
        now_dt = _parse_iso(now)
        with store_transaction(self.engine) as conn:
            rows = conn.execute(
                select(self.commands.c.node_id, func.count(self.commands.c.id))
                .where(
                    (self.commands.c.status == "queued")
                    | (
                        (self.commands.c.status == "dispatched")
                        & (self.commands.c.lease_expires_at <= now_dt)
                    )
                )
                .group_by(self.commands.c.node_id)
            ).all()
        return {row[0]: row[1] for row in rows}

    def renew_command_leases(
        self,
        node_id: str,
        command_leases: list[tuple[str, str | None]],
        lease_seconds: float = 60.0,
    ) -> None:
        if not command_leases:
            return
        now = now_iso()
        requested = dict(command_leases)
        with store_transaction(self.engine) as conn:
            node_pk = self._node_pk(conn, node_id)
            rows = (
                conn.execute(
                    select(self.commands)
                    .where(self.commands.c.node_id == node_pk)
                    .where(self.commands.c.id.in_(requested.keys()))
                    .where(self.commands.c.status == "dispatched")
                )
                .mappings()
                .all()
            )
            for row in rows:
                record = row_to_command(row)
                expected_lease_id = requested[record["id"]]
                if (
                    expected_lease_id is not None
                    and record.get("leaseId") != expected_lease_id
                ):
                    continue
                updated = {
                    **record,
                    "updatedAt": now,
                    "leaseExpiresAt": lease_expires_at(now, lease_seconds),
                }
                conn.execute(
                    update(self.commands)
                    .where(self.commands.c.id == record["id"])
                    .values(
                        **command_to_row(
                            updated, database_id=record["id"], node_pk=node_pk
                        )
                    )
                )
                self._append_daemon_event(
                    conn,
                    daemon_event(
                        "daemon.command.lease_renewed",
                        {
                            "nodeId": node_id,
                            "commandId": record["id"],
                            "leaseId": record.get("leaseId"),
                            "leaseExpiresAt": updated["leaseExpiresAt"],
                        },
                    ),
                )

    def list_active_runs(self, node_id: str | None = None) -> list[dict[str, Any]]:
        statement = select(self.runs).where(self.runs.c.status == "running")
        if node_id is not None:
            statement = statement.where(self.runs.c.node_id == node_id)
        with store_transaction(self.engine) as conn:
            rows = conn.execute(statement).mappings().all()
        return [row_to_run(row) for row in rows]

    def create_run_request(self, request: dict[str, Any]) -> dict[str, Any]:
        now = now_iso()
        record = {
            "id": request.get("id") or new_database_id(),
            "status": "running",
            "currentIndex": 0,
            "createdAt": now,
            "updatedAt": now,
            **request,
        }
        try:
            with store_transaction(self.engine) as conn:
                node_pk = self._node_pk(conn, record["nodeId"])
                conn.execute(
                    insert(self.run_requests).values(
                        **run_request_to_row(record, node_pk=node_pk)
                    )
                )
                self._append_daemon_event(
                    conn,
                    daemon_event(
                        "daemon.run_request.created",
                        {
                            "nodeId": record["nodeId"],
                            "runRequestId": record["id"],
                            "sessionId": record["sessionId"],
                        },
                    ),
                )
        except IntegrityError as error:
            if self.active_run_request_for_session_any_node(record["sessionId"]):
                raise ValueError(
                    f"Session {record['sessionId']} already has an active daemon run."
                ) from error
            raise
        return record

    def get_run_request(self, request_id: str) -> dict[str, Any] | None:
        with store_transaction(self.engine) as conn:
            row = (
                conn.execute(
                    select(self.run_requests).where(
                        self.run_requests.c.id == request_id
                    )
                )
                .mappings()
                .first()
            )
        return row_to_run_request(row) if row else None

    def list_active_run_requests(
        self, node_id: str | None = None
    ) -> list[dict[str, Any]]:
        statement = select(self.run_requests).where(
            self.run_requests.c.status.in_(ACTIVE_RUN_REQUEST_STATUSES)
        )
        if node_id is not None:
            statement = statement.where(self.run_requests.c.node_id == node_id)
        with store_transaction(self.engine) as conn:
            rows = conn.execute(statement).mappings().all()
        return [row_to_run_request(row) for row in rows]

    def active_run_request_for_session(
        self, node_id: str, session_id: str
    ) -> dict[str, Any] | None:
        return next(
            (
                request
                for request in self.list_active_run_requests(node_id)
                if request["sessionId"] == session_id
            ),
            None,
        )

    def active_run_request_for_session_any_node(
        self, session_id: str
    ) -> dict[str, Any] | None:
        return next(
            (
                request
                for request in self.list_active_run_requests()
                if request["sessionId"] == session_id
            ),
            None,
        )

    def run_request_for_command(self, command_id: str) -> dict[str, Any] | None:
        with store_transaction(self.engine) as conn:
            row = (
                conn.execute(
                    select(self.run_requests)
                    .where(self.run_requests.c.status.in_(ACTIVE_RUN_REQUEST_STATUSES))
                    .where(self.run_requests.c.current_command_id == command_id)
                )
                .mappings()
                .first()
            )
        return row_to_run_request(row) if row else None

    def pending_command_for_run_request(self, request_id: str) -> dict[str, Any] | None:
        with store_transaction(self.engine) as conn:
            rows = (
                conn.execute(
                    select(self.commands).where(self.commands.c.status == "pending")
                )
                .mappings()
                .all()
            )
        return next(
            (
                record
                for row in rows
                if (record := row_to_command(row))["command"].get("_runRequestId")
                == request_id
            ),
            None,
        )

    def claim_terminal_run_request(
        self,
        command_id: str,
        event: dict[str, Any],
        claim_id: str,
        lease_seconds: float,
    ) -> dict[str, Any] | None:
        now = now_iso()
        with store_transaction(self.engine) as conn:
            row = (
                conn.execute(
                    select(self.run_requests)
                    .where(self.run_requests.c.current_command_id == command_id)
                    .where(self.run_requests.c.status.in_(ACTIVE_RUN_REQUEST_STATUSES))
                    .with_for_update()
                )
                .mappings()
                .first()
            )
            if not row:
                return None
            request = row_to_run_request(row)
            state = dict(request.get("state") or {})
            if request.get("status") == "finalizing":
                expires_at = state.get(TERMINAL_CLAIM_EXPIRES_STATE_KEY)
                if expires_at and _parse_iso(expires_at) > _parse_iso(now):
                    return None
            state.update(
                {
                    TERMINAL_EVENT_STATE_KEY: event,
                    TERMINAL_CLAIM_ID_STATE_KEY: claim_id,
                    TERMINAL_CLAIM_EXPIRES_STATE_KEY: lease_expires_at(
                        now, lease_seconds
                    ),
                }
            )
            updated = {
                **request,
                "status": "finalizing",
                "state": state,
                "updatedAt": now,
            }
            claimed = conn.execute(
                update(self.run_requests)
                .where(self.run_requests.c.id == row["id"])
                .where(self.run_requests.c.updated_at == row["updated_at"])
                .values(
                    **run_request_to_row(
                        updated, database_id=row["id"], node_pk=row["node_id"]
                    )
                )
            )
            if claimed.rowcount != 1:
                return None
            self._append_daemon_event(
                conn,
                daemon_event(
                    "daemon.run_request.finalizing",
                    {
                        "nodeId": updated["nodeId"],
                        "runRequestId": updated["id"],
                        "commandId": command_id,
                    },
                ),
            )
        return updated

    def claim_run_request_dispatch(
        self, request_id: str, claim_id: str, lease_seconds: float
    ) -> dict[str, Any] | None:
        now = now_iso()
        with store_transaction(self.engine) as conn:
            row = (
                conn.execute(
                    select(self.run_requests)
                    .where(self.run_requests.c.id == request_id)
                    .where(self.run_requests.c.status.in_(("running", "dispatching")))
                    .where(self.run_requests.c.current_command_id.is_(None))
                    .with_for_update()
                )
                .mappings()
                .first()
            )
            if not row:
                return None
            request = row_to_run_request(row)
            state = dict(request.get("state") or {})
            if request.get("status") == "dispatching":
                expires_at = state.get(DISPATCH_CLAIM_EXPIRES_STATE_KEY)
                if expires_at and _parse_iso(expires_at) > _parse_iso(now):
                    return None
            state.update(
                {
                    DISPATCH_CLAIM_ID_STATE_KEY: claim_id,
                    DISPATCH_CLAIM_EXPIRES_STATE_KEY: lease_expires_at(
                        now, lease_seconds
                    ),
                }
            )
            updated = {
                **request,
                "status": "dispatching",
                "state": state,
                "updatedAt": now,
            }
            claimed = conn.execute(
                update(self.run_requests)
                .where(self.run_requests.c.id == row["id"])
                .where(self.run_requests.c.updated_at == row["updated_at"])
                .where(self.run_requests.c.current_command_id.is_(None))
                .values(
                    **run_request_to_row(
                        updated, database_id=row["id"], node_pk=row["node_id"]
                    )
                )
            )
            if claimed.rowcount != 1:
                return None
            self._append_daemon_event(
                conn,
                daemon_event(
                    "daemon.run_request.dispatching",
                    {
                        "nodeId": updated["nodeId"],
                        "runRequestId": updated["id"],
                    },
                ),
            )
        return updated

    def update_run_request(
        self, request_id: str, patch: dict[str, Any]
    ) -> dict[str, Any]:
        current = self.get_run_request(request_id)
        if not current:
            raise KeyError(request_id)
        now = now_iso()
        updated = {**current, **patch, "updatedAt": now}
        if patch.get("status") in ("completed", "failed", "cancelled"):
            updated["completedAt"] = now
        with store_transaction(self.engine) as conn:
            node_pk = self._node_pk(conn, updated["nodeId"])
            conn.execute(
                update(self.run_requests)
                .where(self.run_requests.c.id == request_id)
                .values(
                    **run_request_to_row(
                        updated, database_id=current["id"], node_pk=node_pk
                    )
                )
            )
            self._append_daemon_event(
                conn,
                daemon_event(
                    "daemon.run_request.updated",
                    {
                        "nodeId": updated["nodeId"],
                        "runRequestId": updated["id"],
                        "status": updated["status"],
                    },
                ),
            )
        return updated

    def update_run_request_if_claimed(
        self,
        request_id: str,
        claim_key: str,
        claim_id: str,
        patch: dict[str, Any],
    ) -> dict[str, Any] | None:
        now = now_iso()
        with store_transaction(self.engine) as conn:
            row = (
                conn.execute(
                    select(self.run_requests)
                    .where(self.run_requests.c.id == request_id)
                    .with_for_update()
                )
                .mappings()
                .first()
            )
            if not row:
                return None
            current = row_to_run_request(row)
            if (current.get("state") or {}).get(claim_key) != claim_id:
                return None
            updated = {**current, **patch, "updatedAt": now}
            if patch.get("status") in TERMINAL_DAEMON_STATUSES:
                updated["completedAt"] = now
            applied = conn.execute(
                update(self.run_requests)
                .where(self.run_requests.c.id == row["id"])
                .where(self.run_requests.c.updated_at == row["updated_at"])
                .values(
                    **run_request_to_row(
                        updated, database_id=row["id"], node_pk=row["node_id"]
                    )
                )
            )
            if applied.rowcount != 1:
                return None
            self._append_daemon_event(
                conn,
                daemon_event(
                    "daemon.run_request.updated",
                    {
                        "nodeId": updated["nodeId"],
                        "runRequestId": updated["id"],
                        "status": updated["status"],
                    },
                ),
            )
        return updated

    def mark_command_completed(self, node_id: str, event: dict[str, Any]) -> bool:
        return self._mark_command_terminal(
            node_id, event, "completed", event.get("exitCode"), None
        )

    def mark_command_failed(self, node_id: str, event: dict[str, Any]) -> bool:
        return self._mark_command_terminal(
            node_id, event, "failed", event.get("exitCode"), event.get("error")
        )

    def mark_command_cancelled(self, node_id: str, event: dict[str, Any]) -> bool:
        return self._mark_command_terminal(
            node_id, event, "cancelled", None, event.get("reason")
        )

    def mark_cancel_commands_completed(
        self, node_id: str, target_command_id: str
    ) -> None:
        now = now_iso()
        with store_transaction(self.engine) as conn:
            node_pk = self._node_pk(conn, node_id)
            rows = (
                conn.execute(
                    select(self.commands)
                    .where(self.commands.c.node_id == node_pk)
                    .where(self.commands.c.type == "run.cancel")
                    .where(~self.commands.c.status.in_(TERMINAL_DAEMON_STATUSES))
                )
                .mappings()
                .all()
            )
            for row in rows:
                record = row_to_command(row)
                command = record["command"]
                if command.get("commandId") != target_command_id:
                    continue
                updated, completion_event = completed_cancel_record(record, now)
                conn.execute(
                    update(self.commands)
                    .where(self.commands.c.id == record["id"])
                    .values(
                        **command_to_row(
                            updated, database_id=record["id"], node_pk=node_pk
                        )
                    )
                )
                self._append_daemon_event(conn, completion_event)

    def prune_terminal_records(
        self, retention_seconds: float, per_node_limit: int
    ) -> dict[str, int]:
        cutoff = _format_iso(
            _parse_iso(now_iso()) - timedelta(seconds=max(0.0, retention_seconds))
        )
        per_node_limit = max(0, per_node_limit)
        deleted_commands = 0
        deleted_runs = 0
        deleted_events = 0
        with store_transaction(self.engine) as conn:
            command_rows = (
                conn.execute(
                    select(self.commands).where(
                        self.commands.c.status.in_(TERMINAL_DAEMON_STATUSES)
                    )
                )
                .mappings()
                .all()
            )
            command_ids = terminal_database_ids_to_prune(
                command_rows, cutoff, per_node_limit
            )
            if command_ids:
                deleted_commands = (
                    conn.execute(
                        delete(self.commands).where(self.commands.c.id.in_(command_ids))
                    ).rowcount
                    or 0
                )

            run_rows = (
                conn.execute(
                    select(self.runs).where(
                        self.runs.c.status.in_(TERMINAL_DAEMON_STATUSES)
                    )
                )
                .mappings()
                .all()
            )
            run_ids = terminal_database_ids_to_prune(run_rows, cutoff, per_node_limit)
            if run_ids:
                deleted_runs = (
                    conn.execute(
                        delete(self.runs).where(self.runs.c.id.in_(run_ids))
                    ).rowcount
                    or 0
                )

            deleted_events = (
                conn.execute(
                    delete(self.events).where(
                        self.events.c.type.startswith(PRUNABLE_DAEMON_EVENT_PREFIX),
                        self.events.c.timestamp <= _parse_iso(cutoff),
                    )
                ).rowcount
                or 0
            )
        return {
            "commands": deleted_commands,
            "runs": deleted_runs,
            "events": deleted_events,
        }

    def append_daemon_event(self, event: dict[str, Any]) -> None:
        with store_transaction(self.engine) as conn:
            self._append_daemon_event(conn, event)

    def historical_managed_runtime_ids(self, managed_node_id: str) -> set[str]:
        with store_transaction(self.engine) as conn:
            payloads = conn.scalars(
                select(self.events.c.payload).where(
                    self.events.c.type == "daemon.node.registered"
                )
            ).all()
        return {
            runtime_id
            for runtime_id, current_managed_node_id in _managed_runtime_identity_map(
                payloads
            ).items()
            if current_managed_node_id == managed_node_id
        }

    def historical_managed_node_id(self, runtime_id: str) -> str | None:
        return self.historical_managed_node_ids({runtime_id}).get(runtime_id)

    def historical_managed_node_ids(
        self, runtime_ids: set[str]
    ) -> dict[str, str]:
        with store_transaction(self.engine) as conn:
            payloads = conn.scalars(
                select(self.events.c.payload).where(
                    self.events.c.type == "daemon.node.registered"
                )
            ).all()
        identities = _managed_runtime_identity_map(payloads)
        return {
            current_runtime_id: managed_node_id
            for current_runtime_id, managed_node_id in identities.items()
            if current_runtime_id in runtime_ids
        }

    def _mark_command_terminal(
        self,
        node_id: str,
        event: dict[str, Any],
        status: str,
        exit_code: int | None,
        error: str | None,
    ) -> bool:
        now = now_iso()
        with store_transaction(self.engine) as conn:
            node_pk = self._node_pk(conn, node_id)
            row = (
                conn.execute(
                    select(self.commands).where(
                        self.commands.c.id == event["commandId"]
                    )
                )
                .mappings()
                .first()
            )
            if not row:
                return False
            command = row_to_command(row)
            if command.get("status") not in ("queued", "dispatched") or (
                event.get("leaseId") is not None
                and (
                    command.get("status") != "dispatched"
                    or command.get("leaseId") != event["leaseId"]
                )
            ):
                return False
            conn.execute(
                update(self.commands)
                .where(self.commands.c.id == command["id"])
                .values(
                    **command_to_row(
                        {
                            **command,
                            "command": {
                                **command["command"],
                                "_terminalEvent": event,
                            },
                            "status": status,
                            "updatedAt": now,
                            "completedAt": now,
                            **(
                                {"exitCode": exit_code} if exit_code is not None else {}
                            ),
                            **({"error": error} if error else {}),
                        },
                        database_id=command["id"],
                        node_pk=node_pk,
                    )
                )
            )
            run_row = (
                conn.execute(
                    select(self.runs).where(self.runs.c.id == event["runId"])
                )
                .mappings()
                .first()
            )
            run = (
                row_to_run(run_row)
                if run_row
                else {
                    "nodeId": node_id,
                    "commandId": event["commandId"],
                    "sessionId": event["sessionId"],
                    "runId": event["runId"],
                    "agent": event["agent"],
                    "mode": event["mode"],
                    "taskGoal": "",
                    "startedAt": now,
                }
            )
            self._write_run(
                conn,
                {
                    **run,
                    "status": status,
                    "completedAt": now,
                    **({"exitCode": exit_code} if exit_code is not None else {}),
                    **({"error": error} if error else {}),
                },
            )
            event_type = {
                "completed": "daemon.command.completed",
                "failed": "daemon.command.failed",
                "cancelled": "daemon.command.cancelled",
            }[status]
            self._append_daemon_event(
                conn,
                daemon_event(
                    event_type,
                    {
                        "nodeId": node_id,
                        "commandId": event["commandId"],
                        "runId": event["runId"],
                        **({"exitCode": exit_code} if exit_code is not None else {}),
                        **({"error": error} if error else {}),
                    },
                ),
            )
            return True

    def _write_run(self, conn: Any, run: dict[str, Any]) -> None:
        values = run_to_row(run)
        existing = conn.scalar(
            select(self.runs.c.id).where(self.runs.c.id == run["runId"])
        )
        if existing:
            conn.execute(
                update(self.runs)
                .where(self.runs.c.id == existing)
                .values(**run_to_row(run, database_id=existing))
            )
        else:
            conn.execute(insert(self.runs).values(**values))

    def _append_daemon_event(self, conn: Any, event: dict[str, Any]) -> None:
        conn.execute(insert(self.events).values(**daemon_event_to_row(event)))

    def _node_pk(self, conn: Any, node_id: str) -> str:
        node_pk = conn.scalar(
            select(self.nodes.c.id).where(self.nodes.c.id == node_id)
        )
        if not node_pk:
            raise KeyError(node_id)
        return node_pk


def node_to_row(
    node: dict[str, Any], *, database_id: str | None = None
) -> dict[str, Any]:
    return {
        "id": database_id or node["id"],
        "employee_id": node.get("employeeId"),
        "display_name": node.get("displayName"),
        "workspace_path": node.get("workspacePath"),
        "workspace_id": node.get("workspaceId"),
        "sandbox_mode": node.get("sandboxMode"),
        "node_location": node.get("nodeLocation"),
        "managed_node_id": node.get("managedNodeId"),
        "provisioning_attempt_id": node.get("provisioningAttemptId"),
        "credential_version": int(node.get("credentialVersion") or 1),
        "retired_at": _parse_iso(node.get("retiredAt")),
        "status": node["status"],
        # The per-agent maps live in daemon_node_agents; see node_agent_rows.
        "max_concurrent_runs": int(node.get("maxConcurrentRuns") or 1),
        "run_capacity_by_mode": node.get("runCapacityByMode") or {},
        # Only hashes are persisted; plaintext node tokens stay process-local.
        "ui_token_hash": node.get("uiTokenHash"),
        "node_token_hash": node.get("nodeTokenHash"),
        "last_error": node.get("lastError"),
        "created_at": _parse_iso(node["createdAt"]),
        "updated_at": _parse_iso(node["updatedAt"]),
        "last_seen_at": _parse_iso(node.get("lastSeenAt")),
    }


def node_agent_rows(node: dict[str, Any], node_pk: str) -> list[dict[str, Any]]:
    """Flatten a node's five per-agent maps into daemon_node_agents rows."""
    statuses = node.get("agents") or {}
    details = node.get("agentDetails") or {}
    disabled = set(node.get("disabledAgents") or [])
    role_defaults = node.get("agentRoleDefaults") or {}
    role_overrides = node.get("agentRoleOverrides") or {}
    names = (
        set(statuses)
        | set(details)
        | disabled
        | set(role_defaults)
        | set(role_overrides)
    )
    return [
        {
            "node_id": node_pk,
            "agent": agent,
            "status": statuses.get(agent) or "unknown",
            "details": details.get(agent),
            "disabled": agent in disabled,
            "role_default": role_defaults.get(agent),
            "role_override": role_overrides.get(agent),
        }
        for agent in sorted(names)
    ]


def apply_node_agents(node: dict[str, Any], rows: list[Any]) -> dict[str, Any]:
    """Rebuild the per-agent keys on a node from its daemon_node_agents rows.

    Keys stay absent rather than empty, matching what the JSON columns produced,
    so callers and stored payloads keep the same shape.
    """
    statuses: dict[str, Any] = {}
    details: dict[str, Any] = {}
    disabled: list[str] = []
    role_defaults: dict[str, str] = {}
    role_overrides: dict[str, str] = {}
    for row in rows:
        agent = row["agent"]
        statuses[agent] = row["status"]
        if row.get("details") is not None:
            details[agent] = row["details"]
        if row.get("disabled"):
            disabled.append(agent)
        if row.get("role_default"):
            role_defaults[agent] = row["role_default"]
        if row.get("role_override"):
            role_overrides[agent] = row["role_override"]
    return {
        **node,
        "agents": statuses,
        **({"agentDetails": details} if details else {}),
        **({"disabledAgents": sorted(disabled)} if disabled else {}),
        **({"agentRoleDefaults": role_defaults} if role_defaults else {}),
        **({"agentRoleOverrides": role_overrides} if role_overrides else {}),
    }


def row_to_node(row: Any) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        **({"employeeId": row["employee_id"]} if row.get("employee_id") else {}),
        **({"displayName": row["display_name"]} if row.get("display_name") else {}),
        **(
            {"workspacePath": row["workspace_path"]}
            if row.get("workspace_path")
            else {}
        ),
        **({"workspaceId": row["workspace_id"]} if row.get("workspace_id") else {}),
        **({"sandboxMode": row["sandbox_mode"]} if row.get("sandbox_mode") else {}),
        **({"nodeLocation": row["node_location"]} if row.get("node_location") else {}),
        **(
            {"managedNodeId": row["managed_node_id"]}
            if row.get("managed_node_id")
            else {}
        ),
        **(
            {"provisioningAttemptId": row["provisioning_attempt_id"]}
            if row.get("provisioning_attempt_id")
            else {}
        ),
        "credentialVersion": int(row.get("credential_version") or 1),
        **(
            {"retiredAt": _format_iso(row["retired_at"])}
            if row.get("retired_at")
            else {}
        ),
        "status": row["status"],
        "maxConcurrentRuns": int(row.get("max_concurrent_runs") or 1),
        "runCapacityByMode": row.get("run_capacity_by_mode") or {},
        # `agents` and the other per-agent keys are merged in by
        # `apply_node_agents` from the daemon_node_agents rows.
        "agents": {},
        "token": None,
        **({"uiTokenHash": row["ui_token_hash"]} if row.get("ui_token_hash") else {}),
        **(
            {"nodeTokenHash": row["node_token_hash"]}
            if row.get("node_token_hash")
            else {}
        ),
        **({"lastError": row["last_error"]} if row.get("last_error") else {}),
        "createdAt": _format_iso(row["created_at"]),
        "updatedAt": _format_iso(row["updated_at"]),
        **(
            {"lastSeenAt": _format_iso(row["last_seen_at"])}
            if row.get("last_seen_at")
            else {}
        ),
    }


def command_to_row(
    record: dict[str, Any],
    *,
    database_id: str | None = None,
    node_pk: str | None = None,
) -> dict[str, Any]:
    return {
        "id": database_id or record["id"],
        "node_id": node_pk or record.get("nodeDatabaseId"),
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
        "id": str(row["id"]),
        "nodeId": row["node_id"],
        "command": row["command"],
        "status": row["status"],
        "createdAt": _format_iso(row["created_at"]),
        "updatedAt": _format_iso(row["updated_at"]),
        **(
            {"dispatchedAt": _format_iso(row["dispatched_at"])}
            if row.get("dispatched_at")
            else {}
        ),
        **({"leaseId": row["lease_id"]} if row.get("lease_id") else {}),
        **(
            {"leaseExpiresAt": _format_iso(row["lease_expires_at"])}
            if row.get("lease_expires_at")
            else {}
        ),
        "attempt": row.get("attempt") or 0,
        **(
            {"completedAt": _format_iso(row["completed_at"])}
            if row.get("completed_at")
            else {}
        ),
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
    return bool(
        lease_expires_at_value and _parse_iso(lease_expires_at_value) <= _parse_iso(now)
    )


def run_to_row(
    run: dict[str, Any], *, database_id: str | None = None
) -> dict[str, Any]:
    return {
        "id": database_id or run["runId"],
        "node_id": run["nodeId"],
        "command_id": run.get("commandId"),
        "session_id": run["sessionId"],
        "agent": run["agent"],
        "logical_agent_id": run.get("logicalAgentId"),
        "placement_id": run.get("placementId"),
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
        **(
            {"commandId": row["command_id"]}
            if row.get("command_id")
            else {}
        ),
        "sessionId": row["session_id"],
        "runId": str(row["id"]),
        "agent": row["agent"],
        **(
            {"logicalAgentId": row["logical_agent_id"]}
            if row.get("logical_agent_id")
            else {}
        ),
        **({"placementId": row["placement_id"]} if row.get("placement_id") else {}),
        "mode": row["mode"],
        "taskGoal": row["task_goal"],
        **(
            {"workspacePath": row["workspace_path"]}
            if row.get("workspace_path")
            else {}
        ),
        "status": row["status"],
        **({"exitCode": row["exit_code"]} if row.get("exit_code") is not None else {}),
        **({"error": row["error"]} if row.get("error") else {}),
        "startedAt": _format_iso(row["started_at"]),
        **(
            {"completedAt": _format_iso(row["completed_at"])}
            if row.get("completed_at")
            else {}
        ),
    }


def run_request_to_row(
    record: dict[str, Any],
    *,
    database_id: str | None = None,
    node_pk: str | None = None,
) -> dict[str, Any]:
    return {
        "id": database_id or record["id"],
        "node_id": node_pk or record.get("nodeDatabaseId"),
        "session_id": record["sessionId"],
        "task_id": record.get("taskId"),
        "task_goal": record["taskGoal"],
        "assignments": record["assignments"],
        "current_index": record.get("currentIndex", 0),
        "state": record.get("state") or {},
        "status": record["status"],
        "current_command_id": record.get("currentCommandId"),
        "current_run_id": record.get("currentRunId"),
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
        "nodeId": row["node_id"],
        "id": str(row["id"]),
        "sessionId": row["session_id"],
        **({"taskId": row["task_id"]} if row.get("task_id") else {}),
        "taskGoal": row["task_goal"],
        "assignments": row["assignments"] or [],
        "currentIndex": row["current_index"],
        "state": row["state"] or {},
        "status": row["status"],
        **(
            {"currentCommandId": row["current_command_id"]}
            if row.get("current_command_id")
            else {}
        ),
        **(
            {"currentRunId": row["current_run_id"]}
            if row.get("current_run_id")
            else {}
        ),
        **({"currentAgent": row["current_agent"]} if row.get("current_agent") else {}),
        **({"currentMode": row["current_mode"]} if row.get("current_mode") else {}),
        **(
            {"currentStartedAt": _format_iso(row["current_started_at"])}
            if row.get("current_started_at")
            else {}
        ),
        **({"error": row["error"]} if row.get("error") else {}),
        "createdAt": _format_iso(row["created_at"]),
        "updatedAt": _format_iso(row["updated_at"]),
        **(
            {"completedAt": _format_iso(row["completed_at"])}
            if row.get("completed_at")
            else {}
        ),
    }


def daemon_event_to_row(event: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": new_database_id(),
        "node_id": event.get("nodeId"),
        "command_id": event.get("commandId"),
        "run_id": event.get("runId"),
        "type": event["type"],
        "timestamp": _parse_iso(event["timestamp"]),
        "payload": event,
    }
