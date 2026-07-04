from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import mimetypes
import os
import secrets
from datetime import datetime
from threading import RLock
import time
from pathlib import Path, PurePosixPath
from typing import Any

from loguru import logger

from ..core.environment import load_backend_env
from ..core.ids import new_relay_id, new_sandbox_id, now_iso
from ..core.models import AGENT_NAMES, AGENT_ROLES, DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS
from ..persistence.stores import LocalDaemonStore, LocalSessionStore, LocalTaskStore, relay_event, role_for_agent
from ..sessions import compute_prior_agent_bridge
from ..sessions import compute_conversation_history
from ..sessions import SessionController, initial_agent_state

load_backend_env()

DAEMON_NODE_LIVENESS_TIMEOUT_MS = int(os.environ.get("RELAY_DAEMON_NODE_LIVENESS_TIMEOUT_MS", "15000"))
DAEMON_RUN_TIMEOUT_MS = int(os.environ.get("RELAY_DAEMON_RUN_TIMEOUT_MS", str(15 * 60 * 1000)))
DAEMON_COMMAND_LEASE_SECONDS = float(os.environ.get("RELAY_DAEMON_COMMAND_LEASE_SECONDS", "60"))
DAEMON_ACTIVE_COMMAND_LEASE_SECONDS = max(DAEMON_COMMAND_LEASE_SECONDS, (DAEMON_RUN_TIMEOUT_MS / 1000) + 60)
AGENT_TASK_MODES = ("action", "review", "ask")
# ".key" is deliberately absent: it matches TLS/SSH private keys far more
# often than Keynote decks, and indexed files become downloadable artifacts.
GENERATED_ARTIFACT_EXTENSIONS = frozenset({
    ".csv",
    ".doc",
    ".docx",
    ".gif",
    ".html",
    ".jpeg",
    ".jpg",
    ".pdf",
    ".png",
    ".ppt",
    ".pptx",
    ".svg",
    ".tsv",
    ".webp",
    ".xls",
    ".xlsx",
    ".zip",
})
OUTPUT_ARTIFACT_TEXT_EXTENSIONS = frozenset({
    ".json",
    ".log",
    ".md",
    ".txt",
})
GENERATED_ARTIFACT_EXCLUDED_DIRS = frozenset({
    ".cache",
    ".git",
    ".gradle",
    ".mypy_cache",
    ".next",
    ".oci",
    ".relay",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
    ".turbo",
    ".venv",
    "__pycache__",
    "coverage",
    "dist",
    "node_modules",
    "out",
    "target",
    "venv",
})
GENERATED_ARTIFACT_LIMIT = 20
# Bound the fallback workspace walk so a pathological tree cannot stall the
# backend event loop; daemons that report generated files skip it entirely.
GENERATED_ARTIFACT_WALK_MAX_ENTRIES = 50_000
# Per-file cap for content snapshots kept alongside the artifact record.
WORKSPACE_ARTIFACT_CONTENT_MAX_BYTES = int(os.environ.get("RELAY_WORKSPACE_ARTIFACT_SNAPSHOT_MAX_BYTES", str(2 * 1024 * 1024)))
ARTIFACT_SNAPSHOT_STATE_KEY = "_relay_artifact_snapshot"
DAEMON_CAPABILITY_GENERATED_FILES = "generated-files"
DAEMON_NODE_CAPABILITIES = frozenset({DAEMON_CAPABILITY_GENERATED_FILES})


def _is_generated_artifact_path(relative_path: str) -> bool:
    path = PurePosixPath(relative_path)
    suffix = path.suffix.lower()
    if suffix in GENERATED_ARTIFACT_EXTENSIONS:
        return True
    return bool(path.parts and path.parts[0] == "output" and suffix in OUTPUT_ARTIFACT_TEXT_EXTENSIONS)


def hash_daemon_node_token(token: str | None) -> str | None:
    if not token:
        return None
    return "sha256:" + hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_daemon_node_token() -> str:
    return "tok_" + secrets.token_urlsafe(24).rstrip("=")


def _hash_matches(expected: str | None, token: str | None) -> bool:
    provided = hash_daemon_node_token(token)
    return bool(expected and provided and len(expected) == len(provided) and hmac.compare_digest(expected, provided))


def sandbox_ui_token_matches(sandbox: dict[str, Any], token: str | None) -> bool:
    expected = sandbox.get("uiTokenHash") or sandbox.get("tokenHash") or hash_daemon_node_token(sandbox.get("token"))
    return _hash_matches(expected, token)


def daemon_node_token_matches(sandbox: dict[str, Any], token: str | None) -> bool:
    expected = sandbox.get("nodeTokenHash") or sandbox.get("tokenHash") or hash_daemon_node_token(sandbox.get("token"))
    return _hash_matches(expected, token)


def sandbox_ui_auth_error(sandbox: dict[str, Any], token: str | None) -> str | None:
    if not sandbox.get("uiTokenHash") and not sandbox.get("tokenHash") and not sandbox.get("token"):
        return "Sandbox token is required." if sandbox.get("nodeTokenHash") else None
    if not token:
        return "Sandbox token is required."
    if not sandbox_ui_token_matches(sandbox, token):
        return "Invalid sandbox token."
    return None


def sandbox_node_auth_error(sandbox: dict[str, Any], token: str | None) -> str | None:
    if not sandbox.get("nodeTokenHash") and not sandbox.get("tokenHash") and not sandbox.get("token"):
        return None
    if not token:
        return "Daemon node token is required."
    if not daemon_node_token_matches(sandbox, token):
        return "Invalid daemon node token."
    return None


def _workspace_artifact_candidates(workspace_path: str | None) -> list[dict[str, Any]]:
    if not workspace_path:
        return []
    root = Path(workspace_path)
    if not root.exists() or not root.is_dir():
        return []
    root_resolved = root.resolve()
    files: list[dict[str, Any]] = []
    visited = 0
    try:
        for dirpath, dirnames, filenames in os.walk(root_resolved):
            dirnames[:] = [
                name
                for name in dirnames
                if name not in GENERATED_ARTIFACT_EXCLUDED_DIRS and not (Path(dirpath) / name).is_symlink()
            ]
            visited += len(dirnames) + len(filenames)
            if visited > GENERATED_ARTIFACT_WALK_MAX_ENTRIES:
                logger.warning("Workspace artifact walk truncated", workspace_path=str(root_resolved), max_entries=GENERATED_ARTIFACT_WALK_MAX_ENTRIES)
                break
            for filename in filenames:
                path = Path(dirpath) / filename
                if filename.startswith("~$") or path.is_symlink():
                    continue
                try:
                    stat = path.stat()
                    if not path.is_file():
                        continue
                    relative = path.relative_to(root_resolved)
                except (OSError, ValueError):
                    continue
                if not _is_generated_artifact_path(relative.as_posix()):
                    continue
                content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                files.append({
                    "path": str(path.resolve()),
                    "relativePath": relative.as_posix(),
                    "title": path.name,
                    "bytes": stat.st_size,
                    "mtime": stat.st_mtime,
                    "contentType": content_type,
                })
    except OSError:
        return []
    files.sort(key=lambda item: item["mtime"], reverse=True)
    return files


def _workspace_generated_file_snapshot(workspace_path: str | None) -> dict[str, dict[str, float | int]]:
    return {
        item["path"]: {"mtime": item["mtime"], "bytes": item["bytes"]}
        for item in _workspace_artifact_candidates(workspace_path)
    }


def _workspace_generated_files(workspace_path: str | None, before: dict[str, Any] | None) -> list[dict[str, Any]]:
    before = before or {}
    files: list[dict[str, Any]] = []
    for item in _workspace_artifact_candidates(workspace_path):
        previous = before.get(item["path"])
        if previous and previous.get("mtime") == item["mtime"] and previous.get("bytes") == item["bytes"]:
            continue
        files.append(item)
    return files[:GENERATED_ARTIFACT_LIMIT]


def _local_generated_file_item(item: dict[str, Any]) -> dict[str, Any]:
    """Attach a content snapshot to a walk-detected file when it is small enough."""
    content: bytes | None = None
    if isinstance(item.get("bytes"), int) and item["bytes"] <= WORKSPACE_ARTIFACT_CONTENT_MAX_BYTES:
        try:
            content = Path(item["path"]).read_bytes()
        except OSError:
            content = None
    return {**item, "content": content}


def _clean_workspace_relative_path(value: Any) -> str | None:
    """Validate a daemon-reported workspace-relative path (untrusted input)."""
    if not isinstance(value, str) or not value.strip():
        return None
    relative = PurePosixPath(value.strip().replace("\\", "/"))
    if relative.is_absolute():
        return None
    parts = relative.parts
    if not parts or any(part in ("..", ".") for part in parts):
        return None
    return relative.as_posix()


def _daemon_reported_generated_files(workspace_path: str | None, raw_files: list[Any]) -> list[dict[str, Any]]:
    """Sanitize the daemon's generated-file report into indexable items.

    The daemon is authenticated but still an external process: paths must stay
    inside its workspace and inline content must respect the snapshot cap.
    """
    items: list[dict[str, Any]] = []
    for raw in raw_files:
        if not isinstance(raw, dict):
            continue
        relative = _clean_workspace_relative_path(raw.get("relativePath"))
        if not relative:
            continue
        # Gate on the actual file path, not the display title, so a report
        # cannot smuggle e.g. a private key behind a document title.
        if not _is_generated_artifact_path(relative):
            continue
        title = raw.get("title") if isinstance(raw.get("title"), str) and raw.get("title", "").strip() else PurePosixPath(relative).name
        content: bytes | None = None
        encoded = raw.get("contentBase64")
        if isinstance(encoded, str) and encoded:
            try:
                decoded = base64.b64decode(encoded, validate=True)
            except (ValueError, TypeError):
                decoded = None
            if decoded is not None and len(decoded) <= WORKSPACE_ARTIFACT_CONTENT_MAX_BYTES:
                content = decoded
        size = raw.get("bytes")
        bytes_count = len(content) if content is not None else size if isinstance(size, int) and size >= 0 else 0
        content_type = raw.get("contentType") if isinstance(raw.get("contentType"), str) and raw.get("contentType") else None
        items.append({
            "path": str(Path(workspace_path) / relative) if workspace_path else relative,
            "relativePath": relative,
            "title": title,
            "bytes": bytes_count,
            "contentType": content_type or mimetypes.guess_type(title)[0] or "application/octet-stream",
            "content": content,
        })
        if len(items) >= GENERATED_ARTIFACT_LIMIT:
            break
    return items


def public_sandbox_record(sandbox: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in sandbox.items() if k not in ("token", "tokenHash", "uiTokenHash", "nodeTokenHash", "nodeToken") and v is not None}


def provisioned_sandbox_record(sandbox: dict[str, Any]) -> dict[str, Any]:
    public = public_sandbox_record(sandbox)
    if sandbox.get("token"):
        public["token"] = sandbox["token"]
    return public


def normalize_agent_role_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ValueError("agent role map must be an object keyed by agent name.")
    invalid_agents = [name for name in value if name not in AGENT_NAMES]
    if invalid_agents:
        raise ValueError(f"Unknown agent name(s): {', '.join(invalid_agents)}.")
    invalid_roles = [role for role in value.values() if role not in AGENT_ROLES]
    if invalid_roles:
        raise ValueError(f"Unknown agent role(s): {', '.join(str(role) for role in invalid_roles)}.")
    return {agent: value[agent] for agent in AGENT_NAMES if agent in value}


def effective_role_for_assignment(node: dict[str, Any], assignment: dict[str, Any], mode: str) -> str:
    explicit_role = assignment.get("role")
    if explicit_role in AGENT_ROLES:
        return explicit_role
    agent = assignment["agent"]
    if mode == "review":
        return role_for_agent(agent, mode)
    overrides = node.get("agentRoleOverrides") if isinstance(node.get("agentRoleOverrides"), dict) else {}
    defaults = node.get("agentRoleDefaults") if isinstance(node.get("agentRoleDefaults"), dict) else {}
    return overrides.get(agent) or defaults.get(agent) or role_for_agent(agent, mode)


def normalize_run_capacity(payload: dict[str, Any]) -> tuple[int, dict[str, int]]:
    raw_by_mode = payload.get("runCapacityByMode") if isinstance(payload.get("runCapacityByMode"), dict) else {}
    by_mode: dict[str, int] = {}
    for mode in AGENT_TASK_MODES:
        raw = raw_by_mode.get(mode)
        by_mode[mode] = raw if isinstance(raw, int) and raw > 0 else 1
    raw_max = payload.get("maxConcurrentRuns")
    max_concurrent = raw_max if isinstance(raw_max, int) and raw_max > 0 else max(by_mode.values())
    return max(1, max_concurrent), by_mode


def node_accepts_run(
    node: dict[str, Any],
    *,
    assignments: list[dict[str, Any]],
    active_runs: list[dict[str, Any]],
    session_id: str | None = None,
) -> bool:
    if session_id and any(run.get("sessionId") == session_id for run in active_runs):
        return False
    requested_modes = [assignment.get("mode") or "action" for assignment in assignments]
    exclusive_request = any(mode != "ask" for mode in requested_modes)
    active_exclusive = any(run.get("mode") != "ask" for run in active_runs)
    if exclusive_request:
        return len(active_runs) == 0
    if active_exclusive:
        return False
    max_concurrent, by_mode = normalize_run_capacity(node)
    active_ask = sum(1 for run in active_runs if run.get("mode") == "ask")
    return len(active_runs) < max_concurrent and active_ask < by_mode.get("ask", 1)


def node_status_for_active_runs(node: dict[str, Any], active_runs: list[dict[str, Any]]) -> str:
    if node.get("status") in ("stopped", "failed", "provisioning"):
        return node["status"]
    return "running" if active_runs else "ready"


def workspace_paths_match(left: str | None, right: str | None) -> bool:
    return bool(left and right and Path(left).resolve() == Path(right).resolve())


def _string_metadata(value: Any, limit: int = 500) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text[:limit] if text else None


def agent_registration_state(payload: dict[str, Any]) -> tuple[dict[str, str], dict[str, dict[str, str]]]:
    supported = set(payload.get("supportedAgents") or [])
    raw_health = payload.get("agentHealth") if isinstance(payload.get("agentHealth"), dict) else {}
    agents: dict[str, str] = {}
    details: dict[str, dict[str, str]] = {}
    for agent in AGENT_NAMES:
        raw = raw_health.get(agent) if isinstance(raw_health, dict) else None
        status = raw.get("status") if isinstance(raw, dict) else None
        agents[agent] = "failed" if status == "failed" else "ready" if status == "ready" or agent in supported else "unknown"
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


def agent_inventory_state(payload: dict[str, Any]) -> dict[str, dict[str, list[dict[str, str]]]]:
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
        **record["command"],
        **({"leaseId": record["leaseId"]} if record.get("leaseId") else {}),
        **({"leaseExpiresAt": record["leaseExpiresAt"]} if record.get("leaseExpiresAt") else {}),
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
        store: LocalSessionStore | None = None,
        daemon_store: LocalDaemonStore | None = None,
        *,
        task_store: LocalTaskStore | None = None,
        liveness_timeout_ms: int = DAEMON_NODE_LIVENESS_TIMEOUT_MS,
    ):
        self.store = store or LocalSessionStore()
        self.daemon_store = daemon_store or LocalDaemonStore(self.store.root_dir)
        self.task_store = task_store
        self.liveness_timeout_ms = liveness_timeout_ms
        self.sandboxes: dict[str, dict[str, Any]] = {}
        self.active_commands: dict[str, dict[str, Any]] = {}
        self.completions: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self.outputs: dict[str, list[str]] = {}
        self.output_sequences: dict[str, set[int]] = {}
        self.plain_node_tokens: dict[str, str] = {}
        self.dispatch_lock = RLock()
        self._load_persisted_state()

    def register(self, payload: dict[str, Any], ui_token: str | None = None) -> dict[str, Any]:
        if payload["protocolVersion"] not in DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS:
            raise ValueError(f"daemon node protocolVersion {payload['protocolVersion']} is not supported.")
        now = now_iso()
        existing = self.sandboxes.get(payload["sandboxId"])
        if (existing and (existing.get("nodeTokenHash") or existing.get("tokenHash"))) and not daemon_node_token_matches(existing, payload["token"]):
            logger.warning("Unauthorized daemon node registration", sandbox_id=payload["sandboxId"])
            raise PermissionError(f"Unauthorized daemon node registration for {payload['sandboxId']}: token does not match the token issued at provisioning.")
        employee_id = (existing or {}).get("employeeId") if existing else payload.get("employeeId")
        next_ui_hash = hash_daemon_node_token(ui_token) if ui_token else (existing or {}).get("uiTokenHash") or (existing or {}).get("tokenHash")
        agents, agent_details = agent_registration_state(payload)
        agent_inventory = agent_inventory_state(payload)
        prior_disabled = list((existing or {}).get("disabledAgents") or [])
        prior_role_defaults = dict((existing or {}).get("agentRoleDefaults") or {})
        prior_role_overrides = dict((existing or {}).get("agentRoleOverrides") or {})
        capacity_input = {
            **({"maxConcurrentRuns": (existing or {}).get("maxConcurrentRuns")} if (existing or {}).get("maxConcurrentRuns") and "maxConcurrentRuns" not in payload else {}),
            **({"runCapacityByMode": (existing or {}).get("runCapacityByMode")} if (existing or {}).get("runCapacityByMode") and "runCapacityByMode" not in payload else {}),
            **payload,
        }
        max_concurrent_runs, run_capacity_by_mode = normalize_run_capacity(capacity_input)
        capabilities = sorted({
            value for value in (payload.get("capabilities") or [])
            if isinstance(value, str) and value in DAEMON_NODE_CAPABILITIES
        })
        sandbox = {
            "id": payload["sandboxId"],
            **({"employeeId": employee_id} if employee_id else {}),
            **({"workspacePath": payload["workspacePath"]} if payload.get("workspacePath") else {}),
            **({"capabilities": capabilities} if capabilities else {}),
            "status": "running" if payload.get("status") == "busy" else "stopped" if payload.get("status") == "stopped" else "ready",
            "agents": agents,
            **({"agentDetails": agent_details} if agent_details else {}),
            **({"agentInventory": agent_inventory} if agent_inventory else {}),
            **({"disabledAgents": prior_disabled} if prior_disabled else {}),
            **({"agentRoleDefaults": prior_role_defaults} if prior_role_defaults else {}),
            **({"agentRoleOverrides": prior_role_overrides} if prior_role_overrides else {}),
            "maxConcurrentRuns": max_concurrent_runs,
            "runCapacityByMode": run_capacity_by_mode,
            "token": None,
            "tokenHash": next_ui_hash,
            "uiTokenHash": next_ui_hash,
            "nodeTokenHash": hash_daemon_node_token(payload.get("token")) or (existing or {}).get("nodeTokenHash") or (existing or {}).get("tokenHash"),
            "nodeToken": payload.get("token") or (existing or {}).get("nodeToken") or self.plain_node_tokens.get(payload["sandboxId"]),
            "createdAt": (existing or {}).get("createdAt", now),
            "updatedAt": now,
            "lastSeenAt": now,
        }
        self.sandboxes[sandbox["id"]] = sandbox
        if payload.get("token"):
            self.plain_node_tokens[sandbox["id"]] = payload["token"]
        self.daemon_store.register_node(sandbox)
        logger.info("Daemon node registered", sandbox_id=sandbox["id"], employee_id=sandbox.get("employeeId"), status=sandbox["status"], agents={agent: status for agent, status in sandbox["agents"].items()})
        return sandbox

    def get(self, sandbox_id: str) -> dict[str, Any] | None:
        return self.sandboxes.get(sandbox_id)

    def list_ready(self) -> list[dict[str, Any]]:
        return sorted(self.sandboxes.values(), key=self._selection_key)

    def update_status(self, sandbox_id: str, patch: dict[str, Any]) -> None:
        sandbox = self.sandboxes.get(sandbox_id)
        if not sandbox:
            return
        next_patch = {k: v for k, v in patch.items() if v is not None}
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
        self.reap_stale_runs()
        nodes = []
        for sandbox in self.list_ready():
            liveness = self._liveness(sandbox)
            nodes.append({
                **public_sandbox_record(sandbox),
                "queuedCommandCount": self.daemon_store.queued_command_count(sandbox["id"]),
                "activeRuns": [daemon_active_run(run) for run in self.daemon_store.list_active_runs(sandbox["id"])],
                "online": liveness["online"],
                "stale": liveness["stale"],
                **({"lastSeenAgeMs": liveness["lastSeenAgeMs"]} if "lastSeenAgeMs" in liveness else {}),
            })
        return nodes

    def monitor_nodes_for_token(self, token: str | None) -> list[dict[str, Any]] | None:
        if not token:
            return None
        allowed = {sandbox["id"] for sandbox in self.sandboxes.values() if sandbox_ui_token_matches(sandbox, token)}
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
        updated = {**sandbox, "employeeId": employee_id, "updatedAt": now_iso()}
        self.sandboxes[sandbox_id] = updated
        self.daemon_store.assign_node_employee(sandbox_id, employee_id)
        logger.info("Daemon node assigned", sandbox_id=sandbox_id, employee_id=employee_id)
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
        updated = {k: v for k, v in sandbox.items() if k not in ("employeeId", "agentRoleOverrides")}
        updated["updatedAt"] = now_iso()
        self.sandboxes[sandbox_id] = updated
        self.daemon_store.unassign_node_employee(sandbox_id)
        logger.info("Daemon node unassigned", sandbox_id=sandbox_id, previous_employee_id=previous)
        return updated

    def set_disabled_agents(self, sandbox_id: str, disabled_agents: list[str]) -> dict[str, Any]:
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
        logger.info("Daemon node disabled agents updated", sandbox_id=sandbox_id, disabled_agents=normalized)
        return updated

    def set_agent_role_defaults(self, sandbox_id: str, role_defaults: dict[str, str]) -> dict[str, Any]:
        sandbox = self.sandboxes.get(sandbox_id)
        if not sandbox:
            raise KeyError(sandbox_id)
        normalized = normalize_agent_role_map(role_defaults)
        updated = {**sandbox, "agentRoleDefaults": normalized, "updatedAt": now_iso()}
        if not normalized:
            updated.pop("agentRoleDefaults", None)
        self.sandboxes[sandbox_id] = updated
        self.daemon_store.update_node_agent_role_defaults(sandbox_id, normalized)
        logger.info("Daemon node agent role defaults updated", sandbox_id=sandbox_id, agent_role_defaults=normalized)
        return updated

    def set_agent_role_overrides(self, sandbox_id: str, role_overrides: dict[str, str]) -> dict[str, Any]:
        sandbox = self.sandboxes.get(sandbox_id)
        if not sandbox:
            raise KeyError(sandbox_id)
        normalized = normalize_agent_role_map(role_overrides)
        updated = {**sandbox, "agentRoleOverrides": normalized, "updatedAt": now_iso()}
        if not normalized:
            updated.pop("agentRoleOverrides", None)
        self.sandboxes[sandbox_id] = updated
        self.daemon_store.update_node_agent_role_overrides(sandbox_id, normalized)
        logger.info("Daemon node agent role overrides updated", sandbox_id=sandbox_id, agent_role_overrides=normalized)
        return updated

    def delete(self, sandbox_id: str) -> None:
        sandbox = self.sandboxes.get(sandbox_id)
        if not sandbox:
            raise KeyError(sandbox_id)
        active_runs = self.daemon_store.list_active_runs(sandbox_id)
        if active_runs:
            raise ValueError("Daemon node has active runs; cancel them before deleting.")
        self.daemon_store.delete_node(sandbox_id)
        self.sandboxes.pop(sandbox_id, None)
        self.plain_node_tokens.pop(sandbox_id, None)
        for command_id, command in list(self.active_commands.items()):
            if command.get("sandboxId") == sandbox_id or command.get("nodeId") == sandbox_id:
                self.active_commands.pop(command_id, None)
                future = self.completions.pop(command_id, None)
                if future and not future.done():
                    future.set_exception(RuntimeError("Daemon node deleted."))
                self.outputs.pop(command_id, None)
                self.output_sequences.pop(command_id, None)
        logger.info("Daemon node deleted", sandbox_id=sandbox_id)

    def provision_pending(self, employee_id: str | None = None, workspace_path: str | None = None) -> tuple[dict[str, Any], str | None, str | None]:
        if employee_id:
            existing = self.find_by_employee(employee_id, workspace_path)
            if existing:
                return existing, None, None
        sandbox_id = new_sandbox_id(employee_id or "node")
        ui_token = new_daemon_node_token()
        node_token = new_daemon_node_token()
        now = now_iso()
        sandbox = {
            "id": sandbox_id,
            **({"employeeId": employee_id} if employee_id else {}),
            **({"workspacePath": workspace_path} if workspace_path else {}),
            "status": "provisioning",
            "agents": {agent: "unknown" for agent in AGENT_NAMES},
            "maxConcurrentRuns": 1,
            "runCapacityByMode": {mode: 1 for mode in AGENT_TASK_MODES},
            "token": None,
            "tokenHash": hash_daemon_node_token(ui_token),
            "uiTokenHash": hash_daemon_node_token(ui_token),
            "nodeTokenHash": hash_daemon_node_token(node_token),
            "nodeToken": node_token,
            "createdAt": now,
            "updatedAt": now,
            "lastError": "Waiting for daemon node registration.",
        }
        self.sandboxes[sandbox_id] = sandbox
        self.plain_node_tokens[sandbox_id] = node_token
        self.daemon_store.register_node(sandbox)
        logger.info("Daemon node provisioned", sandbox_id=sandbox_id, employee_id=employee_id, workspace_path=workspace_path)
        return sandbox, ui_token, node_token

    def find_by_employee(self, employee_id: str, workspace_path: str | None = None) -> dict[str, Any] | None:
        matches = [
            sandbox for sandbox in self.sandboxes.values()
            if sandbox.get("employeeId") == employee_id and (not workspace_path or not sandbox.get("workspacePath") or workspace_paths_match(sandbox.get("workspacePath"), workspace_path))
        ]
        if not matches:
            return None
        return sorted(matches, key=self._selection_key)[0]

    def _selection_key(self, sandbox: dict[str, Any]) -> tuple[int, int, float, str]:
        liveness = self._liveness(sandbox)
        timestamp = sandbox.get("lastSeenAt") or sandbox.get("updatedAt") or sandbox.get("createdAt") or ""
        active_runs = self.daemon_store.list_active_runs(sandbox["id"])
        try:
            seen_at = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp()
        except ValueError:
            seen_at = 0.0
        return (
            0 if liveness["online"] and node_accepts_run(sandbox, assignments=[{"mode": "ask"}], active_runs=active_runs) else 1,
            0 if liveness["online"] else 1,
            -seen_at,
            sandbox["id"],
        )

    def is_live(self, sandbox_id: str) -> bool:
        sandbox = self.sandboxes.get(sandbox_id)
        return bool(sandbox and self._liveness(sandbox)["online"])

    def enqueue(self, sandbox_id: str, command: dict[str, Any]) -> None:
        self.daemon_store.enqueue_command(sandbox_id, command)
        logger.debug("Command enqueued", sandbox_id=sandbox_id, command_id=command["id"], command_type=command["type"])
        if command["type"] == "run.start":
            self.active_commands[command["id"]] = {
                "sandboxId": sandbox_id,
                "commandId": command["id"],
                "sessionId": command["sessionId"],
                "runId": command["runId"],
                "agent": command["agent"],
                "mode": command["mode"],
                "taskGoal": command["taskGoal"],
                **({"workspacePath": command["workspacePath"]} if command.get("workspacePath") else {}),
                "startedAt": now_iso(),
            }

    def take_commands(
        self,
        sandbox_id: str,
        token: str | None,
        *,
        limit: int = 2**53,
        lease_seconds: float = DAEMON_COMMAND_LEASE_SECONDS,
    ) -> list[dict[str, Any]]:
        self._assert_authorized(sandbox_id, token)
        self.reap_stale_runs()
        self._mark_seen(sandbox_id)
        records = self.daemon_store.take_queued_commands(sandbox_id, limit=limit, lease_seconds=lease_seconds)
        logger.debug("Commands taken by daemon node", sandbox_id=sandbox_id, command_count=len(records))
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
                    **({"workspacePath": command["workspacePath"]} if command.get("workspacePath") else {}),
                    "startedAt": record.get("dispatchedAt", now_iso()),
                }
        return [daemon_command_payload(record) for record in records]

    def available_command_count(self, sandbox_id: str, token: str | None) -> int:
        self._assert_authorized(sandbox_id, token)
        self._mark_seen(sandbox_id)
        return self.daemon_store.queued_command_count(sandbox_id)

    def renew_active_command_leases(
        self,
        sandbox_id: str,
        token: str | None,
        command_ids: list[str],
        *,
        lease_seconds: float = DAEMON_ACTIVE_COMMAND_LEASE_SECONDS,
    ) -> None:
        self._assert_authorized(sandbox_id, token)
        self._mark_seen(sandbox_id)
        if not command_ids:
            return
        active_ids = {
            command["commandId"]
            for command in self.active_commands.values()
            if command.get("sandboxId") == sandbox_id
        }
        renewable = [command_id for command_id in dict.fromkeys(command_ids) if command_id in active_ids]
        if renewable and hasattr(self.daemon_store, "renew_command_leases"):
            self.daemon_store.renew_command_leases(sandbox_id, renewable, lease_seconds=lease_seconds)

    async def wait_for_completion(self, command_id: str, timeout_ms: int = DAEMON_RUN_TIMEOUT_MS) -> dict[str, Any]:
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self.completions[command_id] = future
        return await asyncio.wait_for(future, timeout=timeout_ms / 1000)

    def start_run_request(self, sandbox_id: str, session_id: str, task_goal: str, assignments: list[dict[str, Any]], state: dict[str, Any], task_id: str | None = None) -> dict[str, Any]:
        if self.daemon_store.active_run_request_for_session(sandbox_id, session_id):
            raise ValueError(f"Session {session_id} already has an active daemon run.")
        request = self.daemon_store.create_run_request({
            "nodeId": sandbox_id,
            "sessionId": session_id,
            "taskGoal": task_goal,
            "assignments": assignments,
            "state": state,
            **({"taskId": task_id} if task_id else {}),
        })
        return self._enqueue_current_assignment(request)

    def cancel_active_run(self, sandbox_id: str, session_id: str, reason: str) -> dict[str, Any] | None:
        active = next((run for run in self.active_commands.values() if run["sandboxId"] == sandbox_id and run["sessionId"] == session_id), None)
        if not active:
            logger.warning("No active run to cancel", sandbox_id=sandbox_id, session_id=session_id)
            return None
        logger.info("Cancelling active run", sandbox_id=sandbox_id, session_id=session_id, run_id=active["runId"], reason=reason)
        self.enqueue(sandbox_id, {
            "id": new_relay_id("cmd"),
            "type": "run.cancel",
            "commandId": active["commandId"],
            "sessionId": active["sessionId"],
            "runId": active["runId"],
            "agent": active["agent"],
            "mode": active["mode"],
            "reason": reason,
        })
        return active

    def handle_event(self, sandbox_id: str, event: dict[str, Any], token: str | None) -> None:
        self._assert_authorized(sandbox_id, token)
        self._mark_seen(sandbox_id)
        active = self.active_commands.get(event["commandId"])
        if not active:
            logger.debug("Daemon node event ignored: no active command", sandbox_id=sandbox_id, command_id=event["commandId"])
            return
        if active["sandboxId"] != sandbox_id or active["runId"] != event["runId"] or active["sessionId"] != event["sessionId"]:
            logger.warning("Daemon node event mismatch", sandbox_id=sandbox_id, command_id=event["commandId"], run_id=event["runId"])
            raise PermissionError("Unauthorized daemon node event: command belongs to a different sandbox.")
        if active.get("leaseId") and event.get("leaseId") and active["leaseId"] != event["leaseId"]:
            logger.warning("Daemon node event lease mismatch", sandbox_id=sandbox_id, command_id=event["commandId"], run_id=event["runId"])
            raise PermissionError("Unauthorized daemon node event: command lease does not match the active command.")
        if active["agent"] != event["agent"] or (event["type"] != "run.output" and active["mode"] != event.get("mode")):
            logger.warning("Daemon node event command metadata mismatch", sandbox_id=sandbox_id, command_id=event["commandId"], run_id=event["runId"])
            raise PermissionError("Unauthorized daemon node event: command metadata does not match the active command.")
        if hasattr(self.daemon_store, "renew_command_leases"):
            self.daemon_store.renew_command_leases(sandbox_id, [event["commandId"]], lease_seconds=DAEMON_ACTIVE_COMMAND_LEASE_SECONDS)
        if event["type"] == "run.output":
            seen = self.output_sequences.setdefault(event["runId"], set())
            if event["sequence"] in seen:
                return
            if self._session_has_output_sequence(event["sessionId"], event["runId"], event["stream"], event["sequence"]):
                seen.add(event["sequence"])
                return
            seen.add(event["sequence"])
            self.outputs.setdefault(event["runId"], []).append(event["text"])
            self.store.append_event(event["sessionId"], relay_event("agent.output", event["sessionId"], {
                "runId": event["runId"],
                "agent": event["agent"],
                "stream": event["stream"],
                "text": event["text"],
                "sequence": event["sequence"],
            }))
            return
        self.active_commands.pop(event["commandId"], None)
        if event["type"] == "run.completed":
            logger.info("Agent run completed on daemon node", sandbox_id=sandbox_id, command_id=event["commandId"], run_id=event["runId"], agent=event["agent"], mode=event["mode"], exit_code=event.get("exitCode"))
            self.daemon_store.mark_command_completed(sandbox_id, event)
        elif event["type"] == "run.cancelled":
            logger.info("Agent run cancelled on daemon node", sandbox_id=sandbox_id, command_id=event["commandId"], run_id=event["runId"], agent=event["agent"], mode=event["mode"])
            self.daemon_store.mark_command_cancelled(sandbox_id, event)
        else:
            logger.warning("Agent run failed on daemon node", sandbox_id=sandbox_id, command_id=event["commandId"], run_id=event["runId"], agent=event["agent"], mode=event["mode"], error=event.get("error"))
            self.daemon_store.mark_command_failed(sandbox_id, event)
        future = self.completions.pop(event["commandId"], None)
        if future and not future.done():
            future.set_result(event)
            return
        run_request = self.daemon_store.run_request_for_command(event["commandId"])
        if run_request:
            self._advance_run_request(run_request, event)
        else:
            self.clear_run_output(event["runId"])

    def reap_stale_runs(self) -> None:
        for request in self.daemon_store.list_active_run_requests():
            sandbox = self.sandboxes.get(request["nodeId"])
            if not sandbox:
                self._fail_run_request(request, f"Daemon node {request['nodeId']} disappeared.")
                continue
            current_started_at = request.get("currentStartedAt")
            if current_started_at and self._age_ms(current_started_at) > DAEMON_RUN_TIMEOUT_MS:
                self.cancel_active_run(request["nodeId"], request["sessionId"], "Daemon run timed out.")
                self._fail_run_request(request, "Daemon run timed out.")
                continue
            if not self._liveness(sandbox)["online"]:
                self._fail_run_request(request, "Daemon node heartbeat expired while run was active.")

    def _enqueue_current_assignment(self, run_request: dict[str, Any]) -> dict[str, Any]:
        assignments = run_request["assignments"]
        index = run_request.get("currentIndex", 0)
        if index >= len(assignments):
            self._complete_run_request(run_request, "Assignments completed.")
            return run_request
        assignment = assignments[index]
        mode = assignment.get("mode") or "action"
        run_id = new_relay_id("run")
        sandbox = self.sandboxes.get(run_request["nodeId"])
        if not sandbox:
            self._fail_run_request(run_request, f"Sandbox {run_request['nodeId']} was removed before the run could start.")
            return run_request
        controller = self._controller_for_sandbox(sandbox, run_request.get("taskId"))
        state = dict(run_request["state"] or {})
        state.pop("prior_agent_bridge", None)
        state.pop("prior_conversation", None)
        state.pop(ARTIFACT_SNAPSHOT_STATE_KEY, None)
        session_snapshot = self.store.get_session(run_request["sessionId"])
        bridge = compute_prior_agent_bridge(session_snapshot, assignment["agent"], self.store)
        if bridge:
            state["prior_agent_bridge"] = bridge
        conversation = compute_conversation_history(session_snapshot, self.store)
        if conversation:
            state["prior_conversation"] = conversation
        controller.record_agent_started(run_request["sessionId"], {
            "runId": run_id,
            "agent": assignment["agent"],
            "role": effective_role_for_assignment(sandbox, assignment, mode),
            "mode": mode,
        })
        command = {
            "id": new_relay_id("cmd"),
            "type": "run.start",
            "sessionId": run_request["sessionId"],
            "runId": run_id,
            "taskGoal": run_request["taskGoal"],
            "agent": assignment["agent"],
            "mode": mode,
            **({"workspacePath": sandbox["workspacePath"]} if sandbox.get("workspacePath") else {}),
            "state": state,
        }
        # Daemons that report generated files themselves make the backend-side
        # workspace walk unnecessary (and it only works on a shared filesystem).
        artifact_snapshot = (
            None
            if self._node_reports_generated_files(sandbox)
            else _workspace_generated_file_snapshot(sandbox.get("workspacePath"))
        )
        self.enqueue(run_request["nodeId"], command)
        return self.daemon_store.update_run_request(run_request["id"], {
            "currentCommandId": command["id"],
            "currentRunId": run_id,
            "currentAgent": assignment["agent"],
            "currentMode": mode,
            "currentStartedAt": now_iso(),
            "state": {**state, **({ARTIFACT_SNAPSHOT_STATE_KEY: artifact_snapshot} if artifact_snapshot is not None else {})},
        })

    def _advance_run_request(self, run_request: dict[str, Any], event: dict[str, Any]) -> None:
        sandbox = self.sandboxes.get(run_request["nodeId"])
        if not sandbox:
            self.clear_run_output(event["runId"])
            return
        controller = self._controller_for_sandbox(sandbox, run_request.get("taskId"))
        assignments = run_request["assignments"]
        assignment = assignments[run_request.get("currentIndex", 0)]
        mode = assignment.get("mode") or "action"
        state = dict(run_request["state"])
        artifact_snapshot = state.pop(ARTIFACT_SNAPSHOT_STATE_KEY, None)
        if event["type"] == "run.failed":
            agent_log = event.get("agentLog") or event["error"]
            self.clear_run_output(event["runId"])
            controller.record_agent_completed(run_request["sessionId"], state, {"runId": event["runId"], "agent": event["agent"], "mode": mode, "status": "failed", "exitCode": event.get("exitCode", 1), "agentLog": agent_log})
            controller.fail_session(run_request["sessionId"], event["error"])
            self.daemon_store.update_run_request(run_request["id"], {"status": "failed", "error": event["error"]})
            self.update_status(run_request["nodeId"], {"status": "ready", "lastError": event["error"]})
            return
        if event["type"] == "run.cancelled":
            self.clear_run_output(event["runId"])
            controller.record_agent_completed(run_request["sessionId"], state, {"runId": event["runId"], "agent": event["agent"], "mode": mode, "status": "cancelled", "exitCode": 130, "agentLog": ""})
            controller.cancel_session(run_request["sessionId"], event["reason"])
            self.daemon_store.update_run_request(run_request["id"], {"status": "cancelled", "error": event["reason"]})
            self.update_status(run_request["nodeId"], {"status": "ready", "lastError": event["reason"]})
            return
        agent_log = event.get("agentLog") or self.output_for_run(event["runId"])
        self.clear_run_output(event["runId"])
        has_next = event["exitCode"] == 0 and run_request.get("currentIndex", 0) + 1 < len(assignments)
        next_state = controller.record_agent_completed(run_request["sessionId"], state, {
            "runId": event["runId"],
            "agent": event["agent"],
            "mode": mode,
            "status": "completed" if event["exitCode"] == 0 else "failed",
            "exitCode": event["exitCode"],
            "agentLog": agent_log,
            "tokenUsage": event.get("tokenUsage"),
            **({"pipelineHasNext": True} if has_next else {}),
        })
        if event["exitCode"] == 0:
            self._record_generated_workspace_artifacts(sandbox, run_request, event, artifact_snapshot)
        if event["exitCode"] != 0:
            outcome = f"{assignment['agent']} {mode} failed with exit code {event['exitCode']}."
            controller.fail_session(run_request["sessionId"], outcome)
            self.daemon_store.update_run_request(run_request["id"], {"status": "failed", "state": next_state, "error": outcome})
            self.update_status(run_request["nodeId"], {"status": "ready", "lastError": outcome})
            return
        next_index = run_request.get("currentIndex", 0) + 1
        updated = self.daemon_store.update_run_request(run_request["id"], {
            "currentIndex": next_index,
            "state": next_state,
            "currentCommandId": None,
            "currentRunId": None,
            "currentAgent": None,
            "currentMode": None,
            "currentStartedAt": None,
        })
        if next_index >= len(assignments):
            self._complete_run_request(updated, "Assignments completed.")
        else:
            self._enqueue_current_assignment(updated)

    def _node_reports_generated_files(self, sandbox: dict[str, Any]) -> bool:
        return DAEMON_CAPABILITY_GENERATED_FILES in (sandbox.get("capabilities") or [])

    def _record_generated_workspace_artifacts(self, sandbox: dict[str, Any], run_request: dict[str, Any], event: dict[str, Any], artifact_snapshot: dict[str, Any] | None) -> None:
        session_id = run_request["sessionId"]
        workspace_path = sandbox.get("workspacePath")
        if isinstance(event.get("generatedFiles"), list):
            items = _daemon_reported_generated_files(workspace_path, event["generatedFiles"])
        elif self._node_reports_generated_files(sandbox):
            # A capable daemon reported nothing for this run.
            items = []
        else:
            items = [_local_generated_file_item(item) for item in _workspace_generated_files(workspace_path, artifact_snapshot)]
        # A file may legitimately be re-generated by a later run; each change
        # gets its own artifact attributed to the run that produced it. Only
        # duplicates within one report are dropped.
        seen_paths: set[str] = set()
        for item in items:
            path = item["path"]
            if path in seen_paths:
                continue
            seen_paths.add(path)
            artifact = {
                "id": new_relay_id("art"),
                "kind": "workspace_file",
                "title": item["title"],
                "path": path,
                "createdAt": now_iso(),
                "agentRunId": event["runId"],
                "bytes": item["bytes"],
                "contentType": item["contentType"],
                "workspaceRelativePath": item["relativePath"],
            }
            if hasattr(self.store, "index_workspace_artifact"):
                artifact, _session = self.store.index_workspace_artifact(session_id, artifact, item.get("content"))
            else:
                self.store.append_event(session_id, relay_event("artifact.created", session_id, {"artifact": artifact}))
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
        controller = self._controller_for_sandbox(sandbox, run_request.get("taskId")) if sandbox else SessionController(self.store, task_store=self.task_store, task_id=run_request.get("taskId"))
        modes = [(assignment.get("mode") or "action") for assignment in run_request.get("assignments", [])]
        # ask-only discussions and review pipelines both end with a human in
        # the loop; only pure action work is closed out automatically.
        if all(mode == "ask" for mode in modes):
            task_status = "waiting_for_human"
        elif any(mode == "review" for mode in modes):
            task_status = "review"
        else:
            task_status = "done"
        controller.complete_session(run_request["sessionId"], outcome, task_status=task_status)
        self.daemon_store.update_run_request(run_request["id"], {"status": "completed", "error": None})
        self.update_status(run_request["nodeId"], {"status": "ready", "lastError": None})

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
            self.daemon_store.mark_command_failed(run_request["nodeId"], event)
        sandbox = self.sandboxes.get(run_request["nodeId"])
        controller = self._controller_for_sandbox(sandbox, run_request.get("taskId")) if sandbox else SessionController(self.store, task_store=self.task_store, task_id=run_request.get("taskId"))
        if run_id and run_request.get("currentAgent") and run_request.get("currentMode"):
            controller.record_agent_completed(run_request["sessionId"], run_request.get("state", initial_agent_state(run_request["taskGoal"])), {
                "runId": run_id,
                "agent": run_request["currentAgent"],
                "mode": run_request["currentMode"],
                "status": "failed",
                "exitCode": 1,
                "agentLog": outcome,
            })
        controller.fail_session(run_request["sessionId"], outcome)
        self.daemon_store.update_run_request(run_request["id"], {"status": "failed", "error": outcome})
        self.update_status(run_request["nodeId"], {"status": "failed", "lastError": outcome})

    def _controller_for_sandbox(self, sandbox: dict[str, Any], task_id: str | None = None) -> SessionController:
        return SessionController(
            self.store,
            task_store=self.task_store,
            task_id=task_id,
            workspace_path=sandbox.get("workspacePath") or "/workspace",
            owner_employee_id=sandbox.get("employeeId"),
        )

    def _age_ms(self, iso_timestamp: str) -> int:
        try:
            timestamp = iso_timestamp.replace("Z", "+00:00")
            seen_ms = datetime.fromisoformat(timestamp).timestamp() * 1000
            return max(0, int(time.time() * 1000 - seen_ms))
        except Exception:
            logger.warning("Failed to parse timestamp for age calculation", iso_timestamp=iso_timestamp)
            return 0

    def output_for_run(self, run_id: str) -> str:
        return "".join(self.outputs.get(run_id, []))

    def clear_run_output(self, run_id: str) -> None:
        self.outputs.pop(run_id, None)
        self.output_sequences.pop(run_id, None)

    def _session_has_output_sequence(self, session_id: str, run_id: str, stream: str, sequence: int) -> bool:
        try:
            session = self.store.get_session(session_id)
        except Exception:
            logger.warning("Failed to read session when checking output sequence", session_id=session_id, run_id=run_id)
            return False
        return any(
            event.get("type") == "agent.output"
            and event.get("runId") == run_id
            and event.get("stream") == stream
            and event.get("sequence") == sequence
            for event in session.get("events", [])
        )

    def _assert_authorized(self, sandbox_id: str, token: str | None) -> None:
        sandbox = self.sandboxes.get(sandbox_id)
        if not sandbox:
            logger.warning("Daemon node request for unknown sandbox", sandbox_id=sandbox_id)
            raise KeyError(f"Unknown sandbox {sandbox_id}.")
        if not daemon_node_token_matches(sandbox, token):
            logger.warning("Unauthorized daemon node request", sandbox_id=sandbox_id)
            raise PermissionError("Unauthorized daemon node request.")

    def _mark_seen(self, sandbox_id: str) -> None:
        sandbox = self.sandboxes.get(sandbox_id)
        if not sandbox:
            return
        revived = sandbox["status"] in ("stopped", "provisioning", "failed")
        patch = {"status": "ready", "lastError": None} if revived else {}
        now = now_iso()
        updated = {**sandbox, **{k: v for k, v in patch.items() if v is not None}, "updatedAt": now, "lastSeenAt": now}
        if "lastError" in patch and patch["lastError"] is None:
            updated.pop("lastError", None)
        self.sandboxes[sandbox_id] = updated
        self.daemon_store.mark_node_seen(sandbox_id, patch)
        if revived:
            logger.info("Daemon node came online", sandbox_id=sandbox_id, previous_status=sandbox["status"])

    def _load_persisted_state(self) -> None:
        nodes = self.daemon_store.list_nodes()
        if nodes:
            logger.info("Loaded persisted daemon nodes", count=len(nodes))
        active_node_ids = {run["nodeId"] for run in self.daemon_store.list_active_runs()}
        for sandbox in nodes:
            waiting_status = "running" if sandbox["id"] in active_node_ids else "provisioning" if sandbox.get("status") == "provisioning" else "stopped"
            self.sandboxes[sandbox["id"]] = {
                **sandbox,
                "token": None,
                "status": waiting_status,
                "agents": {agent: "unknown" for agent in AGENT_NAMES},
                "updatedAt": now_iso(),
                "lastError": sandbox.get("lastError") or "Waiting for daemon node registration.",
            }
            if sandbox.get("nodeToken"):
                self.plain_node_tokens[sandbox["id"]] = sandbox["nodeToken"]
        for run in self.daemon_store.list_active_runs():
            self.active_commands[run["commandId"]] = {**run, "sandboxId": run["nodeId"]}

    def _liveness(self, sandbox: dict[str, Any]) -> dict[str, Any]:
        if sandbox.get("status") == "stopped" or not sandbox.get("lastSeenAt"):
            return {"online": False, "stale": True}
        try:
            timestamp = sandbox["lastSeenAt"].replace("Z", "+00:00")
            seen_ms = datetime.fromisoformat(timestamp).timestamp() * 1000
        except Exception:
            logger.warning("Failed to parse lastSeenAt for sandbox liveness", sandbox_id=sandbox.get("id"), last_seen=sandbox.get("lastSeenAt"))
            return {"online": False, "stale": True}
        age = max(0, int(time.time() * 1000 - seen_ms))
        online = age <= self.liveness_timeout_ms
        if not online:
            logger.debug("Daemon node stale", sandbox_id=sandbox["id"], last_seen_age_ms=age)
        return {"online": online, "stale": not online, "lastSeenAgeMs": age}

def daemon_active_run(run: dict[str, Any]) -> dict[str, Any]:
    return {key: run[key] for key in ("commandId", "sessionId", "runId", "agent", "mode", "taskGoal", "workspacePath", "startedAt") if key in run}
