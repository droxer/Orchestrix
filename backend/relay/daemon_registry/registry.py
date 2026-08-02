from __future__ import annotations

import os
import time
from collections import defaultdict
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from threading import RLock
from typing import Any

from loguru import logger

from ..core.environment import load_backend_env
from ..core.ids import new_database_id, new_relay_id, new_sandbox_id, now_iso
from ..core.models import (
    AGENT_NAMES,
    DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS,
)
from ..persistence.protocols import SessionStore, TaskStore
from ..persistence.stores import (
    infer_node_location,
    relay_event,
)
from ..sessions import (
    SessionController,
    compute_conversation_history,
    compute_prior_agent_bridge,
    compute_prior_handoff_note,
    initial_agent_state,
    merge_agent_state,
)
from .artifacts import (
    daemon_reported_generated_files,
    local_generated_file_item,
    workspace_generated_file_snapshot,
    workspace_generated_files,
)
from .credentials import (
    daemon_node_token_matches,
    hash_daemon_node_token,
    new_daemon_node_token,
    sandbox_ui_token_matches,
)
from .credentials import (
    sandbox_node_auth_error as sandbox_node_auth_error,
)
from .credentials import (
    sandbox_ui_auth_error as sandbox_ui_auth_error,
)
from .scheduling import (
    AGENT_TASK_MODES,
    effective_role_for_assignment,
    node_accepts_run,
    node_status_for_active_runs,
    normalize_agent_role_map,
    normalize_run_capacity,
    workspace_paths_match,
)
from .scheduling import (
    workspace_identity as workspace_identity,
)
from .scheduling import (
    workspace_identity_record as workspace_identity_record,
)

load_backend_env()

DAEMON_NODE_LIVENESS_TIMEOUT_MS = int(
    os.environ.get("RELAY_DAEMON_NODE_LIVENESS_TIMEOUT_MS", "15000")
)
DAEMON_RUN_TIMEOUT_MS = int(
    os.environ.get("RELAY_DAEMON_RUN_TIMEOUT_MS", str(15 * 60 * 1000))
)
# How often an idle daemon's heartbeat reaches the durable node row. Must stay
# comfortably under DAEMON_NODE_LIVENESS_TIMEOUT_MS so a replica reading
# persisted state never mistakes a live node for a stale one.
DAEMON_NODE_SEEN_PERSIST_INTERVAL_SECONDS = float(
    os.environ.get("RELAY_DAEMON_NODE_SEEN_PERSIST_INTERVAL_SECONDS", "5")
)
DAEMON_COMMAND_LEASE_SECONDS = float(
    os.environ.get("RELAY_DAEMON_COMMAND_LEASE_SECONDS", "60")
)
DAEMON_COMMAND_RETENTION_SECONDS = float(
    os.environ.get("RELAY_DAEMON_COMMAND_RETENTION_SECONDS", str(6 * 60 * 60))
)
DAEMON_TERMINAL_RECORD_LIMIT = int(
    os.environ.get("RELAY_DAEMON_TERMINAL_RECORD_LIMIT", "500")
)


@dataclass
class _DispatchLockEntry:
    lock: Any
    users: int = 0


DAEMON_RECORD_PRUNE_INTERVAL_SECONDS = float(
    os.environ.get("RELAY_DAEMON_RECORD_PRUNE_INTERVAL_SECONDS", "60")
)
ARTIFACT_SNAPSHOT_STATE_KEY = "_relay_artifact_snapshot"
TERMINAL_EVENT_STATE_KEY = "_relay_terminal_event"
TERMINAL_CLAIM_ID_STATE_KEY = "_relay_terminal_claim_id"
TERMINAL_CLAIM_EXPIRES_STATE_KEY = "_relay_terminal_claim_expires_at"
TERMINAL_CLAIM_LEASE_SECONDS = float(
    os.environ.get("RELAY_TERMINAL_CLAIM_LEASE_SECONDS", str(15 * 60))
)
DISPATCH_CLAIM_LEASE_SECONDS = float(
    os.environ.get("RELAY_DISPATCH_CLAIM_LEASE_SECONDS", "60")
)
RUN_OUTPUT_BUFFER_MAX_CHARS = int(
    os.environ.get("RELAY_RUN_OUTPUT_BUFFER_MAX_CHARS", str(2 * 1024 * 1024))
)
PERSISTED_AGENT_STATE_KEYS = frozenset(
    {"task_goal", "agent_logs", "last_exit_code", "agent_failures", "token_usage"}
)
DAEMON_CAPABILITY_GENERATED_FILES = "generated-files"
DAEMON_CAPABILITY_WORKSPACE_READ = "workspace-read"
DAEMON_CAPABILITY_WORKSPACE_READ_SHARED = "workspace-read-shared"
DAEMON_CAPABILITY_STRUCTURED_AGENT_EVENTS = "structured-agent-events"
DAEMON_CAPABILITY_THREAD_WORKSPACES = "thread-workspaces"
DAEMON_NODE_CAPABILITIES = frozenset(
    {
        DAEMON_CAPABILITY_GENERATED_FILES,
        DAEMON_CAPABILITY_WORKSPACE_READ,
        DAEMON_CAPABILITY_WORKSPACE_READ_SHARED,
        DAEMON_CAPABILITY_STRUCTURED_AGENT_EVENTS,
        DAEMON_CAPABILITY_THREAD_WORKSPACES,
    }
)
DAEMON_SANDBOX_MODES = frozenset({"none", "boxlite"})


def public_sandbox_record(sandbox: dict[str, Any]) -> dict[str, Any]:
    return {
        k: v
        for k, v in sandbox.items()
        if k not in ("token", "tokenHash", "uiTokenHash", "nodeTokenHash", "nodeToken")
        and v is not None
    }


def provisioned_sandbox_record(sandbox: dict[str, Any]) -> dict[str, Any]:
    public = public_sandbox_record(sandbox)
    if sandbox.get("token"):
        public["token"] = sandbox["token"]
    return public


def _string_metadata(value: Any, limit: int = 500) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text[:limit] if text else None


def agent_registration_state(
    payload: dict[str, Any],
) -> tuple[dict[str, str], dict[str, dict[str, str]]]:
    supported = set(payload.get("supportedAgents") or [])
    raw_health = (
        payload.get("agentHealth")
        if isinstance(payload.get("agentHealth"), dict)
        else {}
    )
    raw_capabilities = (
        payload.get("executorCapabilities")
        if isinstance(payload.get("executorCapabilities"), list)
        else []
    )
    capability_by_kind = {
        item.get("executorKind"): item
        for item in raw_capabilities
        if isinstance(item, dict) and item.get("executorKind") in AGENT_NAMES
    }
    agents: dict[str, str] = {}
    details: dict[str, dict[str, str]] = {}
    for agent in AGENT_NAMES:
        raw = capability_by_kind.get(agent) or (
            raw_health.get(agent) if isinstance(raw_health, dict) else None
        )
        status = raw.get("status") if isinstance(raw, dict) else None
        agents[agent] = (
            "failed"
            if status == "failed"
            else "ready"
            if status == "ready" or agent in supported
            else "unknown"
        )
        if isinstance(raw, dict):
            detail: dict[str, str] = {}
            for key in ("detail", "version", "adapter"):
                value = _string_metadata(raw.get(key))
                if value:
                    detail[key] = value
            if detail:
                details[agent] = detail
    return agents, details


_MCP_TRANSPORTS = ("stdio", "sse", "http")


def agent_inventory_state(
    payload: dict[str, Any],
) -> dict[str, dict[str, list[dict[str, str]]]]:
    """Sanitize the daemon-reported per-agent skill/MCP inventory.

    Untrusted daemon payload: keep only known agents and well-typed fields, and
    drop agents that report nothing so the record stays compact.
    """
    raw = payload.get("agentInventory")
    if not isinstance(raw, dict):
        return {}
    inventory: dict[str, dict[str, list[dict[str, str]]]] = {}
    for agent in AGENT_NAMES:
        entry = raw.get(agent)
        if not isinstance(entry, dict):
            continue
        skills = _clean_skills(entry.get("skills"))
        mcp_servers = _clean_mcp_servers(entry.get("mcpServers"))
        if skills or mcp_servers:
            inventory[agent] = {"skills": skills, "mcpServers": mcp_servers}
    return inventory


def daemon_command_payload(record: dict[str, Any]) -> dict[str, Any]:
    return {
        **{
            key: value
            for key, value in record["command"].items()
            if not key.startswith("_")
        },
        **({"leaseId": record["leaseId"]} if record.get("leaseId") else {}),
        **(
            {"leaseExpiresAt": record["leaseExpiresAt"]}
            if record.get("leaseExpiresAt")
            else {}
        ),
        **({"attempt": record["attempt"]} if record.get("attempt") is not None else {}),
    }


def _clean_skills(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    skills: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        name = _string_metadata(item.get("name"), limit=200)
        if not name:
            continue
        skill = {"name": name}
        namespace = _string_metadata(item.get("namespace"), limit=200)
        if namespace:
            skill["namespace"] = namespace
        description = _string_metadata(item.get("description"), limit=500)
        if description:
            skill["description"] = description
        skills.append(skill)
    return skills


def _clean_mcp_servers(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    servers: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        name = _string_metadata(item.get("name"), limit=200)
        if not name:
            continue
        transport = item.get("transport")
        server = {
            "name": name,
            "transport": transport if transport in _MCP_TRANSPORTS else "stdio",
        }
        command = _string_metadata(item.get("command"), limit=500)
        if command:
            server["command"] = command
        servers.append(server)
    return servers


class DaemonNodeRegistry:
    def __init__(
        self,
        store: SessionStore,
        daemon_store: Any,
        *,
        task_store: TaskStore | None = None,
        liveness_timeout_ms: int = DAEMON_NODE_LIVENESS_TIMEOUT_MS,
    ):
        self.store = store
        self.daemon_store = daemon_store
        self.task_store = task_store
        self.liveness_timeout_ms = liveness_timeout_ms
        self.sandboxes: dict[str, dict[str, Any]] = {}
        self.active_commands: dict[str, dict[str, Any]] = {}
        self.outputs: dict[str, list[str]] = {}
        self.output_sizes: dict[str, int] = {}
        self.output_sequences: dict[str, dict[str, int]] = {}
        self.output_sequences_hydrated: set[str] = set()
        # Control-panel provisioning needs to render the launch command again
        # during the current backend process. This cache is deliberately
        # ephemeral and is never used for managed enrollment credentials,
        # which are delivered exactly once by the enrollment response.
        self.plain_node_tokens: dict[str, str] = {}
        self.dispatch_lock = RLock()
        self._dispatch_locks_guard = RLock()
        self._dispatch_locks: dict[str, _DispatchLockEntry] = {}
        self.logical_assignment_validator: Callable[[dict[str, Any]], None] | None = (
            None
        )
        self._last_reap_at = 0.0
        self._last_prune_at = 0.0
        self._last_seen_persisted_at: dict[str, float] = {}
        self._load_persisted_state()

    @contextmanager
    def dispatch_scope(self, node_ids: list[str]) -> Iterator[None]:
        """Serialize one node's mutations without blocking unrelated nodes."""
        keys = sorted({node_id for node_id in node_ids if node_id})
        with self._dispatch_locks_guard:
            entries = []
            for key in keys:
                entry = self._dispatch_locks.setdefault(
                    key, _DispatchLockEntry(RLock())
                )
                entry.users += 1
                entries.append((key, entry))
        for _, entry in entries:
            entry.lock.acquire()
        try:
            yield
        finally:
            for _, entry in reversed(entries):
                entry.lock.release()
            with self._dispatch_locks_guard:
                for key, entry in entries:
                    entry.users -= 1
                    if entry.users == 0 and self._dispatch_locks.get(key) is entry:
                        self._dispatch_locks.pop(key, None)

    def register(
        self,
        payload: dict[str, Any],
        ui_token: str | None = None,
        *,
        authorized_node_location: str | None = None,
    ) -> dict[str, Any]:
        with self.dispatch_scope([payload["sandboxId"]]):
            return self._register_unlocked(
                payload,
                ui_token,
                authorized_node_location=authorized_node_location,
            )

    def _register_unlocked(
        self,
        payload: dict[str, Any],
        ui_token: str | None,
        *,
        authorized_node_location: str | None = None,
    ) -> dict[str, Any]:
        if payload["protocolVersion"] not in DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS:
            raise ValueError(
                f"daemon node protocolVersion {payload['protocolVersion']} is not supported."
            )
        now = now_iso()
        existing = self.sandboxes.get(payload["sandboxId"])
        if (
            existing and existing.get("nodeTokenHash")
        ) and not daemon_node_token_matches(existing, payload["token"]):
            logger.warning(
                "Unauthorized daemon node registration", sandbox_id=payload["sandboxId"]
            )
            raise PermissionError(
                f"Unauthorized daemon node registration for {payload['sandboxId']}: token does not match the token issued at provisioning."
            )
        employee_id = (
            (existing or {}).get("employeeId")
            if existing
            else payload.get("employeeId")
        )
        next_ui_hash = (
            hash_daemon_node_token(ui_token)
            if ui_token
            else (existing or {}).get("uiTokenHash")
        )
        agents, agent_details = agent_registration_state(payload)
        executor_capabilities = [
            item
            for item in (payload.get("executorCapabilities") or [])
            if isinstance(item, dict) and item.get("executorKind") in AGENT_NAMES
        ]
        agent_inventory = agent_inventory_state(payload)
        prior_disabled = list((existing or {}).get("disabledAgents") or [])
        prior_role_defaults = dict((existing or {}).get("agentRoleDefaults") or {})
        prior_role_overrides = dict((existing or {}).get("agentRoleOverrides") or {})
        prior_display_name = self._registration_display_name(
            payload, employee_id, existing
        )
        retired_at = (existing or {}).get("retiredAt")
        capacity_input = {
            **(
                {"maxConcurrentRuns": (existing or {}).get("maxConcurrentRuns")}
                if (existing or {}).get("maxConcurrentRuns")
                and "maxConcurrentRuns" not in payload
                else {}
            ),
            **(
                {"runCapacityByMode": (existing or {}).get("runCapacityByMode")}
                if (existing or {}).get("runCapacityByMode")
                and "runCapacityByMode" not in payload
                else {}
            ),
            **payload,
        }
        max_concurrent_runs, run_capacity_by_mode = normalize_run_capacity(
            capacity_input
        )
        capabilities = sorted(
            {
                value
                for value in (payload.get("capabilities") or [])
                if isinstance(value, str) and value in DAEMON_NODE_CAPABILITIES
            }
        )
        sandbox_mode = payload.get("sandboxMode")
        if sandbox_mode not in DAEMON_SANDBOX_MODES:
            sandbox_mode = (existing or {}).get("sandboxMode")
        sandbox = {
            "id": payload["sandboxId"],
            **({"employeeId": employee_id} if employee_id else {}),
            **(
                {"managedNodeId": existing["managedNodeId"]}
                if (existing or {}).get("managedNodeId")
                else {}
            ),
            **(
                {"provisioningAttemptId": existing["provisioningAttemptId"]}
                if (existing or {}).get("provisioningAttemptId")
                else {}
            ),
            **(
                {"credentialVersion": existing.get("credentialVersion", 1)}
                if (existing or {}).get("managedNodeId")
                else {}
            ),
            **(
                {"workspacePath": payload["workspacePath"]}
                if payload.get("workspacePath")
                else {}
            ),
            **(
                {
                    "workspaceId": payload.get("workspaceId")
                    or (existing or {}).get("workspaceId")
                }
                if payload.get("workspaceId") or (existing or {}).get("workspaceId")
                else {}
            ),
            **({"sandboxMode": sandbox_mode} if sandbox_mode else {}),
            **(
                {
                    "nodeLocation": (existing or {}).get("nodeLocation")
                    or authorized_node_location
                }
                if (existing or {}).get("nodeLocation") or authorized_node_location
                else {}
            ),
            **({"capabilities": capabilities} if capabilities else {}),
            "status": "stopped"
            if retired_at
            else "running"
            if payload.get("status") == "busy"
            else "stopped"
            if payload.get("status") == "stopped"
            else "ready",
            "agents": agents,
            **(
                {"executorCapabilities": executor_capabilities}
                if executor_capabilities
                else {}
            ),
            **({"agentDetails": agent_details} if agent_details else {}),
            **({"agentInventory": agent_inventory} if agent_inventory else {}),
            **({"displayName": prior_display_name} if prior_display_name else {}),
            **({"disabledAgents": prior_disabled} if prior_disabled else {}),
            **(
                {"agentRoleDefaults": prior_role_defaults}
                if prior_role_defaults
                else {}
            ),
            **(
                {"agentRoleOverrides": prior_role_overrides}
                if prior_role_overrides
                else {}
            ),
            **({"retiredAt": retired_at} if retired_at else {}),
            "maxConcurrentRuns": max_concurrent_runs,
            "runCapacityByMode": run_capacity_by_mode,
            "uiTokenHash": next_ui_hash,
            "nodeTokenHash": hash_daemon_node_token(payload.get("token"))
            or (existing or {}).get("nodeTokenHash"),
            "createdAt": (existing or {}).get("createdAt", now),
            "updatedAt": now,
            "lastSeenAt": now,
        }
        self.sandboxes[sandbox["id"]] = sandbox
        self._remember_control_panel_node_token(sandbox, payload.get("token"))
        # Retire the superseded rows before inserting, or the new incarnation
        # collides with them on uq_daemon_nodes_computer.
        if not retired_at:
            self._retire_superseded_incarnations(sandbox)
        self.daemon_store.register_node(sandbox)
        logger.info(
            "Daemon node registered",
            sandbox_id=sandbox["id"],
            employee_id=sandbox.get("employeeId"),
            status=sandbox["status"],
            agents={agent: status for agent, status in sandbox["agents"].items()},
        )
        return sandbox

    def _superseded_incarnations(self, sandbox: dict[str, Any]) -> list[dict[str, Any]]:
        """Live node rows describing the same Computer as `sandbox`.

        A Computer is identified by (employeeId, workspaceId) for an employee
        device and by managedNodeId for a managed one -- never by the daemon's
        own sandboxId, which changes whenever the daemon process is replaced.
        """
        managed_node_id = sandbox.get("managedNodeId")
        employee_id = sandbox.get("employeeId")
        workspace_id = sandbox.get("workspaceId")
        if not managed_node_id and not (employee_id and workspace_id):
            return []
        return [
            node
            for node in self.sandboxes.values()
            if node["id"] != sandbox["id"]
            and not node.get("retiredAt")
            and (
                node.get("managedNodeId") == managed_node_id
                if managed_node_id
                else (
                    not node.get("managedNodeId")
                    and node.get("employeeId") == employee_id
                    and node.get("workspaceId") == workspace_id
                )
            )
        ]

    def _retire_superseded_incarnations(self, sandbox: dict[str, Any]) -> None:
        for node in self._superseded_incarnations(sandbox):
            retired_at = now_iso()
            self.sandboxes[node["id"]] = {
                **node,
                "retiredAt": retired_at,
                "status": "stopped",
                "updatedAt": retired_at,
            }
            self.daemon_store.mark_node_seen(
                node["id"], {"retiredAt": retired_at, "status": "stopped"}
            )
            logger.info(
                "Retired superseded daemon node incarnation",
                sandbox_id=node["id"],
                superseded_by=sandbox["id"],
                employee_id=node.get("employeeId"),
                workspace_id=node.get("workspaceId"),
            )

    def _registration_display_name(
        self,
        payload: dict[str, Any],
        employee_id: str | None,
        existing: dict[str, Any] | None,
    ) -> str | None:
        if existing is not None:
            display_name = existing.get("displayName")
            return str(display_name) if display_name else None
        workspace_id = payload.get("workspaceId")
        if not employee_id or not workspace_id:
            return None
        matches = [
            node
            for node in self.sandboxes.values()
            if node["id"] != payload["sandboxId"]
            and node.get("employeeId") == employee_id
            and node.get("workspaceId") == workspace_id
            and not node.get("managedNodeId")
        ]
        if not matches:
            return None
        matches.sort(
            key=lambda node: node.get("updatedAt") or node.get("createdAt") or "",
            reverse=True,
        )
        display_name = matches[0].get("displayName")
        return str(display_name) if display_name else None

    def get(self, sandbox_id: str) -> dict[str, Any] | None:
        if sandbox_id not in self.sandboxes:
            self._refresh_persisted_liveness(sandbox_id)
        return self.sandboxes.get(sandbox_id)

    def list_ready(self) -> list[dict[str, Any]]:
        self._refresh_persisted_liveness()
        if not self.sandboxes:
            return []
        active_runs_by_node = self._active_runs_by_node()
        return sorted(
            self.sandboxes.values(),
            key=lambda sandbox: self._selection_key(
                sandbox, active_runs_by_node.get(sandbox["id"], [])
            ),
        )

    def update_status(self, sandbox_id: str, patch: dict[str, Any]) -> None:
        sandbox = self.sandboxes.get(sandbox_id)
        if not sandbox:
            return
        next_patch = {k: v for k, v in patch.items() if v is not None}
        if sandbox.get("retiredAt"):
            next_patch["status"] = "stopped"
        if next_patch.get("status") in ("ready", "running"):
            next_patch["status"] = node_status_for_active_runs(
                {**sandbox, **next_patch},
                self.daemon_store.list_active_runs(sandbox_id),
            )
        status = next_patch.get("status", sandbox.get("status"))
        updated = {**sandbox, **next_patch, "updatedAt": now_iso()}
        if "lastError" in patch and patch["lastError"] is None:
            updated.pop("lastError", None)
        self.sandboxes[sandbox_id] = updated
        self.daemon_store.mark_node_seen(sandbox_id, patch)
        logger.debug("Daemon node status updated", sandbox_id=sandbox_id, status=status)

    def monitor_nodes(self) -> list[dict[str, Any]]:
        self._refresh_persisted_liveness()
        self.reap_stale_runs(force=False)
        active_runs_by_node = self._active_runs_by_node()
        queued_counts = self.daemon_store.queued_command_counts()
        nodes = []
        for sandbox in sorted(
            self.sandboxes.values(),
            key=lambda item: self._selection_key(
                item, active_runs_by_node.get(item["id"], [])
            ),
        ):
            liveness = self._liveness(sandbox)
            nodes.append(
                {
                    **public_sandbox_record(sandbox),
                    "queuedCommandCount": queued_counts.get(sandbox["id"], 0),
                    "activeRuns": [
                        daemon_active_run(run)
                        for run in active_runs_by_node.get(sandbox["id"], [])
                    ],
                    "online": liveness["online"],
                    "stale": liveness["stale"],
                    **(
                        {"lastSeenAgeMs": liveness["lastSeenAgeMs"]}
                        if "lastSeenAgeMs" in liveness
                        else {}
                    ),
                }
            )
        return nodes

    def monitor_nodes_for_token(self, token: str | None) -> list[dict[str, Any]] | None:
        if not token:
            return None
        allowed = {
            sandbox["id"]
            for sandbox in self.sandboxes.values()
            if sandbox_ui_token_matches(sandbox, token)
        }
        if not allowed:
            return None
        return [node for node in self.monitor_nodes() if node["id"] in allowed]

    def control_panel_nodes(self) -> list[dict[str, Any]]:
        nodes = self.monitor_nodes()
        for node in nodes:
            plain = self.plain_node_tokens.get(node["id"])
            if plain:
                node["nodeToken"] = plain
        return nodes

    def assign_employee(self, sandbox_id: str, employee_id: str) -> dict[str, Any]:
        sandbox = self.sandboxes.get(sandbox_id)
        if not sandbox:
            raise KeyError(sandbox_id)
        if sandbox.get("employeeId"):
            raise ValueError("Daemon node is already assigned.")
        persisted = self.daemon_store.assign_node_employee(sandbox_id, employee_id)
        updated = {**sandbox, **persisted}
        self.sandboxes[sandbox_id] = updated
        logger.info(
            "Daemon node assigned", sandbox_id=sandbox_id, employee_id=employee_id
        )
        return updated

    def unassign_employee_everywhere(self, employee_id: str) -> list[str]:
        affected: list[str] = []
        for sandbox_id, sandbox in list(self.sandboxes.items()):
            if sandbox.get("employeeId") == employee_id:
                self.unassign_employee(sandbox_id)
                affected.append(sandbox_id)
        return affected

    def unassign_employee(self, sandbox_id: str) -> dict[str, Any]:
        sandbox = self.sandboxes.get(sandbox_id)
        if not sandbox:
            raise KeyError(sandbox_id)
        if not sandbox.get("employeeId"):
            raise ValueError("Daemon node is not assigned.")
        previous = sandbox["employeeId"]
        updated = {
            k: v
            for k, v in sandbox.items()
            if k not in ("employeeId", "agentRoleOverrides")
        }
        updated["updatedAt"] = now_iso()
        self.sandboxes[sandbox_id] = updated
        self.daemon_store.unassign_node_employee(sandbox_id)
        logger.info(
            "Daemon node unassigned",
            sandbox_id=sandbox_id,
            previous_employee_id=previous,
        )
        return updated

    def set_disabled_agents(
        self, sandbox_id: str, disabled_agents: list[str]
    ) -> dict[str, Any]:
        sandbox = self.sandboxes.get(sandbox_id)
        if not sandbox:
            raise KeyError(sandbox_id)
        invalid = [name for name in disabled_agents if name not in AGENT_NAMES]
        if invalid:
            raise ValueError(f"Unknown agent name(s): {', '.join(invalid)}.")
        normalized = sorted({name for name in disabled_agents})
        updated = {**sandbox, "disabledAgents": normalized, "updatedAt": now_iso()}
        if not normalized:
            updated.pop("disabledAgents", None)
        self.sandboxes[sandbox_id] = updated
        self.daemon_store.update_node_disabled_agents(sandbox_id, normalized)
        logger.info(
            "Daemon node disabled agents updated",
            sandbox_id=sandbox_id,
            disabled_agents=normalized,
        )
        return updated

    def set_display_name(
        self, sandbox_id: str, display_name: str | None
    ) -> dict[str, Any]:
        sandbox = self.sandboxes.get(sandbox_id)
        if not sandbox:
            raise KeyError(sandbox_id)
        updated = {**sandbox, "updatedAt": now_iso()}
        if display_name:
            updated["displayName"] = display_name
        else:
            updated.pop("displayName", None)
        self.sandboxes[sandbox_id] = updated
        self.daemon_store.update_node_display_name(sandbox_id, display_name)
        logger.info(
            "Daemon node display name updated",
            sandbox_id=sandbox_id,
            display_name=display_name,
        )
        return updated

    def fence_managed_node(self, sandbox_id: str) -> dict[str, Any]:
        sandbox = self.sandboxes.get(sandbox_id)
        if not sandbox:
            raise KeyError(sandbox_id)
        retired_at = now_iso()
        updated = {
            **sandbox,
            "retiredAt": retired_at,
            "status": "stopped",
            "updatedAt": retired_at,
        }
        self.sandboxes[sandbox_id] = updated
        self.daemon_store.mark_node_seen(
            sandbox_id, {"retiredAt": retired_at, "status": "stopped"}
        )
        return updated

    def set_agent_role_defaults(
        self, sandbox_id: str, role_defaults: dict[str, str]
    ) -> dict[str, Any]:
        sandbox = self.sandboxes.get(sandbox_id)
        if not sandbox:
            raise KeyError(sandbox_id)
        normalized = normalize_agent_role_map(role_defaults)
        updated = {**sandbox, "agentRoleDefaults": normalized, "updatedAt": now_iso()}
        if not normalized:
            updated.pop("agentRoleDefaults", None)
        self.sandboxes[sandbox_id] = updated
        self.daemon_store.update_node_agent_role_defaults(sandbox_id, normalized)
        logger.info(
            "Daemon node agent role defaults updated",
            sandbox_id=sandbox_id,
            agent_role_defaults=normalized,
        )
        return updated

    def set_agent_role_overrides(
        self, sandbox_id: str, role_overrides: dict[str, str]
    ) -> dict[str, Any]:
        sandbox = self.sandboxes.get(sandbox_id)
        if not sandbox:
            raise KeyError(sandbox_id)
        normalized = normalize_agent_role_map(role_overrides)
        updated = {**sandbox, "agentRoleOverrides": normalized, "updatedAt": now_iso()}
        if not normalized:
            updated.pop("agentRoleOverrides", None)
        self.sandboxes[sandbox_id] = updated
        self.daemon_store.update_node_agent_role_overrides(sandbox_id, normalized)
        logger.info(
            "Daemon node agent role overrides updated",
            sandbox_id=sandbox_id,
            agent_role_overrides=normalized,
        )
        return updated

    def delete(self, sandbox_id: str) -> None:
        sandbox = self.sandboxes.get(sandbox_id)
        if not sandbox:
            raise KeyError(sandbox_id)
        active_runs = self.daemon_store.list_active_runs(sandbox_id)
        if active_runs:
            raise ValueError(
                "Daemon node has active runs; cancel them before deleting."
            )
        self.daemon_store.delete_node(sandbox_id)
        self.sandboxes.pop(sandbox_id, None)
        self.plain_node_tokens.pop(sandbox_id, None)
        self._last_seen_persisted_at.pop(sandbox_id, None)
        for command_id, command in list(self.active_commands.items()):
            if (
                command.get("sandboxId") == sandbox_id
                or command.get("nodeId") == sandbox_id
            ):
                self.active_commands.pop(command_id, None)
                if command.get("runId"):
                    self.clear_run_output(command["runId"])
        logger.info("Daemon node deleted", sandbox_id=sandbox_id)

    def provision_pending(
        self,
        employee_id: str | None = None,
        workspace_path: str | None = None,
        sandbox_mode: str = "boxlite",
        node_location: str | None = "employee-device",
        display_name: str | None = None,
    ) -> tuple[dict[str, Any], str | None, str | None]:
        if sandbox_mode not in DAEMON_SANDBOX_MODES:
            sandbox_mode = "boxlite"
        if employee_id:
            existing = self.find_by_employee(employee_id, workspace_path)
            if existing:
                node_token = self.plain_node_tokens.get(existing["id"])
                updates: dict[str, Any] = {}
                if not existing.get("sandboxMode"):
                    updates["sandboxMode"] = sandbox_mode
                if not existing.get("nodeLocation") and node_location:
                    updates["nodeLocation"] = node_location
                if display_name and display_name != existing.get("displayName"):
                    updates["displayName"] = display_name
                if updates:
                    existing = {
                        **existing,
                        **updates,
                        "updatedAt": now_iso(),
                    }
                    self.sandboxes[existing["id"]] = existing
                    self.daemon_store.register_node(existing)
                if (
                    node_location == "employee-device"
                    and existing.get("status") == "provisioning"
                    and not node_token
                ):
                    # Plaintext launch credentials are intentionally volatile.
                    # Reissuing an unfinished enrollment after restart rotates
                    # the old credential instead of creating a duplicate node.
                    node_token = new_daemon_node_token()
                    existing = {
                        **existing,
                        "nodeTokenHash": hash_daemon_node_token(node_token),
                        "updatedAt": now_iso(),
                    }
                    self.sandboxes[existing["id"]] = existing
                    self.daemon_store.register_node(existing)
                    self._remember_control_panel_node_token(existing, node_token)
                return (
                    existing,
                    None,
                    node_token,
                )
        sandbox_id = new_sandbox_id()
        ui_token = new_daemon_node_token()
        node_token = new_daemon_node_token()
        now = now_iso()
        sandbox = {
            "id": sandbox_id,
            **({"employeeId": employee_id} if employee_id else {}),
            **({"workspacePath": workspace_path} if workspace_path else {}),
            **({"displayName": display_name} if display_name else {}),
            "sandboxMode": sandbox_mode,
            **({"nodeLocation": node_location} if node_location else {}),
            "status": "provisioning",
            "agents": {agent: "unknown" for agent in AGENT_NAMES},
            "maxConcurrentRuns": 1,
            "runCapacityByMode": {mode: 1 for mode in AGENT_TASK_MODES},
            "uiTokenHash": hash_daemon_node_token(ui_token),
            "nodeTokenHash": hash_daemon_node_token(node_token),
            "createdAt": now,
            "updatedAt": now,
            "lastError": "Waiting for daemon node registration.",
        }
        self.sandboxes[sandbox_id] = sandbox
        self._remember_control_panel_node_token(sandbox, node_token)
        self.daemon_store.register_node(sandbox)
        logger.info(
            "Daemon node provisioned",
            sandbox_id=sandbox_id,
            employee_id=employee_id,
            workspace_path=workspace_path,
        )
        return sandbox, ui_token, node_token

    def _remember_control_panel_node_token(
        self, sandbox: dict[str, Any], token: str | None
    ) -> None:
        """Cache only control-panel launch credentials, until process restart."""
        if token and not sandbox.get("managedNodeId"):
            self.plain_node_tokens[sandbox["id"]] = token

    def enroll_managed_node(
        self,
        managed_node: dict[str, Any],
        attempt: dict[str, Any],
        payload: dict[str, Any],
    ) -> tuple[dict[str, Any], str]:
        """Create the observed daemon identity for a consumed enrollment grant."""
        sandbox_id = new_sandbox_id()
        node_token = new_daemon_node_token()
        now = now_iso()
        sandbox = {
            "id": sandbox_id,
            **(
                {"employeeId": managed_node["employeeId"]}
                if managed_node.get("employeeId")
                else {}
            ),
            **(
                {"workspacePath": payload["workspacePath"]}
                if payload.get("workspacePath")
                else {}
            ),
            "sandboxMode": managed_node.get("sandboxMode") or "boxlite",
            "nodeLocation": "managed",
            "managedNodeId": managed_node["id"],
            "provisioningAttemptId": attempt["id"],
            "credentialVersion": 1,
            "status": "provisioning",
            "agents": {agent: "unknown" for agent in AGENT_NAMES},
            "maxConcurrentRuns": 1,
            "runCapacityByMode": {mode: 1 for mode in AGENT_TASK_MODES},
            "nodeTokenHash": hash_daemon_node_token(node_token),
            "createdAt": now,
            "updatedAt": now,
            "lastError": "Waiting for daemon node registration.",
        }
        self.sandboxes[sandbox_id] = sandbox
        # Managed runtime credentials are intentionally not added to
        # plain_node_tokens and therefore cannot be recovered by control-panel
        # reads after this response.
        self.daemon_store.register_node(sandbox)
        logger.info(
            "Managed daemon node enrolled",
            sandbox_id=sandbox_id,
            managed_node_id=managed_node["id"],
            attempt_id=attempt["id"],
        )
        return sandbox, node_token

    def find_by_employee(
        self, employee_id: str, workspace_path: str | None = None
    ) -> dict[str, Any] | None:
        self._refresh_persisted_liveness()
        matches = [
            sandbox
            for sandbox in self.sandboxes.values()
            if sandbox.get("employeeId") == employee_id
            and (
                not workspace_path
                or not sandbox.get("workspacePath")
                or workspace_paths_match(sandbox.get("workspacePath"), workspace_path)
            )
        ]
        if not matches:
            return None
        active_runs_by_node = self._active_runs_by_node()
        return min(
            matches,
            key=lambda sandbox: self._selection_key(
                sandbox, active_runs_by_node.get(sandbox["id"], [])
            ),
        )

    def _active_runs_by_node(self) -> dict[str, list[dict[str, Any]]]:
        active_runs_by_node: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for run in self.daemon_store.list_active_runs():
            active_runs_by_node[run["nodeId"]].append(run)
        return active_runs_by_node

    def _selection_key(
        self, sandbox: dict[str, Any], active_runs: list[dict[str, Any]]
    ) -> tuple[int, int, float, str]:
        liveness = self._liveness(sandbox)
        timestamp = (
            sandbox.get("lastSeenAt")
            or sandbox.get("updatedAt")
            or sandbox.get("createdAt")
            or ""
        )
        try:
            seen_at = datetime.fromisoformat(
                timestamp.replace("Z", "+00:00")
            ).timestamp()
        except ValueError:
            seen_at = 0.0
        return (
            0
            if liveness["online"]
            and node_accepts_run(
                sandbox, assignments=[{"mode": "ask"}], active_runs=active_runs
            )
            else 1,
            0 if liveness["online"] else 1,
            -seen_at,
            sandbox["id"],
        )

    def is_live(self, sandbox_id: str) -> bool:
        self._refresh_persisted_liveness(sandbox_id)
        sandbox = self.sandboxes.get(sandbox_id)
        return bool(sandbox and self._liveness(sandbox)["online"])

    def enqueue(self, sandbox_id: str, command: dict[str, Any]) -> None:
        with self.dispatch_scope([sandbox_id]):
            self._enqueue_unlocked(sandbox_id, command)

    def _enqueue_unlocked(self, sandbox_id: str, command: dict[str, Any]) -> None:
        self.daemon_store.enqueue_command(sandbox_id, command)
        logger.debug(
            "Command enqueued",
            sandbox_id=sandbox_id,
            command_id=command["id"],
            command_type=command["type"],
        )
        self._track_active_command(sandbox_id, command)

    def _track_active_command(self, sandbox_id: str, command: dict[str, Any]) -> None:
        if command["type"] == "run.start":
            self.active_commands[command["id"]] = {
                "sandboxId": sandbox_id,
                "commandId": command["id"],
                "sessionId": command["sessionId"],
                "runId": command["runId"],
                "agent": command["agent"],
                "mode": command["mode"],
                "taskGoal": command["taskGoal"],
                **(
                    {"workspacePath": command["workspacePath"]}
                    if command.get("workspacePath")
                    else {}
                ),
                "startedAt": now_iso(),
            }

    def take_commands(
        self,
        sandbox_id: str,
        token: str | None,
        *,
        limit: int = 2**53,
        lease_seconds: float = DAEMON_COMMAND_LEASE_SECONDS,
        renew_known_active: bool = True,
    ) -> list[dict[str, Any]]:
        # Global recovery runs before the node scope so command polling never
        # inverts the terminal-event lock order (global -> node).
        self.reap_stale_runs(force=False)
        self._hydrate_node(sandbox_id)
        with self.dispatch_scope([sandbox_id]):
            return self._take_commands_unlocked(
                sandbox_id,
                token,
                limit=limit,
                lease_seconds=lease_seconds,
                renew_known_active=renew_known_active,
            )

    def heartbeat_settings(self) -> dict[str, int]:
        """Return the server-owned lease policy advertised to every daemon."""
        return {
            "intervalMs": max(1, self.liveness_timeout_ms // 3),
            "timeoutMs": self.liveness_timeout_ms,
        }

    def heartbeat(
        self,
        sandbox_id: str,
        token: str | None,
        command_leases: list[tuple[str, str | None]] | None = None,
        *,
        lease_seconds: float = DAEMON_COMMAND_LEASE_SECONDS,
    ) -> dict[str, Any]:
        """Renew node liveness and any run leases through one explicit seam.

        Command polling and run events still count as observations for older
        daemons, but new daemons no longer depend on either traffic pattern to
        remain live. Both employee-device and managed nodes use this contract;
        infrastructure recovery remains a managed-node policy concern.
        """
        self._hydrate_node(sandbox_id)
        with self.dispatch_scope([sandbox_id]):
            self._assert_authorized(sandbox_id, token)
            sandbox = self.sandboxes[sandbox_id]
            if sandbox.get("retiredAt"):
                raise PermissionError("Retired daemon node cannot renew its lease.")
            self._mark_seen(sandbox_id)
            if command_leases:
                self._renew_command_leases(
                    sandbox_id,
                    command_leases,
                    lease_seconds=lease_seconds,
                )
            observed = self.sandboxes[sandbox_id]
            return {
                "observedAt": observed["lastSeenAt"],
                **self.heartbeat_settings(),
            }

    def _take_commands_unlocked(
        self,
        sandbox_id: str,
        token: str | None,
        *,
        limit: int,
        lease_seconds: float,
        renew_known_active: bool,
    ) -> list[dict[str, Any]]:
        self._assert_authorized(sandbox_id, token)
        self._mark_seen(sandbox_id)
        if renew_known_active:
            self._renew_known_active_command_leases(
                sandbox_id, lease_seconds=lease_seconds
            )
        records = self.daemon_store.take_queued_commands(
            sandbox_id, limit=limit, lease_seconds=lease_seconds
        )
        logger.debug(
            "Commands taken by daemon node",
            sandbox_id=sandbox_id,
            command_count=len(records),
        )
        for record in records:
            command = record["command"]
            if command["type"] == "run.start":
                self.active_commands[command["id"]] = {
                    "sandboxId": sandbox_id,
                    "commandId": command["id"],
                    **({"leaseId": record["leaseId"]} if record.get("leaseId") else {}),
                    "sessionId": command["sessionId"],
                    "runId": command["runId"],
                    "agent": command["agent"],
                    "mode": command["mode"],
                    "taskGoal": command["taskGoal"],
                    **(
                        {"workspacePath": command["workspacePath"]}
                        if command.get("workspacePath")
                        else {}
                    ),
                    "startedAt": record.get("dispatchedAt", now_iso()),
                }
        return [daemon_command_payload(record) for record in records]

    def available_command_count(self, sandbox_id: str, token: str | None) -> int:
        self._hydrate_node(sandbox_id)
        self._assert_authorized(sandbox_id, token)
        self._mark_seen(sandbox_id)
        return self.daemon_store.queued_command_count(sandbox_id)

    def renew_active_command_leases(
        self,
        sandbox_id: str,
        token: str | None,
        command_leases: list[tuple[str, str | None]],
        *,
        lease_seconds: float = DAEMON_COMMAND_LEASE_SECONDS,
    ) -> None:
        self._hydrate_node(sandbox_id)
        self._assert_authorized(sandbox_id, token)
        self._mark_seen(sandbox_id)
        if not command_leases:
            return
        self._renew_command_leases(
            sandbox_id, command_leases, lease_seconds=lease_seconds
        )

    def _renew_command_leases(
        self,
        sandbox_id: str,
        command_leases: list[tuple[str, str | None]],
        *,
        lease_seconds: float,
    ) -> None:
        # The durable store, not this registry replica's memory, is the source
        # of truth for command ownership. A poll may land on a different
        # backend process from the one that dispatched the command.
        renewable = list(dict(command_leases).items())
        if renewable and hasattr(self.daemon_store, "renew_command_leases"):
            self.daemon_store.renew_command_leases(
                sandbox_id, renewable, lease_seconds=lease_seconds
            )

    def _renew_known_active_command_leases(
        self, sandbox_id: str, *, lease_seconds: float
    ) -> None:
        if not hasattr(self.daemon_store, "renew_command_leases"):
            return
        active_leases = [
            (command["commandId"], None)
            for command in self.active_commands.values()
            if command.get("sandboxId") == sandbox_id
        ]
        if active_leases:
            self.daemon_store.renew_command_leases(
                sandbox_id, active_leases, lease_seconds=lease_seconds
            )

    def start_run_request(
        self,
        sandbox_id: str,
        session_id: str,
        task_goal: str,
        assignments: list[dict[str, Any]],
        state: dict[str, Any],
        task_id: str | None = None,
        *,
        active_runs: list[dict[str, Any]] | None = None,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        node_ids = [
            sandbox_id,
            *(
                assignment.get("daemonNodeId")
                for assignment in assignments
                if assignment.get("daemonNodeId")
            ),
        ]
        with self.dispatch_scope(node_ids):
            return self._start_run_request_unlocked(
                sandbox_id,
                session_id,
                task_goal,
                assignments,
                state,
                task_id,
                active_runs,
                request_id,
            )

    def _start_run_request_unlocked(
        self,
        sandbox_id: str,
        session_id: str,
        task_goal: str,
        assignments: list[dict[str, Any]],
        state: dict[str, Any],
        task_id: str | None,
        active_runs: list[dict[str, Any]] | None,
        request_id: str | None,
    ) -> dict[str, Any]:
        if self.daemon_store.active_run_request_for_session_any_node(session_id):
            raise ValueError(f"Session {session_id} already has an active daemon run.")
        request = self.daemon_store.create_run_request(
            {
                **({"id": request_id} if request_id else {}),
                "nodeId": sandbox_id,
                "sessionId": session_id,
                "taskGoal": task_goal,
                "assignments": assignments,
                "state": state,
                **({"taskId": task_id} if task_id else {}),
            }
        )
        return self._enqueue_current_assignment(request, active_runs=active_runs)

    def cancel_active_run(
        self, sandbox_id: str, session_id: str, reason: str
    ) -> dict[str, Any] | None:
        with self.dispatch_lock:
            return self._cancel_active_run_unlocked(sandbox_id, session_id, reason)

    def _cancel_active_run_unlocked(
        self, sandbox_id: str, session_id: str, reason: str
    ) -> dict[str, Any] | None:
        active = next(
            (
                run
                for run in self.active_commands.values()
                if run["sandboxId"] == sandbox_id and run["sessionId"] == session_id
            ),
            None,
        )
        if not active:
            durable_run = next(
                (
                    run
                    for run in self.daemon_store.list_active_runs(sandbox_id)
                    if run.get("sessionId") == session_id
                ),
                None,
            )
            if durable_run:
                active = {**durable_run, "sandboxId": sandbox_id}
                self.active_commands[active["commandId"]] = active
        if not active:
            logger.warning(
                "No active run to cancel", sandbox_id=sandbox_id, session_id=session_id
            )
            return None
        logger.info(
            "Cancelling active run",
            sandbox_id=sandbox_id,
            session_id=session_id,
            run_id=active["runId"],
            reason=reason,
        )
        self.enqueue(
            sandbox_id,
            {
                "id": new_database_id(),
                "type": "run.cancel",
                "commandId": active["commandId"],
                "sessionId": active["sessionId"],
                "runId": active["runId"],
                "agent": active["agent"],
                "mode": active["mode"],
                "reason": reason,
            },
        )
        return active

    def handle_event(
        self, sandbox_id: str, event: dict[str, Any], token: str | None
    ) -> None:
        self._hydrate_node(sandbox_id)
        lock = (
            self.dispatch_scope([sandbox_id])
            if event.get("type") in {"run.output", "run.collaboration"}
            else self.dispatch_lock
        )
        with lock:
            self._handle_event_unlocked(sandbox_id, event, token)

    def _handle_event_unlocked(
        self, sandbox_id: str, event: dict[str, Any], token: str | None
    ) -> None:
        self._assert_authorized(sandbox_id, token)
        self._mark_seen(sandbox_id)
        record = self.daemon_store.get_command(event["commandId"])
        if not record:
            logger.debug(
                "Daemon node event ignored: no active command",
                sandbox_id=sandbox_id,
                command_id=event["commandId"],
            )
            return
        terminal_status = {
            "run.completed": "completed",
            "run.failed": "failed",
            "run.cancelled": "cancelled",
        }.get(event["type"])
        if record.get("status") != "dispatched":
            command = record["command"]
            replay_matches = (
                record.get("nodeId") == sandbox_id
                and command.get("sessionId") == event.get("sessionId")
                and command.get("runId") == event.get("runId")
                and command.get("agent") == event.get("agent")
                and command.get("mode") == event.get("mode")
                and (
                    not record.get("leaseId")
                    or not event.get("leaseId")
                    or record["leaseId"] == event["leaseId"]
                )
            )
            if (
                terminal_status
                and record.get("status") == terminal_status
                and replay_matches
            ):
                self.active_commands.pop(event["commandId"], None)
                self.daemon_store.mark_cancel_commands_completed(
                    sandbox_id, event["commandId"]
                )
                self._claim_and_advance_run_request(event)
            else:
                logger.debug(
                    "Daemon node event ignored: no active command",
                    sandbox_id=sandbox_id,
                    command_id=event["commandId"],
                )
            return
        command = record["command"]
        active = {
            "sandboxId": record["nodeId"],
            "commandId": command["id"],
            **({"leaseId": record["leaseId"]} if record.get("leaseId") else {}),
            "sessionId": command["sessionId"],
            "runId": command["runId"],
            "agent": command["agent"],
            "mode": command["mode"],
            "taskGoal": command.get("taskGoal", ""),
            **(
                {"workspacePath": command["workspacePath"]}
                if command.get("workspacePath")
                else {}
            ),
            "startedAt": record.get("dispatchedAt", record["createdAt"]),
        }
        self.active_commands[event["commandId"]] = active
        if (
            active["sandboxId"] != sandbox_id
            or active["runId"] != event["runId"]
            or active["sessionId"] != event["sessionId"]
        ):
            logger.warning(
                "Daemon node event mismatch",
                sandbox_id=sandbox_id,
                command_id=event["commandId"],
                run_id=event["runId"],
            )
            raise PermissionError(
                "Unauthorized daemon node event: command belongs to a different sandbox."
            )

        if (
            active.get("leaseId")
            and event.get("leaseId")
            and active["leaseId"] != event["leaseId"]
        ):
            logger.warning(
                "Daemon node event lease mismatch",
                sandbox_id=sandbox_id,
                command_id=event["commandId"],
                run_id=event["runId"],
            )
            raise PermissionError(
                "Unauthorized daemon node event: command lease does not match the active command."
            )
        if active["agent"] != event["agent"] or (
            event["type"] != "run.output" and active["mode"] != event.get("mode")
        ):
            logger.warning(
                "Daemon node event command metadata mismatch",
                sandbox_id=sandbox_id,
                command_id=event["commandId"],
                run_id=event["runId"],
            )
            raise PermissionError(
                "Unauthorized daemon node event: command metadata does not match the active command."
            )
        if event["type"] == "run.output":
            seen = self._output_sequences_for_run(event["sessionId"], event["runId"])
            if event["sequence"] <= seen.get(event["stream"], -1):
                return
            self.store.append_event(
                event["sessionId"],
                relay_event(
                    "agent.output",
                    event["sessionId"],
                    {
                        "runId": event["runId"],
                        "agent": event["agent"],
                        "stream": event["stream"],
                        "text": event["text"],
                        "sequence": event["sequence"],
                    },
                ),
                hydrate_events=False,
            )
            seen[event["stream"]] = event["sequence"]
            self._append_run_output(event["runId"], event["text"])
            return
        if event["type"] == "run.collaboration":
            seen = self._output_sequences_for_run(event["sessionId"], event["runId"])
            if event["sequence"] <= seen.get("collaboration", -1):
                return
            self.store.append_event(
                event["sessionId"],
                relay_event(
                    "agent.collaboration",
                    event["sessionId"],
                    {
                        "runId": event["runId"],
                        "agent": event["agent"],
                        "mode": event["mode"],
                        "sequence": event["sequence"],
                        "collaboration": event["collaboration"],
                    },
                ),
                hydrate_events=False,
            )
            seen["collaboration"] = event["sequence"]
            return
        accepted = False
        if event["type"] == "run.completed":
            logger.info(
                "Agent run completed on daemon node",
                sandbox_id=sandbox_id,
                command_id=event["commandId"],
                run_id=event["runId"],
                agent=event["agent"],
                mode=event["mode"],
                exit_code=event.get("exitCode"),
            )
            accepted = self.daemon_store.mark_command_completed(sandbox_id, event)
        elif event["type"] == "run.cancelled":
            logger.info(
                "Agent run cancelled on daemon node",
                sandbox_id=sandbox_id,
                command_id=event["commandId"],
                run_id=event["runId"],
                agent=event["agent"],
                mode=event["mode"],
            )
            accepted = self.daemon_store.mark_command_cancelled(sandbox_id, event)
        else:
            logger.warning(
                "Agent run failed on daemon node",
                sandbox_id=sandbox_id,
                command_id=event["commandId"],
                run_id=event["runId"],
                agent=event["agent"],
                mode=event["mode"],
                error=event.get("error"),
            )
            accepted = self.daemon_store.mark_command_failed(sandbox_id, event)
        if not accepted:
            logger.debug(
                "Daemon node terminal event ignored: delivery is no longer active",
                sandbox_id=sandbox_id,
                command_id=event["commandId"],
            )
            return
        self.active_commands.pop(event["commandId"], None)
        self.daemon_store.mark_cancel_commands_completed(sandbox_id, event["commandId"])
        if not self._claim_and_advance_run_request(event):
            self.clear_run_output(event["runId"])

    def assert_node_event_authorized(self, sandbox_id: str, token: str | None) -> None:
        """Authorize non-run events without attempting run-event bookkeeping."""
        self._hydrate_node(sandbox_id)
        with self.dispatch_scope([sandbox_id]):
            self._assert_authorized(sandbox_id, token)
            self._mark_seen(sandbox_id)

    def reap_stale_runs(self, *, force: bool = True) -> None:
        if not force and time.monotonic() - self._last_reap_at < max(
            0.001, self.liveness_timeout_ms / 1000
        ):
            return
        with self.dispatch_lock:
            self._reap_stale_runs_unlocked(force=force)

    def _reap_stale_runs_unlocked(self, *, force: bool) -> None:
        monotonic_now = time.monotonic()
        if not force and monotonic_now - self._last_reap_at < max(
            0.001, self.liveness_timeout_ms / 1000
        ):
            self._maybe_prune_terminal_records(monotonic_now)
            return
        self._last_reap_at = monotonic_now
        self._maybe_prune_terminal_records(monotonic_now)
        for request in self.daemon_store.list_active_run_requests():
            if request.get("status") == "finalizing":
                terminal_event = (request.get("state") or {}).get(
                    TERMINAL_EVENT_STATE_KEY
                )
                if isinstance(terminal_event, dict):
                    # Reaping runs inside monitor_nodes(), which most routes
                    # call, so one request that cannot be finalized must not
                    # take the rest of the API down with it. Log and move on;
                    # the claim lease brings it back on the next pass.
                    try:
                        self._claim_and_advance_run_request(terminal_event)
                    except Exception as error:
                        logger.exception(
                            "Failed finalizing a stale run request",
                            run_request_id=request.get("id"),
                            node_id=request.get("nodeId"),
                            error=str(error),
                        )
                continue
            command_id = request.get("currentCommandId")
            if not command_id:
                staged = self.daemon_store.pending_command_for_run_request(
                    request["id"]
                )
                if staged:
                    command = staged["command"]
                    session = self.store.get_session(request["sessionId"])
                    has_started = any(
                        agent_run.get("id") == command["runId"]
                        for agent_run in session.get("agentRuns", [])
                    )
                    if not has_started:
                        claimed = self.daemon_store.claim_run_request_dispatch(
                            request["id"],
                            new_relay_id("claim"),
                            DISPATCH_CLAIM_LEASE_SECONDS,
                        )
                        if not claimed:
                            continue
                        request = claimed
                        command["_dispatchClaimId"] = request["state"][
                            "_relay_dispatch_claim_id"
                        ]
                        self.daemon_store.update_staged_command(command["id"], command)
                        self._ensure_agent_started_for_command(request, command)
                    request = self.daemon_store.update_run_request_if_claimed(
                        request["id"],
                        "_relay_dispatch_claim_id",
                        command.get("_dispatchClaimId", ""),
                        self._run_request_command_link(command),
                    )
                    if not request:
                        claimed = self.daemon_store.claim_run_request_dispatch(
                            command["_runRequestId"],
                            new_relay_id("claim"),
                            DISPATCH_CLAIM_LEASE_SECONDS,
                        )
                        if not claimed:
                            continue
                        command["_dispatchClaimId"] = claimed["state"][
                            "_relay_dispatch_claim_id"
                        ]
                        self.daemon_store.update_staged_command(command["id"], command)
                        request = self.daemon_store.update_run_request_if_claimed(
                            claimed["id"],
                            "_relay_dispatch_claim_id",
                            command["_dispatchClaimId"],
                            self._run_request_command_link(command),
                        )
                        if not request:
                            continue
                    self.daemon_store.publish_command(command["id"])
                    self._track_active_command(staged["nodeId"], command)
                else:
                    self._enqueue_current_assignment(request)
                continue
            command_record = self.daemon_store.get_command(command_id)
            if command_record and command_record.get("status") == "pending":
                self.daemon_store.publish_command(command_id)
                self._track_active_command(
                    command_record["nodeId"], command_record["command"]
                )
            if command_record and command_record.get("status") in (
                "completed",
                "failed",
                "cancelled",
            ):
                terminal_event = command_record["command"].get("_terminalEvent")
                if isinstance(terminal_event, dict):
                    self._claim_and_advance_run_request(terminal_event)
                    continue
            sandbox = self.sandboxes.get(request["nodeId"])
            if not sandbox:
                self._fail_run_request(
                    request, f"Daemon node {request['nodeId']} disappeared."
                )
                continue
            # A node heartbeat can land on a different backend replica from
            # this reaper. Command leases are the durable ownership signal,
            # so replica-local liveness must not make the run terminal.
            current_started_at = request.get("currentStartedAt")
            if (
                current_started_at
                and self._age_ms(current_started_at) > DAEMON_RUN_TIMEOUT_MS
            ):
                self.cancel_active_run(
                    request["nodeId"], request["sessionId"], "Daemon run timed out."
                )
                self._fail_run_request(request, "Daemon run timed out.")
                continue

    def _maybe_prune_terminal_records(self, monotonic_now: float) -> None:
        if not hasattr(self.daemon_store, "prune_terminal_records"):
            return
        if monotonic_now - self._last_prune_at < DAEMON_RECORD_PRUNE_INTERVAL_SECONDS:
            return
        self._last_prune_at = monotonic_now
        self.daemon_store.prune_terminal_records(
            retention_seconds=DAEMON_COMMAND_RETENTION_SECONDS,
            per_node_limit=DAEMON_TERMINAL_RECORD_LIMIT,
        )

    def _enqueue_current_assignment(
        self,
        run_request: dict[str, Any],
        *,
        active_runs: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        assignments = run_request["assignments"]
        index = run_request.get("currentIndex", 0)
        if index >= len(assignments):
            self._complete_run_request(run_request, "Assignments completed.")
            return run_request
        assignment = assignments[index]
        node_id = assignment.get("daemonNodeId") or run_request["nodeId"]
        if node_id != run_request["nodeId"]:
            run_request = self.daemon_store.update_run_request(
                run_request["id"], {"nodeId": node_id}
            )
        mode = assignment.get("mode") or "action"
        run_id = new_database_id()
        sandbox = self.sandboxes.get(node_id)
        if not sandbox:
            self._fail_run_request(
                run_request,
                f"Sandbox {run_request['nodeId']} was removed before the run could start.",
            )
            return run_request
        try:
            if self.logical_assignment_validator and assignment.get("agentId"):
                self.logical_assignment_validator(assignment)
            if not self._liveness(sandbox)["online"]:
                raise ValueError("Runtime node heartbeat is not live.")
            if assignment["executorKind"] in set(sandbox.get("disabledAgents") or []):
                raise ValueError(
                    f"Executor {assignment['executorKind']} is disabled on this runtime node."
                )
            if (sandbox.get("agents") or {}).get(assignment["executorKind"]) != "ready":
                raise ValueError(
                    f"Executor {assignment['executorKind']} is not ready on this runtime node."
                )
            if not node_accepts_run(
                sandbox,
                assignments=[assignment],
                active_runs=(
                    active_runs
                    if active_runs is not None
                    else self.daemon_store.list_active_runs(node_id)
                ),
                session_id=run_request["sessionId"],
            ):
                raise ValueError("Runtime node capacity is exhausted.")
        except (KeyError, ValueError) as error:
            self._fail_run_request(
                run_request, f"Agent placement is no longer eligible: {error}"
            )
            return run_request
        state = {
            key: value
            for key, value in (run_request["state"] or {}).items()
            if key in PERSISTED_AGENT_STATE_KEYS
        }
        session_snapshot = self.store.get_session(run_request["sessionId"])
        bridge = compute_prior_agent_bridge(
            session_snapshot, assignment["executorKind"], self.store
        )
        if bridge:
            state["prior_agent_bridge"] = bridge
        conversation = compute_conversation_history(session_snapshot, self.store)
        if conversation:
            state["prior_conversation"] = conversation
        handoff_note = compute_prior_handoff_note(
            session_snapshot,
            assignment["executorKind"],
            assignment.get("agentId"),
        )
        if handoff_note:
            state["prior_handoff_note"] = handoff_note
        if assignment.get("agentDisplayName"):
            state["agent_display_name"] = assignment["agentDisplayName"]
        if assignment.get("agentInstructions"):
            state["agent_instructions"] = assignment["agentInstructions"]
        command = {
            "id": new_database_id(),
            "type": "run.start",
            "sessionId": run_request["sessionId"],
            "runId": run_id,
            "taskGoal": run_request["taskGoal"],
            "agent": assignment["executorKind"],
            "mode": mode,
            **(
                {"logicalAgentId": assignment["agentId"]}
                if assignment.get("agentId")
                else {}
            ),
            **(
                {"placementId": assignment["placementId"]}
                if assignment.get("placementId")
                else {}
            ),
            **(
                {"agentVersion": assignment["agentVersion"]}
                if assignment.get("agentVersion")
                else {}
            ),
            **(
                {"workspaceIdentity": assignment["workspaceIdentity"]}
                if assignment.get("workspaceIdentity")
                else {}
            ),
            **(
                {"workspacePath": sandbox["workspacePath"]}
                if sandbox.get("workspacePath")
                else {}
            ),
            "state": state,
            "_runRequestId": run_request["id"],
            "_nodeId": node_id,
        }
        # Daemons that report generated files themselves make the backend-side
        # workspace walk unnecessary (and it only works on a shared filesystem).
        artifact_snapshot = (
            None
            if self._node_reports_generated_files(sandbox)
            else workspace_generated_file_snapshot(sandbox.get("workspacePath"))
        )
        command["_artifactSnapshot"] = artifact_snapshot
        dispatch_claim_id = new_relay_id("claim")
        claimed_request = self.daemon_store.claim_run_request_dispatch(
            run_request["id"],
            dispatch_claim_id,
            DISPATCH_CLAIM_LEASE_SECONDS,
        )
        if not claimed_request:
            return self.daemon_store.get_run_request(run_request["id"]) or run_request
        run_request = claimed_request
        command["_dispatchClaimId"] = dispatch_claim_id
        staged = self.daemon_store.stage_command(
            node_id,
            command,
            request_id=run_request["id"],
            claim_id=dispatch_claim_id,
        )
        if not staged:
            return self.daemon_store.get_run_request(run_request["id"]) or run_request
        self._ensure_agent_started_for_command(run_request, command)
        updated = self.daemon_store.update_run_request_if_claimed(
            run_request["id"],
            "_relay_dispatch_claim_id",
            dispatch_claim_id,
            self._run_request_command_link(command),
        )
        if not updated:
            return self.daemon_store.get_run_request(run_request["id"]) or run_request
        # A staged command is not claimable. Publish it only after its durable
        # run-request link exists; reaping can safely publish after a crash.
        self.daemon_store.publish_command(command["id"])
        self._track_active_command(node_id, command)
        return updated

    def _ensure_agent_started_for_command(
        self, run_request: dict[str, Any], command: dict[str, Any]
    ) -> None:
        session = self.store.get_session(run_request["sessionId"])
        if any(
            agent_run.get("id") == command["runId"]
            for agent_run in session.get("agentRuns", [])
        ):
            return
        assignment = run_request["assignments"][run_request.get("currentIndex", 0)]
        sandbox = self.sandboxes[command["_nodeId"]]
        controller = self._controller_for_sandbox(sandbox, run_request.get("taskId"))
        role = effective_role_for_assignment(sandbox, assignment, command["mode"])
        controller.record_agent_started(
            run_request["sessionId"],
            {
                "runId": command["runId"],
                "agent": command["agent"],
                **({"role": role} if role else {}),
                "mode": command["mode"],
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
                "daemonNodeId": command["_nodeId"],
                **(
                    {"managedNodeId": sandbox["managedNodeId"]}
                    if sandbox.get("managedNodeId")
                    else {}
                ),
                **(
                    {"agentVersion": command["agentVersion"]}
                    if command.get("agentVersion")
                    else {}
                ),
                **(
                    {"workspaceIdentity": command["workspaceIdentity"]}
                    if command.get("workspaceIdentity")
                    else {}
                ),
            },
        )

    def _run_request_command_link(self, command: dict[str, Any]) -> dict[str, Any]:
        state = dict(command.get("state") or {})
        artifact_snapshot = command.get("_artifactSnapshot")
        if artifact_snapshot is not None:
            state[ARTIFACT_SNAPSHOT_STATE_KEY] = artifact_snapshot
        return {
            "status": "running",
            "nodeId": command["_nodeId"],
            "currentCommandId": command["id"],
            "currentRunId": command["runId"],
            "currentAgent": command["agent"],
            "currentMode": command["mode"],
            "currentStartedAt": now_iso(),
            "state": state,
        }

    def _claim_and_advance_run_request(self, event: dict[str, Any]) -> bool:
        run_request = self.daemon_store.claim_terminal_run_request(
            event["commandId"],
            event,
            new_relay_id("claim"),
            TERMINAL_CLAIM_LEASE_SECONDS,
        )
        if not run_request:
            return False
        self._advance_run_request(run_request, event)
        return True

    def _advance_run_request(
        self, run_request: dict[str, Any], event: dict[str, Any]
    ) -> None:
        terminal_claim_id = (run_request.get("state") or {}).get(
            TERMINAL_CLAIM_ID_STATE_KEY
        )
        if not terminal_claim_id:
            return
        fenced_request = self.daemon_store.update_run_request_if_claimed(
            run_request["id"],
            TERMINAL_CLAIM_ID_STATE_KEY,
            terminal_claim_id,
            {},
        )
        if not fenced_request:
            return
        run_request = fenced_request
        sandbox = self.sandboxes.get(run_request["nodeId"])
        if not sandbox:
            self.clear_run_output(event["runId"])
            return
        controller = self._controller_for_sandbox(sandbox, run_request.get("taskId"))
        try:
            session_before = self.store.get_session(run_request["sessionId"])
        except KeyError:
            outcome = f"Session {run_request['sessionId']} disappeared before run finalization."
            state = dict(run_request.get("state") or {})
            state.pop(TERMINAL_EVENT_STATE_KEY, None)
            state.pop(TERMINAL_CLAIM_ID_STATE_KEY, None)
            state.pop(TERMINAL_CLAIM_EXPIRES_STATE_KEY, None)
            self.clear_run_output(event["runId"])
            self.active_commands.pop(event["commandId"], None)
            self.daemon_store.mark_cancel_commands_completed(
                run_request["nodeId"], event["commandId"]
            )
            self.daemon_store.update_run_request_if_claimed(
                run_request["id"],
                TERMINAL_CLAIM_ID_STATE_KEY,
                terminal_claim_id,
                {"status": "failed", "state": state, "error": outcome},
            )
            self.update_status(
                run_request["nodeId"], {"status": "ready", "lastError": outcome}
            )
            return
        existing_completion = next(
            (
                item
                for item in session_before.get("events", [])
                if item.get("type") == "agent.completed"
                and item.get("runId") == event["runId"]
            ),
            None,
        )
        assignments = run_request["assignments"]
        assignment = assignments[run_request.get("currentIndex", 0)]
        mode = assignment.get("mode") or "action"
        state = dict(run_request["state"])
        artifact_snapshot = state.pop(ARTIFACT_SNAPSHOT_STATE_KEY, None)
        state.pop(TERMINAL_EVENT_STATE_KEY, None)
        state.pop(TERMINAL_CLAIM_ID_STATE_KEY, None)
        state.pop(TERMINAL_CLAIM_EXPIRES_STATE_KEY, None)
        if event["type"] == "run.failed":
            agent_log = event.get("agentLog") or event["error"]
            self.clear_run_output(event["runId"])
            if not existing_completion:
                controller.record_agent_completed(
                    run_request["sessionId"],
                    state,
                    {
                        "runId": event["runId"],
                        "agent": event["agent"],
                        "mode": mode,
                        "status": "failed",
                        "exitCode": event.get("exitCode", 1),
                        "agentLog": agent_log,
                    },
                )
            if session_before.get("status") != "failed":
                controller.fail_session(run_request["sessionId"], event["error"])
            self.daemon_store.update_run_request_if_claimed(
                run_request["id"],
                TERMINAL_CLAIM_ID_STATE_KEY,
                terminal_claim_id,
                {"status": "failed", "error": event["error"]},
            )
            self.update_status(
                run_request["nodeId"], {"status": "ready", "lastError": event["error"]}
            )
            return
        if event["type"] == "run.cancelled":
            self.clear_run_output(event["runId"])
            if not existing_completion:
                controller.record_agent_completed(
                    run_request["sessionId"],
                    state,
                    {
                        "runId": event["runId"],
                        "agent": event["agent"],
                        "mode": mode,
                        "status": "cancelled",
                        "exitCode": 130,
                        "agentLog": "",
                    },
                )
            if session_before.get("status") != "cancelled":
                controller.cancel_session(run_request["sessionId"], event["reason"])
            self.daemon_store.update_run_request_if_claimed(
                run_request["id"],
                TERMINAL_CLAIM_ID_STATE_KEY,
                terminal_claim_id,
                {"status": "cancelled", "error": event["reason"]},
            )
            self.update_status(
                run_request["nodeId"], {"status": "ready", "lastError": event["reason"]}
            )
            return
        agent_log = event.get("agentLog") or self.output_for_run(event["runId"])
        self.clear_run_output(event["runId"])
        has_next = event["exitCode"] == 0 and run_request.get(
            "currentIndex", 0
        ) + 1 < len(assignments)
        state_patch = {
            "agent_logs": [agent_log],
            "last_exit_code": event["exitCode"],
            "token_usage": event.get("tokenUsage"),
        }
        next_state = (
            merge_agent_state(state, state_patch)
            if existing_completion
            else controller.record_agent_completed(
                run_request["sessionId"],
                state,
                {
                    "runId": event["runId"],
                    "agent": event["agent"],
                    "mode": mode,
                    "status": "completed" if event["exitCode"] == 0 else "failed",
                    "exitCode": event["exitCode"],
                    "agentLog": agent_log,
                    "tokenUsage": event.get("tokenUsage"),
                    **({"pipelineHasNext": True} if has_next else {}),
                },
            )
        )
        if event["exitCode"] == 0:
            self._record_generated_workspace_artifacts(
                sandbox, run_request, event, artifact_snapshot, assignment
            )
        if event["exitCode"] != 0:
            # Agent-first assignments carry agentId/executorKind and no "agent"
            # key, so indexing it here raised before the request could be marked
            # failed — leaving it finalizing forever and re-raising on every
            # reap pass. Resolve the label the way scheduling.py does.
            agent_label = (
                assignment.get("agentDisplayName")
                or assignment.get("executorKind")
                or assignment.get("agent")
                or "Agent"
            )
            outcome = f"{agent_label} {mode} failed with exit code {event['exitCode']}."
            if session_before.get("status") != "failed":
                controller.fail_session(run_request["sessionId"], outcome)
            self.daemon_store.update_run_request_if_claimed(
                run_request["id"],
                TERMINAL_CLAIM_ID_STATE_KEY,
                terminal_claim_id,
                {"status": "failed", "state": next_state, "error": outcome},
            )
            self.update_status(
                run_request["nodeId"], {"status": "ready", "lastError": outcome}
            )
            return
        next_index = run_request.get("currentIndex", 0) + 1
        updated = self.daemon_store.update_run_request_if_claimed(
            run_request["id"],
            TERMINAL_CLAIM_ID_STATE_KEY,
            terminal_claim_id,
            {
                "status": "running",
                "currentIndex": next_index,
                "state": next_state,
                "currentCommandId": None,
                "currentRunId": None,
                "currentAgent": None,
                "currentMode": None,
                "currentStartedAt": None,
            },
        )
        if not updated:
            return
        if next_index >= len(assignments):
            self._complete_run_request(updated, "Assignments completed.")
        else:
            self._enqueue_current_assignment(updated)

    def _node_reports_generated_files(self, sandbox: dict[str, Any]) -> bool:
        return DAEMON_CAPABILITY_GENERATED_FILES in (sandbox.get("capabilities") or [])

    def _record_generated_workspace_artifacts(
        self,
        sandbox: dict[str, Any],
        run_request: dict[str, Any],
        event: dict[str, Any],
        artifact_snapshot: dict[str, Any] | None,
        assignment: dict[str, Any] | None = None,
    ) -> None:
        session_id = run_request["sessionId"]
        workspace_path = sandbox.get("workspacePath")
        artifact_workspace_path = workspace_path
        if (
            workspace_path
            and DAEMON_CAPABILITY_THREAD_WORKSPACES
            in (sandbox.get("capabilities") or [])
        ):
            artifact_workspace_path = str(Path(workspace_path) / session_id)
        if isinstance(event.get("generatedFiles"), list):
            items = daemon_reported_generated_files(
                artifact_workspace_path, event["generatedFiles"]
            )
        elif self._node_reports_generated_files(sandbox):
            # A capable daemon reported nothing for this run.
            items = []
        else:
            items = [
                local_generated_file_item(item)
                for item in workspace_generated_files(workspace_path, artifact_snapshot)
            ]
        # A file may legitimately be re-generated by a later run; each change
        # gets its own artifact attributed to the run that produced it. Only
        # duplicates within one report are dropped.
        session = self.store.get_session(session_id)
        seen_relative_paths = {
            artifact.get("workspaceRelativePath")
            for artifact in session.get("artifacts", [])
            if artifact.get("agentRunId") == event["runId"]
        }
        for item in items:
            path = item["path"]
            relative_path = item["relativePath"]
            if relative_path in seen_relative_paths:
                continue
            seen_relative_paths.add(relative_path)
            artifact = {
                "id": new_database_id(),
                "kind": "workspace_file",
                "title": item["title"],
                "path": path,
                "createdAt": now_iso(),
                "agentRunId": event["runId"],
                "bytes": item["bytes"],
                "contentType": item["contentType"],
                "workspaceRelativePath": item["relativePath"],
                **(
                    {"agentId": assignment["agentId"]}
                    if assignment and assignment.get("agentId")
                    else {}
                ),
            }
            if hasattr(self.store, "index_workspace_artifact"):
                artifact, _session = self.store.index_workspace_artifact(
                    session_id, artifact, item.get("content")
                )
            else:
                self.store.append_event(
                    session_id,
                    relay_event("artifact.created", session_id, {"artifact": artifact}),
                )
            logger.info(
                "Generated workspace artifact indexed",
                session_id=session_id,
                run_id=event["runId"],
                artifact_id=artifact["id"],
                path=item["relativePath"],
                snapshot=item.get("content") is not None,
            )

    def _complete_run_request(self, run_request: dict[str, Any], outcome: str) -> None:
        sandbox = self.sandboxes.get(run_request["nodeId"])
        controller = (
            self._controller_for_sandbox(sandbox, run_request.get("taskId"))
            if sandbox
            else SessionController(
                self.store,
                task_store=self.task_store,
                task_id=run_request.get("taskId"),
            )
        )
        modes = [
            (assignment.get("mode") or "action")
            for assignment in run_request.get("assignments", [])
        ]
        # ask-only discussions and review pipelines both end with a human in
        # the loop; only pure action work is closed out automatically.
        if all(mode == "ask" for mode in modes):
            task_status = "waiting_for_human"
        elif any(mode == "review" for mode in modes):
            task_status = "review"
        else:
            task_status = "done"
        if (
            self.store.get_session(run_request["sessionId"]).get("status")
            != "completed"
        ):
            controller.complete_session(
                run_request["sessionId"], outcome, task_status=task_status
            )
        self.daemon_store.update_run_request(
            run_request["id"], {"status": "completed", "error": None}
        )
        self.update_status(
            run_request["nodeId"], {"status": "ready", "lastError": None}
        )

    def _fail_run_request(self, run_request: dict[str, Any], outcome: str) -> None:
        run_id = run_request.get("currentRunId")
        command_id = run_request.get("currentCommandId")
        if command_id:
            self.active_commands.pop(command_id, None)
            event = {
                "type": "run.failed",
                "commandId": command_id,
                "sessionId": run_request["sessionId"],
                "runId": run_id or "",
                "agent": run_request.get("currentAgent") or "codex",
                "mode": run_request.get("currentMode") or "action",
                "error": outcome,
                "exitCode": 1,
            }
            accepted = self.daemon_store.mark_command_failed(
                run_request["nodeId"], event
            )
            if not accepted:
                command_record = self.daemon_store.get_command(command_id)
                if command_record:
                    # A terminal daemon event won the durable transition on
                    # another replica. Its handler owns the session update.
                    if run_id:
                        self.clear_run_output(run_id)
                    return
            self.daemon_store.mark_cancel_commands_completed(
                run_request["nodeId"], command_id
            )
        if run_id:
            self.clear_run_output(run_id)
        sandbox = self.sandboxes.get(run_request["nodeId"])
        controller = (
            self._controller_for_sandbox(sandbox, run_request.get("taskId"))
            if sandbox
            else SessionController(
                self.store,
                task_store=self.task_store,
                task_id=run_request.get("taskId"),
            )
        )
        if (
            run_id
            and run_request.get("currentAgent")
            and run_request.get("currentMode")
        ):
            controller.record_agent_completed(
                run_request["sessionId"],
                run_request.get("state", initial_agent_state(run_request["taskGoal"])),
                {
                    "runId": run_id,
                    "agent": run_request["currentAgent"],
                    "mode": run_request["currentMode"],
                    "status": "failed",
                    "exitCode": 1,
                    "agentLog": outcome,
                },
            )
        controller.fail_session(run_request["sessionId"], outcome)
        self.daemon_store.update_run_request(
            run_request["id"], {"status": "failed", "error": outcome}
        )
        self.update_status(
            run_request["nodeId"], {"status": "failed", "lastError": outcome}
        )

    def _controller_for_sandbox(
        self, sandbox: dict[str, Any], task_id: str | None = None
    ) -> SessionController:
        return SessionController(
            self.store,
            task_store=self.task_store,
            task_id=task_id,
            workspace_path=sandbox.get("workspacePath") or "/workspace",
            owner_employee_id=sandbox.get("employeeId"),
            daemon_node_id=sandbox.get("id"),
            managed_node_id=sandbox.get("managedNodeId"),
        )

    def _age_ms(self, iso_timestamp: str) -> int:
        try:
            timestamp = iso_timestamp.replace("Z", "+00:00")
            seen_ms = datetime.fromisoformat(timestamp).timestamp() * 1000
            return max(0, int(time.time() * 1000 - seen_ms))
        except Exception:
            logger.warning(
                "Failed to parse timestamp for age calculation",
                iso_timestamp=iso_timestamp,
            )
            return 0

    def output_for_run(self, run_id: str) -> str:
        return "".join(self.outputs.get(run_id, []))

    def _append_run_output(self, run_id: str, text: str) -> None:
        if RUN_OUTPUT_BUFFER_MAX_CHARS <= 0:
            return
        chunks = self.outputs.setdefault(run_id, [])
        chunks.append(text[-RUN_OUTPUT_BUFFER_MAX_CHARS:])
        size = self.output_sizes.get(run_id, 0) + len(chunks[-1])
        while size > RUN_OUTPUT_BUFFER_MAX_CHARS and chunks:
            overflow = size - RUN_OUTPUT_BUFFER_MAX_CHARS
            if len(chunks[0]) <= overflow:
                size -= len(chunks.pop(0))
            else:
                chunks[0] = chunks[0][overflow:]
                size -= overflow
        self.output_sizes[run_id] = size

    def clear_run_output(self, run_id: str) -> None:
        self.outputs.pop(run_id, None)
        self.output_sizes.pop(run_id, None)
        self.output_sequences.pop(run_id, None)
        self.output_sequences_hydrated.discard(run_id)

    def _output_sequences_for_run(self, session_id: str, run_id: str) -> dict[str, int]:
        seen = self.output_sequences.setdefault(run_id, {})
        if run_id not in self.output_sequences_hydrated:
            for stream, sequence in self._session_output_sequences(
                session_id, run_id
            ).items():
                seen[stream] = max(seen.get(stream, -1), sequence)
            self.output_sequences_hydrated.add(run_id)
        return seen

    def _session_output_sequences(self, session_id: str, run_id: str) -> dict[str, int]:
        try:
            session = self.store.get_session(session_id)
        except Exception:
            logger.warning(
                "Failed to read session when checking output sequence",
                session_id=session_id,
                run_id=run_id,
            )
            return {}
        seen: dict[str, int] = {}
        for event in session.get("events", []):
            if (
                event.get("type") not in ("agent.output", "agent.collaboration")
                or event.get("runId") != run_id
                or not isinstance(event.get("sequence"), int)
            ):
                continue
            stream = (
                event.get("stream")
                if event.get("type") == "agent.output"
                else "collaboration"
            )
            if not isinstance(stream, str):
                continue
            seen[stream] = max(seen.get(stream, -1), event["sequence"])
        return seen

    def _hydrate_node(self, sandbox_id: str) -> None:
        """Load cross-replica state before entering an authenticated node scope."""
        if sandbox_id not in self.sandboxes:
            self._refresh_persisted_liveness(sandbox_id)

    def _assert_authorized(self, sandbox_id: str, token: str | None) -> None:
        sandbox = self.sandboxes.get(sandbox_id)
        if not sandbox:
            logger.warning(
                "Daemon node request for unknown sandbox", sandbox_id=sandbox_id
            )
            raise KeyError(f"Unknown sandbox {sandbox_id}.")
        if not daemon_node_token_matches(sandbox, token):
            logger.warning("Unauthorized daemon node request", sandbox_id=sandbox_id)
            raise PermissionError("Unauthorized daemon node request.")

    def _should_persist_seen(self, sandbox_id: str) -> bool:
        """Rate-limit durable heartbeat writes under the node dispatch scope."""
        monotonic_now = time.monotonic()
        last = self._last_seen_persisted_at.get(sandbox_id)
        if (
            last is not None
            and monotonic_now - last < DAEMON_NODE_SEEN_PERSIST_INTERVAL_SECONDS
        ):
            return False
        self._last_seen_persisted_at[sandbox_id] = monotonic_now
        return True

    def _mark_seen(self, sandbox_id: str) -> None:
        with self.dispatch_scope([sandbox_id]):
            sandbox = self.sandboxes.get(sandbox_id)
            if not sandbox:
                return
            revived = not sandbox.get("retiredAt") and sandbox["status"] in (
                "stopped",
                "provisioning",
                "failed",
            )
            patch = {"status": "ready", "lastError": None} if revived else {}
            now = now_iso()
            updated = {
                **sandbox,
                **{k: v for k, v in patch.items() if v is not None},
                "updatedAt": now,
                "lastSeenAt": now,
            }
            if "lastError" in patch and patch["lastError"] is None:
                updated.pop("lastError", None)
            self.sandboxes[sandbox_id] = updated
            # An idle long poll calls this several times per second per node.
            # The in-memory view above stays exact for this replica's liveness
            # checks; the durable write is throttled well inside the liveness
            # timeout so other replicas still see the node as online.
            if revived or self._should_persist_seen(sandbox_id):
                self.daemon_store.mark_node_seen(sandbox_id, patch)
            if revived:
                logger.info(
                    "Daemon node came online",
                    sandbox_id=sandbox_id,
                    previous_status=sandbox["status"],
                )

    def _load_persisted_state(self) -> None:
        nodes = self.daemon_store.list_nodes()
        if nodes:
            logger.info("Loaded persisted daemon nodes", count=len(nodes))
        active_runs = self.daemon_store.list_active_runs()
        active_node_ids = {run["nodeId"] for run in active_runs}
        for sandbox in nodes:
            node_location = infer_node_location(sandbox)
            waiting_status = (
                "stopped"
                if sandbox.get("retiredAt")
                else "running"
                if sandbox["id"] in active_node_ids
                else "provisioning"
                if sandbox.get("status") == "provisioning"
                else "stopped"
            )
            self.sandboxes[sandbox["id"]] = {
                **sandbox,
                **({"nodeLocation": node_location} if node_location else {}),
                "status": waiting_status,
                # A successful authenticated command poll proves that the same
                # daemon identity is live again. Keep its last registered
                # capability state during backend recovery so liveness cannot
                # become ready while every Logical Agent stays unavailable
                # until the daemon's next periodic registration.
                "agents": (
                    {agent: "unknown" for agent in AGENT_NAMES}
                    if sandbox.get("retiredAt")
                    else {
                        agent: (sandbox.get("agents") or {}).get(agent, "unknown")
                        for agent in AGENT_NAMES
                    }
                ),
                "updatedAt": now_iso(),
                "lastError": sandbox.get("lastError")
                or "Waiting for daemon node registration.",
            }
        for run in active_runs:
            self.active_commands[run["commandId"]] = {**run, "sandboxId": run["nodeId"]}

    def _refresh_persisted_liveness(self, sandbox_id: str | None = None) -> None:
        """Merge newer durable lease observations from another backend replica."""
        with self.dispatch_lock:
            persisted_nodes = (
                [self.daemon_store.get_node(sandbox_id)]
                if sandbox_id
                else self.daemon_store.list_nodes()
            )
            for persisted in persisted_nodes:
                if not persisted:
                    continue
                current = self.sandboxes.get(persisted["id"])
                if not current:
                    node_location = infer_node_location(persisted)
                    self.sandboxes[persisted["id"]] = {
                        **persisted,
                        **({"nodeLocation": node_location} if node_location else {}),
                        "agents": {
                            agent: (persisted.get("agents") or {}).get(agent, "unknown")
                            for agent in AGENT_NAMES
                        },
                    }
                    continue
                persisted_seen = persisted.get("lastSeenAt") or ""
                current_seen = current.get("lastSeenAt") or ""
                if persisted_seen <= current_seen:
                    continue
                refreshed = {
                    **current,
                    "lastSeenAt": persisted_seen,
                    "updatedAt": persisted.get("updatedAt") or current.get("updatedAt"),
                    "status": persisted.get("status", current.get("status")),
                }
                if persisted.get("lastError"):
                    refreshed["lastError"] = persisted["lastError"]
                else:
                    refreshed.pop("lastError", None)
                self.sandboxes[persisted["id"]] = refreshed

    def _liveness(self, sandbox: dict[str, Any]) -> dict[str, Any]:
        if sandbox.get("status") == "stopped" or not sandbox.get("lastSeenAt"):
            return {"online": False, "stale": True}
        try:
            timestamp = sandbox["lastSeenAt"].replace("Z", "+00:00")
            seen_ms = datetime.fromisoformat(timestamp).timestamp() * 1000
        except Exception:
            logger.warning(
                "Failed to parse lastSeenAt for sandbox liveness",
                sandbox_id=sandbox.get("id"),
                last_seen=sandbox.get("lastSeenAt"),
            )
            return {"online": False, "stale": True}
        age = max(0, int(time.time() * 1000 - seen_ms))
        online = age <= self.liveness_timeout_ms
        if not online:
            logger.debug(
                "Daemon node stale", sandbox_id=sandbox["id"], last_seen_age_ms=age
            )
        return {"online": online, "stale": not online, "lastSeenAgeMs": age}


def daemon_active_run(run: dict[str, Any]) -> dict[str, Any]:
    return {
        key: run[key]
        for key in (
            "commandId",
            "sessionId",
            "runId",
            "agent",
            "mode",
            "taskGoal",
            "workspacePath",
            "startedAt",
            "logicalAgentId",
            "placementId",
        )
        if key in run
    }
