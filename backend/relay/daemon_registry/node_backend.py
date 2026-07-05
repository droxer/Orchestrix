from __future__ import annotations

from typing import Any

from ..core.ids import new_sandbox_id, now_iso
from ..core.models import AGENT_NAMES, DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS
from ..persistence.stores import LocalSessionStore, valid_agent
from ..sessions import SessionController, initial_agent_state
from ..sessions.bridge import latest_user_turn_marker
from .registry import (
    DaemonNodeRegistry,
    node_accepts_run,
    sandbox_node_auth_error,
    sandbox_ui_auth_error,
)


class ServerDaemonNodeBackend:
    def __init__(self, registry: DaemonNodeRegistry):
        self.registry = registry

    def provision(self, payload: dict[str, Any]) -> dict[str, Any]:
        requested_sandbox_id = payload.get("sandboxId")
        existing = self.registry.get(requested_sandbox_id) if requested_sandbox_id else self.registry.find_by_employee(payload["employeeId"], payload.get("workspacePath"))
        if existing:
            if payload.get("actorEmployeeId"):
                return existing
            ui_error = sandbox_ui_auth_error(existing, payload.get("token"))
            if not ui_error:
                return existing
            node_error = sandbox_node_auth_error(existing, payload.get("nodeToken"))
            if not node_error and payload.get("token"):
                employee_id = existing.get("employeeId") or payload["employeeId"]
                return self.registry.register({
                    "sandboxId": existing["id"],
                    "employeeId": employee_id,
                    "token": payload.get("nodeToken", ""),
                    "workspacePath": existing.get("workspacePath"),
                    "protocolVersion": DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS[0],
                    "supportedAgents": [agent for agent, status in existing.get("agents", {}).items() if status == "ready"],
                    "maxConcurrentRuns": existing.get("maxConcurrentRuns"),
                    "runCapacityByMode": existing.get("runCapacityByMode"),
                    "status": "busy" if existing["status"] == "running" else existing["status"],
                }, payload["token"])
            raise PermissionError(node_error or ui_error)
        if not payload.get("token"):
            raise PermissionError("Sandbox token is required.")
        if not payload.get("nodeToken"):
            raise PermissionError("Daemon node token is required.")
        sandbox_id = requested_sandbox_id or new_sandbox_id(payload["employeeId"])
        now = now_iso()
        sandbox = {
            "id": sandbox_id,
            "employeeId": payload["employeeId"],
            **({"workspacePath": payload["workspacePath"]} if payload.get("workspacePath") else {}),
            "status": "provisioning",
            "agents": {agent: "unknown" for agent in AGENT_NAMES},
            "maxConcurrentRuns": 1,
            "runCapacityByMode": {"action": 1, "review": 1, "ask": 1},
            "token": payload["token"],
            "createdAt": now,
            "updatedAt": now,
            "lastError": "Waiting for daemon node registration.",
        }
        self.registry.register({
            "sandboxId": sandbox_id,
            "employeeId": payload["employeeId"],
            "token": payload["nodeToken"],
            "workspacePath": payload.get("workspacePath"),
            "protocolVersion": DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS[0],
            "supportedAgents": [],
            "status": "stopped",
        }, payload["token"])
        stored = self.registry.get(sandbox_id) or {}
        return {**sandbox, **stored, "token": payload["token"]}

    def get(self, sandbox_id: str) -> dict[str, Any] | None:
        return self.registry.get(sandbox_id)

    def list(self) -> list[dict[str, Any]]:
        return self.registry.list_ready()

    def provision_daemon_node(self, payload: dict[str, Any]) -> dict[str, Any]:
        sandbox, ui_token, node_token = self.registry.provision_pending(payload.get("employeeId"), payload.get("workspacePath"))
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
            decision = request.get("decision") if isinstance(request.get("decision"), dict) else None
            existing_session = self.registry.store.get_session(request["sessionId"]) if request.get("sessionId") else None
            session_id = request.get("sessionId") or controller.create_session(
                request["taskGoal"],
                ["human", *dict.fromkeys(assignment["agent"] for assignment in request["assignments"])],
            )["id"]
            dispatch_task_goal = request["taskGoal"]
            decision_kind = decision.get("kind") if decision else None
            prior_decision_kind = _latest_decision_kind_after_latest_user(existing_session) if existing_session else None
            is_decision_dispatch = decision_kind in ("rerun", "handoff") or (
                decision is None
                and prior_decision_kind in ("rerun", "handoff")
                and existing_session is not None
                and request["taskGoal"] == existing_session.get("taskGoal")
            )
            # A rerun or handoff is a decision about the existing user turn,
            # not a new user turn. Use the canonical session goal even if an
            # older client sent a note-spliced taskGoal.
            if existing_session and is_decision_dispatch:
                dispatch_task_goal = existing_session.get("taskGoal") or request["taskGoal"]
            # A follow-up turn on an existing session: persist the new user
            # message so it renders in the transcript and feeds the next run's
            # conversation history. A fresh session already captures the first
            # turn as its taskGoal via session.created.
            elif existing_session:
                controller.record_user_message(
                    session_id,
                    request["taskGoal"],
                    actor_employee_id=actor_employee_id,
                    message_id=request.get("userMessageId"),
                )
            if decision:
                kind = decision.get("kind")
                note = decision.get("note") if isinstance(decision.get("note"), str) else None
                target_agent = valid_agent(decision.get("targetAgent"))
                if kind == "rerun":
                    controller.record_decision(session_id, "rerun", note, target_agent)
                elif kind == "handoff" and target_agent:
                    controller.handoff_session(session_id, target_agent, request["assignments"], note)
            state = initial_agent_state(dispatch_task_goal)
            self.registry.start_run_request(sandbox_id, session_id, dispatch_task_goal, request["assignments"], state, task_id)
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
    except Exception as exc:
        raise PermissionError(
            f"Session {session_id} could not be verified for {employee_id}."
        ) from exc
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


def _latest_decision_kind_after_latest_user(session: dict[str, Any]) -> str | None:
    latest_user = latest_user_turn_marker(session)
    latest: tuple[tuple[str, int], str] | None = None
    for index, event in enumerate(session.get("events", [])):
        if event.get("type") != "human.decision":
            continue
        marker = (event.get("timestamp") or "", index)
        if latest_user and marker <= latest_user:
            continue
        decision = event.get("decision") or {}
        kind = decision.get("kind")
        if not isinstance(kind, str):
            continue
        if latest is None or marker > latest[0]:
            latest = (marker, kind)
    return latest[1] if latest else None
