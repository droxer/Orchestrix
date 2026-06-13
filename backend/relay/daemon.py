from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
import secrets
import time
from pathlib import Path
from typing import Any

from loguru import logger

from .controller import SessionController, initial_agent_state, is_review_assignment
from .environment import load_backend_env
from .ids import new_relay_id, new_sandbox_id, now_iso
from .models import AGENT_NAMES, DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS
from .stores import LocalDaemonStore, LocalSessionStore, role_for_agent

load_backend_env()

DAEMON_NODE_LIVENESS_TIMEOUT_MS = int(os.environ.get("RELAY_DAEMON_NODE_LIVENESS_TIMEOUT_MS", "15000"))
DAEMON_RUN_TIMEOUT_MS = int(os.environ.get("RELAY_DAEMON_RUN_TIMEOUT_MS", str(15 * 60 * 1000)))


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


class DaemonNodeRegistry:
    def __init__(
        self,
        store: LocalSessionStore | None = None,
        daemon_store: LocalDaemonStore | None = None,
        *,
        liveness_timeout_ms: int = DAEMON_NODE_LIVENESS_TIMEOUT_MS,
    ):
        self.store = store or LocalSessionStore()
        self.daemon_store = daemon_store or LocalDaemonStore(self.store.root_dir)
        self.liveness_timeout_ms = liveness_timeout_ms
        self.sandboxes: dict[str, dict[str, Any]] = {}
        self.active_commands: dict[str, dict[str, Any]] = {}
        self.completions: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self.outputs: dict[str, list[str]] = {}
        self.output_sequences: dict[str, set[int]] = {}
        self._load_persisted_state()

    def register(self, input: dict[str, Any], ui_token: str | None = None) -> dict[str, Any]:
        if input["protocolVersion"] not in DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS:
            raise ValueError(f"daemon node protocolVersion {input['protocolVersion']} is not supported.")
        now = now_iso()
        existing = self.sandboxes.get(input["sandboxId"])
        if (existing and (existing.get("nodeTokenHash") or existing.get("tokenHash"))) and not daemon_node_token_matches(existing, input["token"]):
            logger.warning("Unauthorized daemon node registration", sandbox_id=input["sandboxId"])
            raise PermissionError(f"Unauthorized daemon node registration for {input['sandboxId']}: token does not match the token issued at provisioning.")
        next_ui_hash = hash_daemon_node_token(ui_token) if ui_token else (existing or {}).get("uiTokenHash") or (existing or {}).get("tokenHash")
        supported = set(input.get("supportedAgents") or [])
        sandbox = {
            "id": input["sandboxId"],
            "employeeId": input["employeeId"],
            **({"workspacePath": input["workspacePath"]} if input.get("workspacePath") else {}),
            "status": "running" if input.get("status") == "busy" else "stopped" if input.get("status") == "stopped" else "ready",
            "agents": {agent: "ready" if agent in supported else "unknown" for agent in AGENT_NAMES},
            "token": None,
            "tokenHash": next_ui_hash,
            "uiTokenHash": next_ui_hash,
            "nodeTokenHash": hash_daemon_node_token(input.get("token")) or (existing or {}).get("nodeTokenHash") or (existing or {}).get("tokenHash"),
            "nodeToken": None,
            "createdAt": (existing or {}).get("createdAt", now),
            "updatedAt": now,
            "lastSeenAt": now,
        }
        self.sandboxes[sandbox["id"]] = sandbox
        self.daemon_store.register_node(sandbox)
        logger.info("Daemon node registered", sandbox_id=sandbox["id"], employee_id=sandbox["employeeId"], status=sandbox["status"], agents={agent: status for agent, status in sandbox["agents"].items()})
        return sandbox

    def get(self, sandbox_id: str) -> dict[str, Any] | None:
        return self.sandboxes.get(sandbox_id)

    def list_ready(self) -> list[dict[str, Any]]:
        return list(self.sandboxes.values())

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
        nodes = []
        for sandbox in self.sandboxes.values():
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
        return self.monitor_nodes()

    def provision_pending(self, employee_id: str, workspace_path: str | None = None) -> tuple[dict[str, Any], str | None]:
        existing = self.find_by_employee(employee_id, workspace_path)
        if existing:
            return existing, None
        sandbox_id = new_sandbox_id(employee_id)
        node_token = new_daemon_node_token()
        now = now_iso()
        sandbox = {
            "id": sandbox_id,
            "employeeId": employee_id,
            **({"workspacePath": workspace_path} if workspace_path else {}),
            "status": "provisioning",
            "agents": {agent: "unknown" for agent in AGENT_NAMES},
            "token": None,
            "tokenHash": None,
            "uiTokenHash": None,
            "nodeTokenHash": hash_daemon_node_token(node_token),
            "nodeToken": None,
            "createdAt": now,
            "updatedAt": now,
            "lastError": "Waiting for daemon node registration.",
        }
        self.sandboxes[sandbox_id] = sandbox
        self.daemon_store.register_node(sandbox)
        logger.info("Daemon node provisioned", sandbox_id=sandbox_id, employee_id=employee_id, workspace_path=workspace_path)
        return sandbox, node_token

    def find_by_employee(self, employee_id: str, workspace_path: str | None = None) -> dict[str, Any] | None:
        matches = [
            sandbox for sandbox in self.sandboxes.values()
            if sandbox["employeeId"] == employee_id and (not workspace_path or not sandbox.get("workspacePath") or workspace_paths_match(sandbox.get("workspacePath"), workspace_path))
        ]
        if not matches:
            return None
        return sorted(matches, key=lambda sandbox: (0 if self._liveness(sandbox)["online"] and sandbox["status"] == "ready" else 1, sandbox.get("lastSeenAt", "")), reverse=False)[0]

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

    def take_commands(self, sandbox_id: str, token: str | None) -> list[dict[str, Any]]:
        self._assert_authorized(sandbox_id, token)
        self._mark_seen(sandbox_id)
        records = self.daemon_store.take_queued_commands(sandbox_id)
        logger.debug("Commands taken by daemon node", sandbox_id=sandbox_id, command_count=len(records))
        for record in records:
            command = record["command"]
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
                    "startedAt": record.get("dispatchedAt", now_iso()),
                }
        return [record["command"] for record in records]

    async def wait_for_completion(self, command_id: str, timeout_ms: int = DAEMON_RUN_TIMEOUT_MS) -> dict[str, Any]:
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self.completions[command_id] = future
        return await asyncio.wait_for(future, timeout=timeout_ms / 1000)

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
        if event["type"] == "run.output":
            seen = self.output_sequences.setdefault(event["runId"], set())
            if event["sequence"] in seen:
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
        else:
            self.clear_run_output(event["runId"])

    def output_for_run(self, run_id: str) -> str:
        return "".join(self.outputs.get(run_id, []))

    def clear_run_output(self, run_id: str) -> None:
        self.outputs.pop(run_id, None)
        self.output_sequences.pop(run_id, None)

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
        for sandbox in nodes:
            waiting_status = "provisioning" if sandbox.get("status") == "provisioning" else "stopped"
            self.sandboxes[sandbox["id"]] = {
                **sandbox,
                "token": None,
                "status": waiting_status,
                "agents": {agent: "unknown" for agent in AGENT_NAMES},
                "updatedAt": now_iso(),
                "lastError": sandbox.get("lastError") or "Waiting for daemon node registration.",
            }
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


class ServerDaemonNodeBackend:
    def __init__(self, registry: DaemonNodeRegistry):
        self.registry = registry

    def provision(self, input: dict[str, Any]) -> dict[str, Any]:
        existing = self.registry.find_by_employee(input["employeeId"], input.get("workspacePath"))
        if existing:
            ui_error = sandbox_ui_auth_error(existing, input.get("token"))
            if not ui_error:
                return existing
            node_error = sandbox_node_auth_error(existing, input.get("nodeToken"))
            if not node_error and input.get("token"):
                return self.registry.register({
                    "sandboxId": existing["id"],
                    "employeeId": existing["employeeId"],
                    "token": input.get("nodeToken", ""),
                    "workspacePath": existing.get("workspacePath"),
                    "protocolVersion": DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS[0],
                    "supportedAgents": [agent for agent, status in existing.get("agents", {}).items() if status == "ready"],
                    "status": "busy" if existing["status"] == "running" else existing["status"],
                }, input["token"])
            raise PermissionError(node_error or ui_error)
        if not input.get("token"):
            raise PermissionError("Sandbox token is required.")
        if not input.get("nodeToken"):
            raise PermissionError("Daemon node token is required.")
        sandbox_id = new_sandbox_id(input["employeeId"])
        now = now_iso()
        sandbox = {
            "id": sandbox_id,
            "employeeId": input["employeeId"],
            **({"workspacePath": input["workspacePath"]} if input.get("workspacePath") else {}),
            "status": "provisioning",
            "agents": {agent: "unknown" for agent in AGENT_NAMES},
            "token": input["token"],
            "createdAt": now,
            "updatedAt": now,
            "lastError": "Waiting for daemon node registration.",
        }
        self.registry.register({
            "sandboxId": sandbox_id,
            "employeeId": input["employeeId"],
            "token": input["nodeToken"],
            "workspacePath": input.get("workspacePath"),
            "protocolVersion": DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS[0],
            "supportedAgents": [],
            "status": "stopped",
        }, input["token"])
        stored = self.registry.get(sandbox_id) or {}
        return {**sandbox, **stored, "token": input["token"]}

    def get(self, sandbox_id: str) -> dict[str, Any] | None:
        return self.registry.get(sandbox_id)

    def list(self) -> list[dict[str, Any]]:
        return self.registry.list_ready()

    def provision_daemon_node(self, input: dict[str, Any]) -> dict[str, Any]:
        sandbox, node_token = self.registry.provision_pending(input["employeeId"], input.get("workspacePath"))
        return {**sandbox, **({"nodeToken": node_token} if node_token else {})}

    async def run(self, sandbox_id: str, request: dict[str, Any]) -> dict[str, Any]:
        sandbox = self.registry.get(sandbox_id)
        if not sandbox:
            raise KeyError(f"Sandbox {sandbox_id} has no registered daemon node.")
        if sandbox["status"] != "ready":
            raise ValueError(f"Sandbox {sandbox_id} daemon node is not ready.")
        if not self.registry.is_live(sandbox_id):
            raise ValueError(f"Sandbox {sandbox_id} daemon node heartbeat expired.")
        if request.get("sessionId"):
            assert_session_owned_by_employee(self.registry.store, request["sessionId"], sandbox["employeeId"])
        self.registry.update_status(sandbox_id, {"status": "running", "lastError": None})
        controller = SessionController(self.registry.store, workspace_path=sandbox.get("workspacePath") or "/workspace", owner_employee_id=sandbox["employeeId"])
        session_id = request.get("sessionId") or controller.create_session(
            request["taskGoal"],
            ["human", *dict.fromkeys(assignment["agent"] for assignment in request["assignments"])],
        )["id"]
        state = initial_agent_state(request["taskGoal"])
        for assignment in request["assignments"]:
            mode = assignment.get("mode") or "implement"
            run_id = new_relay_id("run")
            controller.record_agent_started(session_id, {"runId": run_id, "agent": assignment["agent"], "role": role_for_agent(assignment["agent"], mode), "mode": mode})
            command = {
                "id": new_relay_id("cmd"),
                "type": "run.start",
                "sessionId": session_id,
                "runId": run_id,
                "taskGoal": request["taskGoal"],
                "agent": assignment["agent"],
                "mode": mode,
                **({"workspacePath": sandbox["workspacePath"]} if sandbox.get("workspacePath") else {}),
                "state": state,
            }
            try:
                self.registry.enqueue(sandbox_id, command)
                completed = await self.registry.wait_for_completion(command["id"])
            except Exception as error:
                outcome = str(error)
                self.registry.clear_run_output(run_id)
                state = controller.record_agent_completed(session_id, state, {"runId": run_id, "agent": assignment["agent"], "mode": mode, "status": "failed", "exitCode": 1, "agentLog": ""})
                controller.fail_session(session_id, outcome)
                self.registry.update_status(sandbox_id, {"status": "failed", "lastError": outcome})
                return self.registry.store.get_session(session_id)
            if completed["type"] == "run.failed":
                self.registry.clear_run_output(run_id)
                state = controller.record_agent_completed(session_id, state, {"runId": run_id, "agent": assignment["agent"], "mode": mode, "status": "failed", "exitCode": completed.get("exitCode", 1), "agentLog": completed["error"]})
                controller.fail_session(session_id, completed["error"])
                self.registry.update_status(sandbox_id, {"status": "ready", "lastError": completed["error"]})
                return self.registry.store.get_session(session_id)
            if completed["type"] == "run.cancelled":
                self.registry.clear_run_output(run_id)
                state = controller.record_agent_completed(session_id, state, {"runId": run_id, "agent": assignment["agent"], "mode": mode, "status": "cancelled", "exitCode": 130, "agentLog": ""})
                controller.cancel_session(session_id, completed["reason"])
                self.registry.update_status(sandbox_id, {"status": "ready", "lastError": completed["reason"]})
                return self.registry.store.get_session(session_id)
            agent_log = completed.get("agentLog") or self.registry.output_for_run(run_id)
            self.registry.clear_run_output(run_id)
            state = controller.record_agent_completed(session_id, state, {
                "runId": run_id,
                "agent": assignment["agent"],
                "mode": mode,
                "status": "completed" if completed["exitCode"] == 0 else "failed",
                "exitCode": completed["exitCode"],
                "agentLog": agent_log,
                "codexVerdict": completed.get("codexVerdict", ""),
                "codexFeedback": completed.get("codexFeedback", ""),
            })
            if is_review_assignment(assignment["agent"], mode) and completed.get("codexVerdict") != "approved":
                outcome = "Codex rejected the work." if completed.get("codexVerdict") == "rejected" else "Codex review did not approve the work."
                controller.fail_session(session_id, outcome)
                self.registry.update_status(sandbox_id, {"status": "ready", "lastError": outcome})
                return self.registry.store.get_session(session_id)
            if completed["exitCode"] != 0:
                outcome = f"{assignment['agent']} {mode} failed with exit code {completed['exitCode']}."
                controller.fail_session(session_id, outcome)
                self.registry.update_status(sandbox_id, {"status": "ready", "lastError": outcome})
                return self.registry.store.get_session(session_id)
        controller.complete_session(session_id, "Assignments completed.")
        self.registry.update_status(sandbox_id, {"status": "ready", "lastError": None})
        return self.registry.store.get_session(session_id)

    def cancel_run(self, sandbox_id: str, session_id: str, reason: str) -> dict[str, Any]:
        sandbox = self.registry.get(sandbox_id)
        if not sandbox:
            raise KeyError(f"Sandbox {sandbox_id} has no registered daemon node.")
        active = self.registry.cancel_active_run(sandbox_id, session_id, reason)
        if not active:
            raise KeyError(f"Session {session_id} has no active daemon node run.")
        return self.registry.store.get_session(session_id)


def daemon_active_run(run: dict[str, Any]) -> dict[str, Any]:
    return {key: run[key] for key in ("commandId", "sessionId", "runId", "agent", "mode", "taskGoal", "workspacePath", "startedAt") if key in run}


def assert_session_owned_by_employee(store: LocalSessionStore, session_id: str, employee_id: str) -> None:
    try:
        session = store.get_session(session_id)
    except Exception:
        return
    if not session.get("ownerEmployeeId"):
        raise PermissionError(f"Session {session_id} has no owner; {employee_id} is not authorized to run it.")
    if session["ownerEmployeeId"] != employee_id:
        raise PermissionError(f"Session {session_id} is owned by {session['ownerEmployeeId']}; {employee_id} is not authorized to run it.")
