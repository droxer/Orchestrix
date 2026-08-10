from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..core.ids import new_database_id, new_relay_id
from ..services.agent_routing import (
    AgentRoutingError,
    resolve_agent_assignments,
    resolve_session_daemon_node_id,
)
from ..services.team_dispatch import TeamDispatchError, team_agents, team_member_assignments
from ..sessions.controller import SessionController
from .models import MessageIntent, RunIntent

ASSIGNMENT_BRIEF_MAX_CHARS = 4000
VALID_MODES = frozenset({"action", "ask", "review"})
VALID_ROLES = frozenset({"implementer", "reviewer", "planner", "tester", "fixer"})


class CollaborationError(ValueError):
    def __init__(self, code: str, message: str | None = None, *, status: int = 409):
        self.code = code
        self.status = status
        super().__init__(message or code)


@dataclass(frozen=True)
class _PreparedRound:
    task_goal: str
    session_id: str | None
    raw_assignments: list[dict[str, Any]] | None
    mode: str
    requested_node_id: str | None
    idempotency_key: str | None
    user_message_id: str | None
    decision: dict[str, Any] | None
    source: str
    purpose: str
    address: dict[str, Any]


class CollaborationConductor:
    """Turn semantic collaboration intent into one durable, auditable round.

    Daemon delivery remains behind ``ctx.backend`` during the compatibility
    migration. Callers no longer need to resolve a room into assignments.
    """

    def __init__(self, ctx: Any):
        self.ctx = ctx

    async def submit(
        self, intent: MessageIntent | RunIntent, actor: dict[str, Any]
    ) -> dict[str, Any]:
        prepared = self._prepare(intent)
        if prepared.idempotency_key:
            existing = self.ctx.backend.idempotent_run(
                prepared.idempotency_key, actor["employeeId"]
            )
            if existing:
                return existing
        try:
            return await self._submit_prepared(prepared, actor)
        except TeamDispatchError as error:
            raise CollaborationError(error.code) from error
        except AgentRoutingError as error:
            raise CollaborationError(error.code, str(error)) from error
        except PermissionError as error:
            raise CollaborationError("forbidden", str(error), status=403) from error
        except CollaborationError:
            raise
        except ValueError as error:
            raise CollaborationError("collaboration_conflict", str(error)) from error

    @staticmethod
    def _prepare(intent: MessageIntent | RunIntent) -> _PreparedRound:
        if isinstance(intent, MessageIntent):
            purpose_modes = {
                "accomplish": "action",
                "discuss": "ask",
                "review": "review",
            }
            raw_assignments = (
                [{"agentId": intent.address_agent_id, "mode": purpose_modes[intent.purpose]}]
                if intent.address_agent_id
                else None
            )
            address = (
                {"kind": "members", "agentIds": [intent.address_agent_id]}
                if intent.address_agent_id
                else {"kind": "room"}
            )
            return _PreparedRound(
                task_goal=intent.text,
                session_id=intent.thread_id,
                raw_assignments=raw_assignments,
                mode=purpose_modes[intent.purpose],
                requested_node_id=None,
                idempotency_key=intent.idempotency_key,
                user_message_id=intent.user_message_id,
                decision=None,
                source="message",
                purpose=intent.purpose,
                address=address,
            )
        raw_assignments = intent.raw_assignments
        addressed = [
            item.get("agentId")
            for item in (raw_assignments or [])
            if isinstance(item, dict) and isinstance(item.get("agentId"), str)
        ]
        return _PreparedRound(
            task_goal=intent.task_goal,
            session_id=intent.session_id,
            raw_assignments=raw_assignments,
            mode=_mode(intent.mode),
            requested_node_id=intent.requested_node_id,
            idempotency_key=intent.idempotency_key,
            user_message_id=intent.user_message_id,
            decision=intent.decision,
            source=intent.source,
            purpose=_purpose_for_mode(intent.mode),
            address=(
                {"kind": "members", "agentIds": addressed}
                if addressed
                else {"kind": "room"}
            ),
        )

    async def _submit_prepared(
        self, intent: _PreparedRound, actor: dict[str, Any]
    ) -> dict[str, Any]:
        session = self._session_for_actor(intent.session_id, actor)
        session = self._backfill_runtime_affinity(session)
        raw_assignments = intent.raw_assignments
        team_id = session.get("teamId") if session else None
        team_member_ids: set[str] = set()
        team_snapshot: dict[str, Any] | None = None
        team: dict[str, Any] | None = None
        is_recovery = isinstance(intent.decision, dict) and intent.decision.get(
            "kind"
        ) in ("rerun", "handoff")
        if team_id and not raw_assignments:
            team, members = self._team_for_round(team_id, session, actor)
            team_member_ids = {agent["id"] for agent in members}
            team_snapshot = _team_snapshot(team, members)
            raw_assignments = team_member_assignments(
                members, mode=intent.mode, team=team
            )
        elif team_id and raw_assignments:
            if is_recovery:
                team = self.ctx.team_store.get_team(team_id)
                if not team or team.get("deletedAt"):
                    raise CollaborationError("team_not_found")
                expected_owner = self._team_employee_id(session, actor)
                if team.get("ownerEmployeeId") != expected_owner:
                    raise CollaborationError("team_forbidden")
                team_member_ids = set(team.get("memberAgentIds") or [])
                members = [
                    self.ctx.agent_store.get_agent(agent_id)
                    for agent_id in team.get("memberAgentIds") or []
                ]
                members = [member for member in members if member]
            else:
                team, members = self._team_for_round(team_id, session, actor)
                team_member_ids = {agent["id"] for agent in members}
            team_snapshot = _team_snapshot(team, members)
        elif session and not raw_assignments:
            owner_agent_id = session.get("ownerAgentId")
            if not isinstance(owner_agent_id, str) or not owner_agent_id:
                raise CollaborationError(
                    "participants_required",
                    "The thread has no addressable room participant.",
                    status=400,
                )
            raw_assignments = [{"agentId": owner_agent_id, "mode": intent.mode}]
        if not raw_assignments:
            raise CollaborationError(
                "participants_required", "At least one participant is required.", status=400
            )

        daemon_nodes = self.ctx.registry.monitor_nodes()
        session_node_id = resolve_session_daemon_node_id(
            session,
            self.ctx.agent_placement_store,
            daemon_nodes,
            self.ctx.registry.daemon_store,
        )
        requested_original_runtime = bool(
            session
            and session.get("managedNodeId")
            and intent.requested_node_id == session.get("daemonNodeId")
        )
        if (
            session_node_id
            and intent.requested_node_id
            and intent.requested_node_id != session_node_id
            and not requested_original_runtime
        ):
            raise CollaborationError(
                "workspace_unavailable",
                "This thread already runs on another computer.",
            )
        required_node_id = session_node_id or intent.requested_node_id
        assignments = self._compile_assignments(
            raw_assignments, team_id, team_member_ids, team_snapshot
        )
        resolved = resolve_agent_assignments(
            assignments,
            employee_id=actor["employeeId"],
            is_admin=actor["isAdmin"],
            agent_store=self.ctx.agent_store,
            placement_store=self.ctx.agent_placement_store,
            daemon_nodes=daemon_nodes,
            session=session,
            required_node_id=required_node_id,
            daemon_store=self.ctx.registry.daemon_store,
        )
        collaboration_id = new_relay_id("col")
        round_id = new_relay_id("round")
        manifest = _round_manifest(
            collaboration_id,
            round_id,
            intent,
            resolved,
            team_snapshot,
        )
        parsed: dict[str, Any] = {
            "taskGoal": intent.task_goal,
            "assignments": resolved,
            "actorEmployeeId": actor["employeeId"],
            "actorIsAdmin": actor["isAdmin"],
            "agentFirst": True,
            "daemonNodeId": required_node_id or resolved[0]["daemonNodeId"],
            "collaboration": {"manifest": manifest},
        }
        if intent.session_id:
            parsed["sessionId"] = intent.session_id
        if intent.user_message_id:
            parsed["userMessageId"] = intent.user_message_id
        if intent.idempotency_key:
            parsed["idempotencyKey"] = intent.idempotency_key
        if team_id:
            parsed["teamId"] = team_id
        if intent.decision:
            parsed["decision"] = _validated_decision(intent.decision, resolved[0])
        return await self.ctx.backend.run(resolved[0]["daemonNodeId"], parsed)

    def _session_for_actor(
        self, session_id: str | None, actor: dict[str, Any]
    ) -> dict[str, Any] | None:
        if not session_id:
            return None
        try:
            session = self.ctx.session_store.get_session(session_id)
        except KeyError as error:
            raise CollaborationError("thread_not_found", status=404) from error
        if not session.get("id"):
            raise CollaborationError("thread_not_found", status=404)
        if not actor["isAdmin"] and session.get("ownerEmployeeId") != actor[
            "employeeId"
        ]:
            raise CollaborationError("thread_forbidden", status=403)
        return session

    def _backfill_runtime_affinity(
        self, session: dict[str, Any] | None
    ) -> dict[str, Any] | None:
        if not session or session.get("managedNodeId") or not session.get("daemonNodeId"):
            return session
        managed_node_id = self.ctx.registry.daemon_store.historical_managed_node_id(
            session["daemonNodeId"]
        )
        if not managed_node_id:
            return session
        return SessionController(self.ctx.session_store).record_runtime_affinity(
            session["id"], managed_node_id
        )

    def _team_employee_id(
        self, session: dict[str, Any], actor: dict[str, Any]
    ) -> str:
        if actor["isAdmin"]:
            return session.get("ownerEmployeeId") or actor["employeeId"]
        return actor["employeeId"]

    def _team_for_round(
        self, team_id: str, session: dict[str, Any], actor: dict[str, Any]
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        return team_agents(
            team_id,
            self._team_employee_id(session, actor),
            team_store=self.ctx.team_store,
            agent_store=self.ctx.agent_store,
        )

    @staticmethod
    def _compile_assignments(
        raw_assignments: list[dict[str, Any]],
        team_id: str | None,
        team_member_ids: set[str],
        team_snapshot: dict[str, Any] | None,
    ) -> list[dict[str, Any]]:
        assignments: list[dict[str, Any]] = []
        for item in raw_assignments:
            if (
                not isinstance(item, dict)
                or not isinstance(item.get("agentId"), str)
                or not item["agentId"]
            ):
                raise CollaborationError(
                    "assignment_invalid", "Each participant requires agentId.", status=400
                )
            if team_id and item["agentId"] not in team_member_ids:
                raise CollaborationError(
                    "agent_forbidden",
                    "This thread belongs to a team; only its members can answer it.",
                )
            mode = _mode(item.get("mode"))
            role = _role(item.get("role"))
            phase = (
                "discussion"
                if mode == "ask"
                else "review"
                if mode == "review" or role == "reviewer"
                else "execution"
            )
            assignments.append(
                {
                    "assignmentId": item.get("assignmentId") or new_database_id(),
                    "agentId": item["agentId"],
                    **(
                        {"executorKind": item["executorKind"]}
                        if isinstance(item.get("executorKind"), str)
                        and item["executorKind"]
                        else {}
                    ),
                    "mode": mode,
                    "phase": phase,
                    **({"role": role} if role else {}),
                    **(
                        {"brief": item["brief"].strip()[:ASSIGNMENT_BRIEF_MAX_CHARS]}
                        if isinstance(item.get("brief"), str) and item["brief"].strip()
                        else {}
                    ),
                    **(
                        {"coordinator": True}
                        if team_snapshot
                        and item["agentId"] == team_snapshot.get("leadAgentId")
                        else {}
                    ),
                    **({"teamSnapshot": team_snapshot} if team_snapshot else {}),
                }
            )
        return assignments


def _mode(value: Any) -> str:
    return value if value in VALID_MODES else "action"


def _role(value: Any) -> str | None:
    return value if value in VALID_ROLES else None


def _purpose_for_mode(mode: Any) -> str:
    return "discuss" if mode == "ask" else "review" if mode == "review" else "accomplish"


def _team_snapshot(
    team: dict[str, Any], members: list[dict[str, Any]]
) -> dict[str, Any]:
    return {
        "teamId": team["id"],
        "teamRevision": team.get("updatedAt") or team.get("createdAt"),
        "memberAgentIds": [member["id"] for member in members],
        "leadAgentId": team.get("leadAgentId"),
    }


def _round_manifest(
    collaboration_id: str,
    round_id: str,
    intent: _PreparedRound,
    assignments: list[dict[str, Any]],
    team_snapshot: dict[str, Any] | None,
) -> dict[str, Any]:
    strategy = (
        "direct"
        if intent.address.get("kind") == "members" and len(assignments) == 1
        else "room"
        if intent.purpose == "discuss"
        else "review"
        if intent.purpose == "review"
        else "coordinate"
    )
    return {
        "collaborationId": collaboration_id,
        "roundId": round_id,
        "source": intent.source,
        "purpose": intent.purpose,
        "strategy": strategy,
        "address": intent.address,
        **({"teamSnapshot": team_snapshot} if team_snapshot else {}),
        "assignments": [
            {
                key: assignment[key]
                for key in (
                    "assignmentId",
                    "agentId",
                    "mode",
                    "phase",
                    "role",
                    "brief",
                    "coordinator",
                )
                if assignment.get(key) is not None
            }
            for assignment in assignments
        ],
        "completionPolicy": (
            "synthesize" if strategy in ("room", "review") else "assigned_work"
        ),
    }


def _validated_decision(
    decision: dict[str, Any], target_assignment: dict[str, Any]
) -> dict[str, Any]:
    kind = decision.get("kind")
    target_agent = decision.get("targetAgent")
    if kind not in ("rerun", "handoff") or not isinstance(target_agent, str):
        raise CollaborationError(
            "decision_invalid",
            "decision requires rerun or handoff and targetAgent.",
            status=400,
        )
    if target_agent != target_assignment["executorKind"]:
        raise CollaborationError(
            "decision_invalid", "decision targetAgent does not match participant.", status=400
        )
    requested_target_id = decision.get("targetAgentId")
    if requested_target_id and requested_target_id != target_assignment["agentId"]:
        raise CollaborationError(
            "decision_invalid",
            "decision targetAgentId does not match participant.",
            status=400,
        )
    return {
        "kind": kind,
        "targetAgent": target_assignment["executorKind"],
        "targetAgentId": target_assignment["agentId"],
        **(
            {"note": decision["note"]}
            if isinstance(decision.get("note"), str) and decision["note"].strip()
            else {}
        ),
    }
