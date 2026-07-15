from __future__ import annotations

import base64
from collections import defaultdict
import hashlib
import hmac
import mimetypes
import os
import secrets
from datetime import datetime
from threading import RLock
import time
from pathlib import Path, PurePosixPath
from typing import Any, Callable

from loguru import logger

from ..core.environment import load_backend_env
from ..core.ids import new_relay_id, new_sandbox_id, now_iso
from ..core.models import (
    AGENT_NAMES,
    AGENT_ROLES,
    DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS,
)
from ..persistence.stores import (
    LocalDaemonStore,
    LocalSessionStore,
    LocalTaskStore,
    relay_event,
)
from ..sessions import compute_prior_agent_bridge
from ..sessions import compute_conversation_history
from ..sessions import compute_prior_handoff_note
from ..sessions import SessionController, initial_agent_state, merge_agent_state

load_backend_env()

DAEMON_NODE_LIVENESS_TIMEOUT_MS = int(
    os.environ.get("RELAY_DAEMON_NODE_LIVENESS_TIMEOUT_MS", "15000")
)
DAEMON_RUN_TIMEOUT_MS = int(
    os.environ.get("RELAY_DAEMON_RUN_TIMEOUT_MS", str(15 * 60 * 1000))
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
DAEMON_RECORD_PRUNE_INTERVAL_SECONDS = float(
    os.environ.get("RELAY_DAEMON_RECORD_PRUNE_INTERVAL_SECONDS", "60")
)
AGENT_TASK_MODES = ("action", "review", "ask")
# ".key" is deliberately absent: it matches TLS/SSH private keys far more
# often than Keynote decks, and indexed files become downloadable artifacts.
GENERATED_ARTIFACT_EXTENSIONS = frozenset(
    {
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
    }
)
OUTPUT_ARTIFACT_TEXT_EXTENSIONS = frozenset(
    {
        ".json",
        ".log",
        ".md",
        ".txt",
    }
)
GENERATED_ARTIFACT_EXCLUDED_DIRS = frozenset(
    {
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
    }
)
GENERATED_ARTIFACT_LIMIT = 20
# Bound the fallback workspace walk so a pathological tree cannot stall the
# backend event loop; daemons that report generated files skip it entirely.
GENERATED_ARTIFACT_WALK_MAX_ENTRIES = 50_000
# Per-file cap for content snapshots kept alongside the artifact record.
WORKSPACE_ARTIFACT_CONTENT_MAX_BYTES = int(
    os.environ.get("RELAY_WORKSPACE_ARTIFACT_SNAPSHOT_MAX_BYTES", str(2 * 1024 * 1024))
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
DAEMON_CAPABILITY_STRUCTURED_AGENT_EVENTS = "structured-agent-events"
DAEMON_NODE_CAPABILITIES = frozenset(
    {
        DAEMON_CAPABILITY_GENERATED_FILES,
        DAEMON_CAPABILITY_WORKSPACE_READ,
        DAEMON_CAPABILITY_STRUCTURED_AGENT_EVENTS,
    }
)
DAEMON_SANDBOX_MODES = frozenset({"none", "boxlite"})


def _is_generated_artifact_path(relative_path: str) -> bool:
    path = PurePosixPath(relative_path)
    suffix = path.suffix.lower()
    if suffix in GENERATED_ARTIFACT_EXTENSIONS:
        return True
    output_root = path.parts[0] if path.parts else ""
    if (
        len(path.parts) >= 3
        and path.parts[0] == "agents"
        and path.parts[1].startswith("agent-")
    ):
        output_root = path.parts[2]
    return bool(output_root == "output" and suffix in OUTPUT_ARTIFACT_TEXT_EXTENSIONS)


def hash_daemon_node_token(token: str | None) -> str | None:
    if not token:
        return None
    return "sha256:" + hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_daemon_node_token() -> str:
    return "tok_" + secrets.token_urlsafe(24).rstrip("=")


def _hash_matches(expected: str | None, token: str | None) -> bool:
    provided = hash_daemon_node_token(token)
    return bool(
        expected
        and provided
        and len(expected) == len(provided)
        and hmac.compare_digest(expected, provided)
    )


def sandbox_ui_token_matches(sandbox: dict[str, Any], token: str | None) -> bool:
    expected = _credential_hash(sandbox, "uiTokenHash")
    return _hash_matches(expected, token)


def daemon_node_token_matches(sandbox: dict[str, Any], token: str | None) -> bool:
    expected = _credential_hash(sandbox, "nodeTokenHash")
    return _hash_matches(expected, token)


def _credential_hash(sandbox: dict[str, Any], field: str) -> str | None:
    """Read a split credential hash, with one isolated legacy migration path."""
    explicit = sandbox.get(field)
    if isinstance(explicit, str) and explicit:
        return explicit
    legacy = sandbox.get("tokenHash")
    if isinstance(legacy, str) and legacy:
        return legacy
    return hash_daemon_node_token(sandbox.get("token"))


def sandbox_ui_auth_error(sandbox: dict[str, Any], token: str | None) -> str | None:
    if (
        not sandbox.get("uiTokenHash")
        and not sandbox.get("tokenHash")
        and not sandbox.get("token")
    ):
        return "Sandbox token is required." if sandbox.get("nodeTokenHash") else None
    if not token:
        return "Sandbox token is required."
    if not sandbox_ui_token_matches(sandbox, token):
        return "Invalid sandbox token."
    return None


def sandbox_node_auth_error(sandbox: dict[str, Any], token: str | None) -> str | None:
    if (
        not sandbox.get("nodeTokenHash")
        and not sandbox.get("tokenHash")
        and not sandbox.get("token")
    ):
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
                if name not in GENERATED_ARTIFACT_EXCLUDED_DIRS
                and not (Path(dirpath) / name).is_symlink()
            ]
            visited += len(dirnames) + len(filenames)
            if visited > GENERATED_ARTIFACT_WALK_MAX_ENTRIES:
                logger.warning(
                    "Workspace artifact walk truncated",
                    workspace_path=str(root_resolved),
                    max_entries=GENERATED_ARTIFACT_WALK_MAX_ENTRIES,
                )
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
                content_type = (
                    mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                )
                files.append(
                    {
                        "path": str(path.resolve()),
                        "relativePath": relative.as_posix(),
                        "title": path.name,
                        "bytes": stat.st_size,
                        "mtime": stat.st_mtime,
                        "contentType": content_type,
                    }
                )
    except OSError:
        return []
    files.sort(key=lambda item: item["mtime"], reverse=True)
    return files


def _workspace_generated_file_snapshot(
    workspace_path: str | None,
) -> dict[str, dict[str, float | int]]:
    return {
        item["path"]: {"mtime": item["mtime"], "bytes": item["bytes"]}
        for item in _workspace_artifact_candidates(workspace_path)
    }


def _workspace_generated_files(
    workspace_path: str | None, before: dict[str, Any] | None
) -> list[dict[str, Any]]:
    before = before or {}
    files: list[dict[str, Any]] = []
    for item in _workspace_artifact_candidates(workspace_path):
        previous = before.get(item["path"])
        if (
            previous
            and previous.get("mtime") == item["mtime"]
            and previous.get("bytes") == item["bytes"]
        ):
            continue
        files.append(item)
    return files[:GENERATED_ARTIFACT_LIMIT]


def _local_generated_file_item(item: dict[str, Any]) -> dict[str, Any]:
    """Attach a content snapshot to a walk-detected file when it is small enough."""
    content: bytes | None = None
    if (
        isinstance(item.get("bytes"), int)
        and item["bytes"] <= WORKSPACE_ARTIFACT_CONTENT_MAX_BYTES
    ):
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


def _daemon_reported_generated_files(
    workspace_path: str | None, raw_files: list[Any]
) -> list[dict[str, Any]]:
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
        title = (
            raw.get("title")
            if isinstance(raw.get("title"), str) and raw.get("title", "").strip()
            else PurePosixPath(relative).name
        )
        content: bytes | None = None
        encoded = raw.get("contentBase64")
        if isinstance(encoded, str) and encoded:
            try:
                decoded = base64.b64decode(encoded, validate=True)
            except (ValueError, TypeError):
                decoded = None
            if (
                decoded is not None
                and len(decoded) <= WORKSPACE_ARTIFACT_CONTENT_MAX_BYTES
            ):
                content = decoded
        size = raw.get("bytes")
        bytes_count = (
            len(content)
            if content is not None
            else size
            if isinstance(size, int) and size >= 0
            else 0
        )
        content_type = (
            raw.get("contentType")
            if isinstance(raw.get("contentType"), str) and raw.get("contentType")
            else None
        )
        items.append(
            {
                "path": str(Path(workspace_path) / relative)
                if workspace_path
                else relative,
                "relativePath": relative,
                "title": title,
                "bytes": bytes_count,
                "contentType": content_type
                or mimetypes.guess_type(title)[0]
                or "application/octet-stream",
                "content": content,
            }
        )
        if len(items) >= GENERATED_ARTIFACT_LIMIT:
            break
    return items


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


def normalize_agent_role_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ValueError("agent role map must be an object keyed by agent name.")
    invalid_agents = [name for name in value if name not in AGENT_NAMES]
    if invalid_agents:
        raise ValueError(f"Unknown agent name(s): {', '.join(invalid_agents)}.")
    invalid_roles = [role for role in value.values() if role not in AGENT_ROLES]
    if invalid_roles:
        raise ValueError(
            f"Unknown agent role(s): {', '.join(str(role) for role in invalid_roles)}."
        )
    return {agent: value[agent] for agent in AGENT_NAMES if agent in value}


def effective_role_for_assignment(
    node: dict[str, Any], assignment: dict[str, Any], _mode: str
) -> str | None:
    explicit_role = assignment.get("role")
    if explicit_role in AGENT_ROLES:
        return explicit_role
    agent = assignment.get("executorKind") or assignment["agent"]
    overrides = (
        node.get("agentRoleOverrides")
        if isinstance(node.get("agentRoleOverrides"), dict)
        else {}
    )
    defaults = (
        node.get("agentRoleDefaults")
        if isinstance(node.get("agentRoleDefaults"), dict)
        else {}
    )
    return overrides.get(agent) or defaults.get(agent)


def normalize_run_capacity(payload: dict[str, Any]) -> tuple[int, dict[str, int]]:
    raw_by_mode = (
        payload.get("runCapacityByMode")
        if isinstance(payload.get("runCapacityByMode"), dict)
        else {}
    )
    by_mode: dict[str, int] = {}
    for mode in AGENT_TASK_MODES:
        raw = raw_by_mode.get(mode)
        by_mode[mode] = raw if isinstance(raw, int) and raw > 0 else 1
    raw_max = payload.get("maxConcurrentRuns")
    max_concurrent = (
        raw_max if isinstance(raw_max, int) and raw_max > 0 else max(by_mode.values())
    )
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


def node_status_for_active_runs(
    node: dict[str, Any], active_runs: list[dict[str, Any]]
) -> str:
    if node.get("status") in ("stopped", "failed", "provisioning"):
        return node["status"]
    return "running" if active_runs else "ready"


def workspace_paths_match(left: str | None, right: str | None) -> bool:
    return bool(
        left
        and right
        and os.path.normcase(os.path.abspath(left))
        == os.path.normcase(os.path.abspath(right))
    )


def workspace_identity(node: dict[str, Any]) -> tuple[str, str] | None:
    workspace_id = node.get("workspaceId")
    if isinstance(workspace_id, str) and workspace_id.strip():
        return ("id", workspace_id.strip())
    workspace_path = node.get("workspacePath")
    if isinstance(workspace_path, str) and workspace_path.strip():
        return ("path", os.path.normcase(os.path.abspath(workspace_path)))
    return None


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
        self.logical_assignment_validator: Callable[[dict[str, Any]], None] | None = (
            None
        )
        self._last_reap_at = 0.0
        self._last_prune_at = 0.0
        self._load_persisted_state()

    def register(
        self, payload: dict[str, Any], ui_token: str | None = None
    ) -> dict[str, Any]:
        with self.dispatch_lock:
            return self._register_unlocked(payload, ui_token)

    def _register_unlocked(
        self, payload: dict[str, Any], ui_token: str | None
    ) -> dict[str, Any]:
        if payload["protocolVersion"] not in DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS:
            raise ValueError(
                f"daemon node protocolVersion {payload['protocolVersion']} is not supported."
            )
        now = now_iso()
        existing = self.sandboxes.get(payload["sandboxId"])
        if (
            existing and (existing.get("nodeTokenHash") or existing.get("tokenHash"))
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
            or (existing or {}).get("tokenHash")
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
            **({"capabilities": capabilities} if capabilities else {}),
            "status": "running"
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
            "maxConcurrentRuns": max_concurrent_runs,
            "runCapacityByMode": run_capacity_by_mode,
            "uiTokenHash": next_ui_hash,
            "nodeTokenHash": hash_daemon_node_token(payload.get("token"))
            or (existing or {}).get("nodeTokenHash")
            or (existing or {}).get("tokenHash"),
            "createdAt": (existing or {}).get("createdAt", now),
            "updatedAt": now,
            "lastSeenAt": now,
        }
        self.sandboxes[sandbox["id"]] = sandbox
        self._remember_control_panel_node_token(sandbox, payload.get("token"))
        self.daemon_store.register_node(sandbox)
        logger.info(
            "Daemon node registered",
            sandbox_id=sandbox["id"],
            employee_id=sandbox.get("employeeId"),
            status=sandbox["status"],
            agents={agent: status for agent, status in sandbox["agents"].items()},
        )
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
        self.reap_stale_runs(force=False)
        active_runs_by_node: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for run in self.daemon_store.list_active_runs():
            active_runs_by_node[run["nodeId"]].append(run)
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
        updated = {**sandbox, "employeeId": employee_id, "updatedAt": now_iso()}
        self.sandboxes[sandbox_id] = updated
        self.daemon_store.assign_node_employee(sandbox_id, employee_id)
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
    ) -> tuple[dict[str, Any], str | None, str | None]:
        if sandbox_mode not in DAEMON_SANDBOX_MODES:
            sandbox_mode = "boxlite"
        if employee_id:
            existing = self.find_by_employee(employee_id, workspace_path)
            if existing:
                if not existing.get("sandboxMode"):
                    existing = {
                        **existing,
                        "sandboxMode": sandbox_mode,
                        "updatedAt": now_iso(),
                    }
                    self.sandboxes[existing["id"]] = existing
                    self.daemon_store.register_node(existing)
                return (
                    existing,
                    None,
                    self.plain_node_tokens.get(existing["id"]),
                )
        sandbox_id = new_sandbox_id(employee_id or "node")
        ui_token = new_daemon_node_token()
        node_token = new_daemon_node_token()
        now = now_iso()
        sandbox = {
            "id": sandbox_id,
            **({"employeeId": employee_id} if employee_id else {}),
            **({"workspacePath": workspace_path} if workspace_path else {}),
            "sandboxMode": sandbox_mode,
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
        sandbox_id = new_sandbox_id(managed_node.get("employeeId") or "managed")
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
        return sorted(matches, key=self._selection_key)[0]

    def _selection_key(
        self, sandbox: dict[str, Any], active_runs: list[dict[str, Any]] | None = None
    ) -> tuple[int, int, float, str]:
        liveness = self._liveness(sandbox)
        timestamp = (
            sandbox.get("lastSeenAt")
            or sandbox.get("updatedAt")
            or sandbox.get("createdAt")
            or ""
        )
        active_runs = (
            active_runs
            if active_runs is not None
            else self.daemon_store.list_active_runs(sandbox["id"])
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
        sandbox = self.sandboxes.get(sandbox_id)
        return bool(sandbox and self._liveness(sandbox)["online"])

    def enqueue(self, sandbox_id: str, command: dict[str, Any]) -> None:
        with self.dispatch_lock:
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
        with self.dispatch_lock:
            return self._take_commands_unlocked(
                sandbox_id,
                token,
                limit=limit,
                lease_seconds=lease_seconds,
                renew_known_active=renew_known_active,
            )

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
        self.reap_stale_runs()
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
        self._assert_authorized(sandbox_id, token)
        self._mark_seen(sandbox_id)
        if not command_leases:
            return
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
        with self.dispatch_lock:
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
        if self.daemon_store.active_run_request_for_session(sandbox_id, session_id):
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
                "id": new_relay_id("cmd"),
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
        with self.dispatch_lock:
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
        self._assert_authorized(sandbox_id, token)
        self._mark_seen(sandbox_id)

    def reap_stale_runs(self, *, force: bool = True) -> None:
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
                    self._claim_and_advance_run_request(terminal_event)
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
            if not self._liveness(sandbox)["online"]:
                self._fail_run_request(
                    request, "Daemon node heartbeat expired while run was active."
                )

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
        run_id = new_relay_id("run")
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
            session_snapshot, assignment["executorKind"]
        )
        if handoff_note:
            state["prior_handoff_note"] = handoff_note
        if assignment.get("agentInstructions"):
            state["agent_instructions"] = assignment["agentInstructions"]
        command = {
            "id": new_relay_id("cmd"),
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
            else _workspace_generated_file_snapshot(sandbox.get("workspacePath"))
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
                    {"agentVersion": command["agentVersion"]}
                    if command.get("agentVersion")
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
            "currentLogicalAgentId": command.get("logicalAgentId"),
            "currentPlacementId": command.get("placementId"),
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
        session_before = self.store.get_session(run_request["sessionId"])
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
            outcome = f"{assignment['agent']} {mode} failed with exit code {event['exitCode']}."
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
        if isinstance(event.get("generatedFiles"), list):
            items = _daemon_reported_generated_files(
                workspace_path, event["generatedFiles"]
            )
        elif self._node_reports_generated_files(sandbox):
            # A capable daemon reported nothing for this run.
            items = []
        else:
            items = [
                _local_generated_file_item(item)
                for item in _workspace_generated_files(
                    workspace_path, artifact_snapshot
                )
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
                "id": new_relay_id("art"),
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

    def _mark_seen(self, sandbox_id: str) -> None:
        with self.dispatch_lock:
            sandbox = self.sandboxes.get(sandbox_id)
            if not sandbox:
                return
            revived = sandbox["status"] in ("stopped", "provisioning", "failed")
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
        active_node_ids = {
            run["nodeId"] for run in self.daemon_store.list_active_runs()
        }
        for sandbox in nodes:
            waiting_status = (
                "running"
                if sandbox["id"] in active_node_ids
                else "provisioning"
                if sandbox.get("status") == "provisioning"
                else "stopped"
            )
            self.sandboxes[sandbox["id"]] = {
                **sandbox,
                "status": waiting_status,
                "agents": {agent: "unknown" for agent in AGENT_NAMES},
                "updatedAt": now_iso(),
                "lastError": sandbox.get("lastError")
                or "Waiting for daemon node registration.",
            }
        for run in self.daemon_store.list_active_runs():
            self.active_commands[run["commandId"]] = {**run, "sandboxId": run["nodeId"]}

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
            "currentLogicalAgentId",
        )
        if key in run
    }
