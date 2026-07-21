from __future__ import annotations

from collections import defaultdict
from hashlib import sha256
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
    workspace_identity,
)


class ServerDaemonNodeBackend:
    def __init__(
        self,
        registry: DaemonNodeRegistry,
        *,
        agent_store: Any | None = None,
        employee_agent_store: Any | None = None,
        agent_placement_store: Any | None = None,
    ):
        if (
            agent_store is not None
            and employee_agent_store is not None
            and agent_store is not employee_agent_store
        ):
            raise ValueError(
                "Pass either agent_store or employee_agent_store, not both."
            )
        agent_store = agent_store or employee_agent_store
        self.registry = registry
        self.agent_store = agent_store
        self.agent_placement_store = agent_placement_store
        self.registry.logical_assignment_validator = self._validate_logical_assignment

    def idempotent_run(self, idempotency_key: str, actor_employee_id: str | None) -> dict[str, Any] | None:
        with self.registry.dispatch_lock:
            request = self.registry.daemon_store.get_run_request(_idempotent_run_request_id(idempotency_key))
            if not request:
                return None
            session = self.registry.store.get_session(request["sessionId"])
            if actor_employee_id:
                assert_session_owned_by_employee(self.registry.store, session["id"], actor_employee_id)
            return session

    def _validate_logical_assignment(self, assignment: dict[str, Any]) -> None:
        if self.agent_store is None or self.agent_placement_store is None:
            raise ValueError("logical assignments require agent and placement stores")
        agent = self.agent_store.get_agent(assignment.get("agentId"))
        if not agent or agent.get("deletedAt") or not agent.get("enabled", True):
            raise ValueError("logical agent is disabled or missing")
        if agent.get("executorKind") != assignment.get("executorKind"):
            raise ValueError("logical agent executor changed")
        if agent.get("version") != assignment.get("agentVersion"):
            raise ValueError("logical agent version changed")
        placement = self.agent_placement_store.get_placement(
            assignment.get("placementId")
        )
        if not placement or placement.get("desiredState") != "active":
            raise ValueError("placement is not active")
        if (
            placement.get("agentId") != agent.get("id")
            or placement.get("supervisorEmployeeId")
            != agent.get("supervisorEmployeeId")
            or placement.get("daemonNodeId") != assignment.get("daemonNodeId")
            or placement.get("executorKind") != agent.get("executorKind")
            or placement.get("agentVersion") != agent.get("version")
            or (placement.get("workspacePolicy") or {"kind": "node-affine"})
            != (assignment.get("workspacePolicy") or {"kind": "node-affine"})
        ):
            raise ValueError("placement no longer matches the selected agent and node")
        node = self.registry.get(assignment.get("daemonNodeId"))
        if not node:
            raise ValueError("daemon node is no longer available")

    def provision(self, payload: dict[str, Any]) -> dict[str, Any]:
        requested_sandbox_id = payload.get("sandboxId")
        existing = (
            self.registry.get(requested_sandbox_id)
            if requested_sandbox_id
            else self.registry.find_by_employee(
                payload["employeeId"], payload.get("workspacePath")
            )
        )
        if existing:
            if payload.get("actorEmployeeId"):
                return existing
            ui_error = sandbox_ui_auth_error(existing, payload.get("token"))
            if not ui_error:
                return existing
            node_error = sandbox_node_auth_error(existing, payload.get("nodeToken"))
            if not node_error and payload.get("token"):
                employee_id = existing.get("employeeId") or payload["employeeId"]
                return self.registry.register(
                    {
                        "sandboxId": existing["id"],
                        "employeeId": employee_id,
                        "token": payload.get("nodeToken", ""),
                        "workspacePath": existing.get("workspacePath"),
                        "workspaceId": existing.get("workspaceId"),
                        "protocolVersion": DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS[0],
                        "supportedAgents": [
                            agent
                            for agent, status in existing.get("agents", {}).items()
                            if status == "ready"
                        ],
                        "maxConcurrentRuns": existing.get("maxConcurrentRuns"),
                        "runCapacityByMode": existing.get("runCapacityByMode"),
                        "status": "busy"
                        if existing["status"] == "running"
                        else existing["status"],
                    },
                    payload["token"],
                )
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
            **(
                {"workspacePath": payload["workspacePath"]}
                if payload.get("workspacePath")
                else {}
            ),
            "status": "provisioning",
            "agents": {agent: "unknown" for agent in AGENT_NAMES},
            "maxConcurrentRuns": 1,
            "runCapacityByMode": {"action": 1, "review": 1, "ask": 1},
            "token": payload["token"],
            "createdAt": now,
            "updatedAt": now,
            "lastError": "Waiting for daemon node registration.",
        }
        self.registry.register(
            {
                "sandboxId": sandbox_id,
                "employeeId": payload["employeeId"],
                "token": payload["nodeToken"],
                "workspacePath": payload.get("workspacePath"),
                "protocolVersion": DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS[0],
                "supportedAgents": [],
                "status": "stopped",
            },
            payload["token"],
        )
        stored = self.registry.get(sandbox_id) or {}
        return {**sandbox, **stored, "token": payload["token"]}

    def get(self, sandbox_id: str) -> dict[str, Any] | None:
        return self.registry.get(sandbox_id)

    def list(self) -> list[dict[str, Any]]:
        return self.registry.list_ready()

    def provision_daemon_node(self, payload: dict[str, Any]) -> dict[str, Any]:
        sandbox, ui_token, node_token = self.registry.provision_pending(
            payload.get("employeeId"),
            payload.get("workspacePath"),
            payload.get("sandboxMode") or "boxlite",
            payload.get("nodeLocation"),
        )
        return {
            **sandbox,
            **({"token": ui_token, "sandboxToken": ui_token} if ui_token else {}),
            **({"nodeToken": node_token} if node_token else {}),
        }

    async def run(self, sandbox_id: str, request: dict[str, Any]) -> dict[str, Any]:
        with self.registry.dispatch_lock:
            request = {
                **request,
                "assignments": [
                    {
                        **assignment,
                        "executorKind": assignment.get("executorKind")
                        or assignment.get("agent"),
                    }
                    for assignment in request["assignments"]
                ],
            }
            idempotency_key = request.get("idempotencyKey")
            run_request_id = (
                _idempotent_run_request_id(idempotency_key)
                if isinstance(idempotency_key, str) and idempotency_key
                else None
            )
            if run_request_id:
                existing_request = self.registry.daemon_store.get_run_request(run_request_id)
                if existing_request:
                    session = self.registry.store.get_session(existing_request["sessionId"])
                    actor_employee_id = request.get("actorEmployeeId")
                    if actor_employee_id:
                        assert_session_owned_by_employee(
                            self.registry.store, session["id"], actor_employee_id
                        )
                    return session
            self.registry.reap_stale_runs()
            active_runs_by_node: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for active_run in self.registry.daemon_store.list_active_runs():
                active_runs_by_node[active_run["nodeId"]].append(active_run)
            sandbox = self.registry.get(sandbox_id)
            if not sandbox:
                raise KeyError(f"Sandbox {sandbox_id} has no registered daemon node.")
            agent_first = request.get("agentFirst") is True
            if not sandbox.get("employeeId") and not agent_first:
                raise ValueError(
                    f"Sandbox {sandbox_id} daemon node is not assigned to an employee."
                )
            assignment_nodes = {
                assignment.get("daemonNodeId") or sandbox_id
                for assignment in request["assignments"]
            }
            runtime_nodes = [self.registry.get(node_id) for node_id in assignment_nodes]
            if any(node is None for node in runtime_nodes):
                raise ValueError("An assigned runtime node is no longer registered.")
            workspace_keys = {
                workspace_identity(node) for node in runtime_nodes if node
            }
            if len(assignment_nodes) > 1 and (
                None in workspace_keys or len(workspace_keys) != 1
            ):
                raise ValueError(
                    "workspace_unavailable: selected agent placements do not advertise one shared workspace identity."
                )
            if (
                len(assignment_nodes) > 1
                and all(
                    assignment.get("agentId") for assignment in request["assignments"]
                )
                and any(
                    (assignment.get("workspacePolicy") or {}).get("kind")
                    != "shared-path"
                    for assignment in request["assignments"]
                )
            ):
                raise ValueError(
                    "workspace_unavailable: cross-node agent placements require shared-path policy."
                )
            for assignment in request["assignments"]:
                node_id = assignment.get("daemonNodeId") or sandbox_id
                node = self.registry.get(node_id)
                assert node is not None
                if assignment.get("agentId"):
                    self._validate_logical_assignment(assignment)
                if not self.registry.is_live(node_id):
                    raise ValueError(
                        f"Sandbox {node_id} daemon node heartbeat expired."
                    )
                if assignment["executorKind"] in set(node.get("disabledAgents") or []):
                    raise ValueError(
                        f"Sandbox {node_id} daemon node has disabled agent(s): {assignment['executorKind']}. "
                        "Re-enable them from the admin console to dispatch work."
                    )
                if node.get("agents", {}).get(assignment["executorKind"]) != "ready":
                    raise ValueError(
                        f"Sandbox {node_id} does not have ready agent {assignment['executorKind']}."
                    )
                if not node_accepts_run(
                    node,
                    assignments=[assignment],
                    active_runs=active_runs_by_node[node_id],
                    session_id=request.get("sessionId"),
                ):
                    raise ValueError(
                        f"capacity_exhausted: Sandbox {node_id} has no available execution slot."
                    )
            actor_employee_id = request.get("actorEmployeeId")
            owner_agent_id = next(
                (
                    item.get("agentId")
                    for item in request["assignments"]
                    if item.get("agentId")
                ),
                None,
            )
            if request.get("sessionId"):
                owner_employee_id = (
                    (self.agent_store.get_agent(owner_agent_id) or {}).get(
                        "supervisorEmployeeId"
                    )
                    if owner_agent_id
                    else actor_employee_id or sandbox.get("employeeId")
                )
                if not owner_employee_id:
                    raise PermissionError("Logical agent has no supervisor.")
                assert_session_owned_by_employee(
                    self.registry.store, request["sessionId"], owner_employee_id
                )
                if self.registry.daemon_store.active_run_request_for_session_any_node(
                    request["sessionId"]
                ):
                    raise ValueError(
                        f"Session {request['sessionId']} already has an active daemon run."
                    )
            if sandbox["status"] in ("stopped", "failed", "provisioning"):
                raise ValueError(f"Sandbox {sandbox_id} daemon node is not ready.")
            task_id = (
                request.get("taskId")
                if isinstance(request.get("taskId"), str) and request.get("taskId")
                else None
            )
            controller = SessionController(
                self.registry.store,
                task_store=self.registry.task_store,
                task_id=task_id,
                workspace_path=sandbox.get("workspacePath") or "/workspace",
                owner_employee_id=(
                    (self.agent_store.get_agent(owner_agent_id) or {}).get(
                        "supervisorEmployeeId"
                    )
                    if owner_agent_id
                    else actor_employee_id or sandbox.get("employeeId")
                ),
                owner_agent_id=owner_agent_id,
            )
            decision = (
                request.get("decision")
                if isinstance(request.get("decision"), dict)
                else None
            )
            existing_session = (
                self.registry.store.get_session(request["sessionId"])
                if request.get("sessionId")
                else None
            )
            session_id = (
                request.get("sessionId")
                or controller.create_session(
                    request["taskGoal"],
                    [
                        "human",
                        *dict.fromkeys(
                            assignment["executorKind"]
                            for assignment in request["assignments"]
                        ),
                    ],
                )["id"]
            )
            dispatch_task_goal = request["taskGoal"]
            decision_kind = decision.get("kind") if decision else None
            prior_decision_kind = (
                _latest_decision_kind_after_latest_user(existing_session)
                if existing_session
                else None
            )
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
                dispatch_task_goal = (
                    existing_session.get("taskGoal") or request["taskGoal"]
                )
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
                note = (
                    decision.get("note")
                    if isinstance(decision.get("note"), str)
                    else None
                )
                target_agent = valid_agent(decision.get("targetAgent"))
                if kind == "rerun":
                    controller.record_decision(session_id, "rerun", note, target_agent)
                elif kind == "handoff" and target_agent:
                    controller.handoff_session(
                        session_id,
                        target_agent,
                        request["assignments"],
                        note,
                        decision.get("targetAgentId"),
                    )
            state = initial_agent_state(dispatch_task_goal)
            self.registry.start_run_request(
                sandbox_id,
                session_id,
                dispatch_task_goal,
                request["assignments"],
                state,
                task_id,
                active_runs=active_runs_by_node[
                    (
                        request["assignments"][0].get("daemonNodeId") or sandbox_id
                        if request["assignments"]
                        else sandbox_id
                    )
                ],
                request_id=run_request_id,
            )
            return self.registry.store.get_session(session_id)

    def cancel_run(
        self,
        sandbox_id: str,
        session_id: str,
        reason: str,
        actor_employee_id: str | None = None,
    ) -> dict[str, Any]:
        sandbox = self.registry.get(sandbox_id)
        if not sandbox:
            raise KeyError(f"Sandbox {sandbox_id} has no registered daemon node.")
        if actor_employee_id:
            assert_session_owned_by_employee(
                self.registry.store, session_id, actor_employee_id
            )
        active = self.registry.cancel_active_run(sandbox_id, session_id, reason)
        if not active:
            session = self.registry.store.get_session(session_id)
            if session.get("status") in ("completed", "failed", "cancelled"):
                return session
            raise KeyError(f"Session {session_id} has no active daemon node run.")
        return self.registry.store.get_session(session_id)


def _idempotent_run_request_id(idempotency_key: str) -> str:
    return f"drun_idem_{sha256(idempotency_key.encode()).hexdigest()}"


def assert_session_owned_by_employee(
    store: LocalSessionStore, session_id: str, employee_id: str
) -> None:
    try:
        session = store.get_session(session_id)
    except Exception as exc:
        raise PermissionError(
            f"Session {session_id} could not be verified for {employee_id}."
        ) from exc
    if not session.get("ownerEmployeeId"):
        raise PermissionError(
            f"Session {session_id} has no owner; {employee_id} is not authorized to run it."
        )
    if session["ownerEmployeeId"] != employee_id:
        raise PermissionError(
            f"Session {session_id} is owned by {session['ownerEmployeeId']}; {employee_id} is not authorized to run it."
        )


def session_owner_employee_id(store: LocalSessionStore, session_id: str) -> str:
    session = store.get_session(session_id)
    owner = session.get("ownerEmployeeId")
    if not owner:
        raise PermissionError(
            f"Session {session_id} has no owner; cannot start daemon run."
        )
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
