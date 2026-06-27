from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
import secrets
from threading import RLock
import time
from pathlib import Path
from typing import Any

from loguru import logger

from ..core.environment import load_backend_env
from ..core.ids import new_relay_id, new_sandbox_id, now_iso
from ..core.models import AGENT_NAMES, DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS
from ..persistence.stores import LocalDaemonStore, LocalSessionStore, LocalTaskStore, role_for_agent
from ..sessions import compute_prior_agent_bridge
from ..sessions import compute_conversation_history
from ..sessions import SessionController, initial_agent_state

load_backend_env()

DAEMON_NODE_LIVENESS_TIMEOUT_MS = int(os.environ.get("RELAY_DAEMON_NODE_LIVENESS_TIMEOUT_MS", "15000"))
DAEMON_RUN_TIMEOUT_MS = int(os.environ.get("RELAY_DAEMON_RUN_TIMEOUT_MS", str(15 * 60 * 1000)))
DAEMON_COMMAND_LEASE_SECONDS = float(os.environ.get("RELAY_DAEMON_COMMAND_LEASE_SECONDS", "60"))


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


def public_sandbox_record(sandbox: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in sandbox.items() if k not in ("token", "tokenHash", "uiTokenHash", "nodeTokenHash", "nodeToken") and v is not None}


def provisioned_sandbox_record(sandbox: dict[str, Any]) -> dict[str, Any]:
    public = public_sandbox_record(sandbox)
    if sandbox.get("token"):
        public["token"] = sandbox["token"]
    return public


def workspace_paths_match(left: str | None, right: str | None) -> bool:
    return bool(left and right and Path(left).resolve() == Path(right).resolve())


def _string_metadata(value: Any, limit: int = 500) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text[:limit] if text else None


def agent_registration_state(input: dict[str, Any]) -> tuple[dict[str, str], dict[str, dict[str, str]]]:
    supported = set(input.get("supportedAgents") or [])
    raw_health = input.get("agentHealth") if isinstance(input.get("agentHealth"), dict) else {}
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


def agent_inventory_state(input: dict[str, Any]) -> dict[str, dict[str, list[dict[str, str]]]]:
    """Sanitize the daemon-reported per-agent skill/MCP inventory.

    Untrusted daemon payload: keep only known agents and well-typed fields, and
    drop agents that report nothing so the record stays compact.
    """
    raw = input.get("agentInventory")
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

    def register(self, input: dict[str, Any], ui_token: str | None = None) -> dict[str, Any]:
        if input["protocolVersion"] not in DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS:
            raise ValueError(f"daemon node protocolVersion {input['protocolVersion']} is not supported.")
        now = now_iso()
        existing = self.sandboxes.get(input["sandboxId"])
        if (existing and (existing.get("nodeTokenHash") or existing.get("tokenHash"))) and not daemon_node_token_matches(existing, input["token"]):
            logger.warning("Unauthorized daemon node registration", sandbox_id=input["sandboxId"])
            raise PermissionError(f"Unauthorized daemon node registration for {input['sandboxId']}: token does not match the token issued at provisioning.")
        if existing and existing.get("employeeId") and input.get("employeeId") and input["employeeId"] != existing["employeeId"]:
            logger.warning("Daemon node registration employee mismatch", sandbox_id=input["sandboxId"], expected_employee_id=existing["employeeId"], provided_employee_id=input["employeeId"])
            raise PermissionError(f"Daemon node registration for {input['sandboxId']} does not match the provisioned employee.")
        employee_id = (existing or {}).get("employeeId") or input.get("employeeId")
        next_ui_hash = hash_daemon_node_token(ui_token) if ui_token else (existing or {}).get("uiTokenHash") or (existing or {}).get("tokenHash")
        agents, agent_details = agent_registration_state(input)
        agent_inventory = agent_inventory_state(input)
        prior_disabled = list((existing or {}).get("disabledAgents") or [])
        sandbox = {
            "id": input["sandboxId"],
            **({"employeeId": employee_id} if employee_id else {}),
            **({"workspacePath": input["workspacePath"]} if input.get("workspacePath") else {}),
            "status": "running" if input.get("status") == "busy" else "stopped" if input.get("status") == "stopped" else "ready",
            "agents": agents,
            **({"agentDetails": agent_details} if agent_details else {}),
            **({"agentInventory": agent_inventory} if agent_inventory else {}),
            **({"disabledAgents": prior_disabled} if prior_disabled else {}),
            "token": None,
            "tokenHash": next_ui_hash,
            "uiTokenHash": next_ui_hash,
            "nodeTokenHash": hash_daemon_node_token(input.get("token")) or (existing or {}).get("nodeTokenHash") or (existing or {}).get("tokenHash"),
            "nodeToken": input.get("token") or (existing or {}).get("nodeToken") or self.plain_node_tokens.get(input["sandboxId"]),
            "createdAt": (existing or {}).get("createdAt", now),
            "updatedAt": now,
            "lastSeenAt": now,
        }
        self.sandboxes[sandbox["id"]] = sandbox
        if input.get("token"):
            self.plain_node_tokens[sandbox["id"]] = input["token"]
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
        status = patch.get("status", sandbox.get("status"))
        updated = {**sandbox, **{k: v for k, v in patch.items() if v is not None}, "updatedAt": now_iso()}
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
        updated = {k: v for k, v in sandbox.items() if k != "employeeId"}
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

    def provision_pending(self, employee_id: str, workspace_path: str | None = None) -> tuple[dict[str, Any], str | None, str | None]:
        existing = self.find_by_employee(employee_id, workspace_path)
        if existing:
            return existing, None, None
        sandbox_id = new_sandbox_id(employee_id)
        ui_token = new_daemon_node_token()
        node_token = new_daemon_node_token()
        now = now_iso()
        sandbox = {
            "id": sandbox_id,
            "employeeId": employee_id,
            **({"workspacePath": workspace_path} if workspace_path else {}),
            "status": "provisioning",
            "agents": {agent: "unknown" for agent in AGENT_NAMES},
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
        try:
            seen_at = __import__("datetime").datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp()
        except Exception:
            seen_at = 0.0
        return (
            0 if liveness["online"] and sandbox.get("status") == "ready" else 1,
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
        return self.daemon_store.queued_command_count(sandbox_id)

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
        if event["type"] == "run.output":
            seen = self.output_sequences.setdefault(event["runId"], set())
            if event["sequence"] in seen:
                return
            if self._session_has_output_sequence(event["sessionId"], event["runId"], event["stream"], event["sequence"]):
                seen.add(event["sequence"])
                return
            seen.add(event["sequence"])
            self.outputs.setdefault(event["runId"], []).append(event["text"])
            self.store.append_event(event["sessionId"], {
                "id": new_relay_id("evt"),
                "type": "agent.output",
                "sessionId": event["sessionId"],
                "timestamp": now_iso(),
                "runId": event["runId"],
                "agent": event["agent"],
                "stream": event["stream"],
                "text": event["text"],
                "sequence": event["sequence"],
            })
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
        sandbox = self.sandboxes[run_request["nodeId"]]
        controller = self._controller_for_sandbox(sandbox, run_request.get("taskId"))
        state = dict(run_request["state"] or {})
        state.pop("prior_agent_bridge", None)
        state.pop("prior_conversation", None)
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
            "role": role_for_agent(assignment["agent"], mode),
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
        self.enqueue(run_request["nodeId"], command)
        return self.daemon_store.update_run_request(run_request["id"], {
            "currentCommandId": command["id"],
            "currentRunId": run_id,
            "currentAgent": assignment["agent"],
            "currentMode": mode,
            "currentStartedAt": now_iso(),
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
        state = run_request["state"]
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
        next_state = controller.record_agent_completed(run_request["sessionId"], state, {
            "runId": event["runId"],
            "agent": event["agent"],
            "mode": mode,
            "status": "completed" if event["exitCode"] == 0 else "failed",
            "exitCode": event["exitCode"],
            "agentLog": agent_log,
            "tokenUsage": event.get("tokenUsage"),
        })
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

    def _complete_run_request(self, run_request: dict[str, Any], outcome: str) -> None:
        sandbox = self.sandboxes.get(run_request["nodeId"])
        controller = self._controller_for_sandbox(sandbox, run_request.get("taskId")) if sandbox else SessionController(self.store, task_store=self.task_store, task_id=run_request.get("taskId"))
        controller.complete_session(run_request["sessionId"], outcome)
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
            seen_ms = __import__("datetime").datetime.fromisoformat(timestamp).timestamp() * 1000
            return max(0, int(time.time() * 1000 - seen_ms))
        except Exception:
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
            seen_ms = __import__("datetime").datetime.fromisoformat(timestamp).timestamp() * 1000
        except Exception:
            return {"online": False, "stale": True}
        age = max(0, int(time.time() * 1000 - seen_ms))
        online = age <= self.liveness_timeout_ms
        if not online:
            logger.debug("Daemon node stale", sandbox_id=sandbox["id"], last_seen_age_ms=age)
        return {"online": online, "stale": not online, "lastSeenAgeMs": age}

def daemon_active_run(run: dict[str, Any]) -> dict[str, Any]:
    return {key: run[key] for key in ("commandId", "sessionId", "runId", "agent", "mode", "taskGoal", "workspacePath", "startedAt") if key in run}
