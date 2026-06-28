from __future__ import annotations

from typing import Any

from ..core.ids import new_sandbox_id, now_iso
from ..core.models import AGENT_NAMES, DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS
from ..persistence.stores import LocalSessionStore, valid_agent
from ..sessions import SessionController, initial_agent_state
from .registry import (
    DaemonNodeRegistry,
    node_accepts_run,
    sandbox_node_auth_error,
    sandbox_ui_auth_error,
)


class ServerDaemonNodeBackend:
    def __init__(self, registry: DaemonNodeRegistry):
        self.registry = registry

    def provision(self, input: dict[str, Any]) -> dict[str, Any]:
        requested_sandbox_id = input.get("sandboxId")
        existing = self.registry.get(requested_sandbox_id) if requested_sandbox_id else self.registry.find_by_employee(input["employeeId"], input.get("workspacePath"))
        if existing:
            if input.get("actorEmployeeId"):
                return existing
            ui_error = sandbox_ui_auth_error(existing, input.get("token"))
            if not ui_error:
                return existing
            node_error = sandbox_node_auth_error(existing, input.get("nodeToken"))
            if not node_error and input.get("token"):
                employee_id = existing.get("employeeId") or input["employeeId"]
                return self.registry.register({
                    "sandboxId": existing["id"],
                    "employeeId": employee_id,
                    "token": input.get("nodeToken", ""),
                    "workspacePath": existing.get("workspacePath"),
                    "protocolVersion": DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS[0],
                    "supportedAgents": [agent for agent, status in existing.get("agents", {}).items() if status == "ready"],
                    "maxConcurrentRuns": existing.get("maxConcurrentRuns"),
                    "runCapacityByMode": existing.get("runCapacityByMode"),
                    "status": "busy" if existing["status"] == "running" else existing["status"],
                }, input["token"])
            raise PermissionError(node_error or ui_error)
        if not input.get("token"):
            raise PermissionError("Sandbox token is required.")
        if not input.get("nodeToken"):
            raise PermissionError("Daemon node token is required.")
        sandbox_id = requested_sandbox_id or new_sandbox_id(input["employeeId"])
        now = now_iso()
        sandbox = {
            "id": sandbox_id,
            "employeeId": input["employeeId"],
            **({"workspacePath": input["workspacePath"]} if input.get("workspacePath") else {}),
            "status": "provisioning",
            "agents": {agent: "unknown" for agent in AGENT_NAMES},
            "maxConcurrentRuns": 1,
            "runCapacityByMode": {"action": 1, "review": 1, "ask": 1},
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
        sandbox, ui_token, node_token = self.registry.provision_pending(input["employeeId"], input.get("workspacePath"))
        return {
            **sandbox,
            **({"token": ui_token, "sandboxToken": ui_token} if ui_token else {}),
            **({"nodeToken": node_token} if node_token else {}),
        }

    async def run(self, sandbox_id: str, request: dict[str, Any]) -> dict[str, Any]:
        with self.registry.dispatch_lock:
            self.registry.reap_stale_runs()
            sandbox = self.registry.get(sandbox_id)
            if not sandbox:
                raise KeyError(f"Sandbox {sandbox_id} has no registered daemon node.")
            if not sandbox.get("employeeId"):
                raise ValueError(f"Sandbox {sandbox_id} daemon node is not assigned to an employee.")
            if not self.registry.is_live(sandbox_id):
                raise ValueError(f"Sandbox {sandbox_id} daemon node heartbeat expired.")
            disabled = set(sandbox.get("disabledAgents") or [])
            requested_agents = [assignment["agent"] for assignment in request["assignments"]]
            disabled_hit = [agent for agent in requested_agents if agent in disabled]
            not_ready = [
                agent
                for agent in requested_agents
                if agent not in disabled and sandbox.get("agents", {}).get(agent) != "ready"
            ]
            if disabled_hit:
                detail = ", ".join(dict.fromkeys(disabled_hit))
                raise ValueError(
                    f"Sandbox {sandbox_id} daemon node has disabled agent(s): {detail}. "
                    "Re-enable them from the admin console to dispatch work."
                )
            if not_ready:
                detail = ", ".join(dict.fromkeys(not_ready))
                raise ValueError(f"Sandbox {sandbox_id} daemon node does not have ready agent(s): {detail}.")
            actor_employee_id = request.get("actorEmployeeId")
            owner_employee_id = actor_employee_id or sandbox["employeeId"]
            session_id_for_capacity = request.get("sessionId")
            active_runs = self.registry.daemon_store.list_active_runs(sandbox_id)
            if request.get("sessionId"):
                session_owner = session_owner_employee_id(self.registry.store, request["sessionId"])
                if actor_employee_id and not request.get("actorIsAdmin"):
                    assert_session_owned_by_employee(self.registry.store, request["sessionId"], actor_employee_id)
                if not actor_employee_id:
                    assert_session_owned_by_employee(self.registry.store, request["sessionId"], sandbox["employeeId"])
                owner_employee_id = session_owner
                if self.registry.daemon_store.active_run_request_for_session(sandbox_id, request["sessionId"]):
                    raise ValueError(f"Session {request['sessionId']} already has an active daemon run.")
            if sandbox["status"] in ("stopped", "failed", "provisioning"):
                raise ValueError(f"Sandbox {sandbox_id} daemon node is not ready.")
            if not node_accepts_run(
                sandbox,
                assignments=request["assignments"],
                active_runs=active_runs,
                session_id=session_id_for_capacity,
            ):
                raise ValueError(f"Sandbox {sandbox_id} daemon node has no available execution slot.")
            self.registry.update_status(sandbox_id, {"status": "running", "lastError": None})
            task_id = request.get("taskId") if isinstance(request.get("taskId"), str) and request.get("taskId") else None
            controller = SessionController(
                self.registry.store,
                task_store=self.registry.task_store,
                task_id=task_id,
                workspace_path=sandbox.get("workspacePath") or "/workspace",
                owner_employee_id=owner_employee_id,
            )
            session_id = request.get("sessionId") or controller.create_session(
                request["taskGoal"],
                ["human", *dict.fromkeys(assignment["agent"] for assignment in request["assignments"])],
            )["id"]
            # A follow-up turn on an existing session: persist the new user
            # message so it renders in the transcript and feeds the next run's
            # conversation history. A fresh session already captures the first
            # turn as its taskGoal via session.created.
            if request.get("sessionId"):
                controller.record_user_message(
                    session_id,
                    request["taskGoal"],
                    actor_employee_id=actor_employee_id,
                    message_id=request.get("userMessageId"),
                )
            decision = request.get("decision") if isinstance(request.get("decision"), dict) else None
            if decision:
                kind = decision.get("kind")
                note = decision.get("note") if isinstance(decision.get("note"), str) else None
                target_agent = valid_agent(decision.get("targetAgent"))
                if kind == "rerun":
                    controller.record_decision(session_id, "rerun", note, target_agent)
                elif kind == "handoff" and target_agent:
                    controller.handoff_session(session_id, target_agent, request["assignments"], note)
            state = initial_agent_state(request["taskGoal"])
            self.registry.start_run_request(sandbox_id, session_id, request["taskGoal"], request["assignments"], state, task_id)
            return self.registry.store.get_session(session_id)

    def cancel_run(self, sandbox_id: str, session_id: str, reason: str, actor_employee_id: str | None = None) -> dict[str, Any]:
        sandbox = self.registry.get(sandbox_id)
        if not sandbox:
            raise KeyError(f"Sandbox {sandbox_id} has no registered daemon node.")
        if actor_employee_id:
            assert_session_owned_by_employee(self.registry.store, session_id, actor_employee_id)
        active = self.registry.cancel_active_run(sandbox_id, session_id, reason)
        if not active:
            raise KeyError(f"Session {session_id} has no active daemon node run.")
        return self.registry.store.get_session(session_id)


def assert_session_owned_by_employee(store: LocalSessionStore, session_id: str, employee_id: str) -> None:
    try:
        session = store.get_session(session_id)
    except Exception:
        return
    if not session.get("ownerEmployeeId"):
        raise PermissionError(f"Session {session_id} has no owner; {employee_id} is not authorized to run it.")
    if session["ownerEmployeeId"] != employee_id:
        raise PermissionError(f"Session {session_id} is owned by {session['ownerEmployeeId']}; {employee_id} is not authorized to run it.")


def session_owner_employee_id(store: LocalSessionStore, session_id: str) -> str:
    session = store.get_session(session_id)
    owner = session.get("ownerEmployeeId")
    if not owner:
        raise PermissionError(f"Session {session_id} has no owner; cannot start daemon run.")
    return owner
