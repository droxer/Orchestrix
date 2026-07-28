from __future__ import annotations

import json
from typing import Any

from loguru import logger

from ..core.ids import new_relay_id, now_iso
from ..persistence.protocols import SessionStore, TaskStore
from ..persistence.stores import relay_event, relay_task_event


def initial_agent_state(task_goal: str) -> dict[str, Any]:
    return {
        "task_goal": task_goal,
        "agent_logs": [],
        "last_exit_code": 0,
        "agent_failures": {},
    }


def merge_agent_state(state: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    return {
        **state,
        **patch,
        "agent_logs": [*state.get("agent_logs", []), *patch.get("agent_logs", [])],
        "agent_failures": {
            **state.get("agent_failures", {}),
            **patch.get("agent_failures", {}),
        },
    }


def is_review_assignment(mode: str) -> bool:
    return mode == "review"


class SessionArchivedError(Exception):
    def __init__(self, session_id: str) -> None:
        super().__init__(f"Session {session_id} is archived.")
        self.session_id = session_id


class SessionRunInFlightError(Exception):
    def __init__(self, session_id: str) -> None:
        super().__init__(f"Session {session_id} has a run in flight.")
        self.session_id = session_id


class SessionController:
    def __init__(
        self,
        store: SessionStore,
        *,
        task_store: TaskStore | None = None,
        task_id: str | None = None,
        workspace_path: str = "/workspace",
        owner_employee_id: str | None = None,
        owner_agent_id: str | None = None,
        team_id: str | None = None,
        daemon_node_id: str | None = None,
    ):
        self.store = store
        self.task_store = task_store
        self.task_id = task_id
        self.workspace_path = workspace_path
        self.owner_employee_id = owner_employee_id
        self.owner_agent_id = owner_agent_id
        self.team_id = team_id
        self.daemon_node_id = daemon_node_id
        self.active_session_id = ""

    def create_session(
        self,
        task_goal: str,
        participants: list[str] | None = None,
        pending_start: bool = False,
    ) -> dict[str, Any]:
        session = self.store.create_session(
            {
                "workspacePath": self.workspace_path,
                **(
                    {"ownerEmployeeId": self.owner_employee_id}
                    if self.owner_employee_id
                    else {}
                ),
                **(
                    {"ownerAgentId": self.owner_agent_id} if self.owner_agent_id else {}
                ),
                **({"teamId": self.team_id} if self.team_id else {}),
                **(
                    {"daemonNodeId": self.daemon_node_id} if self.daemon_node_id else {}
                ),
                "taskGoal": task_goal,
                "participants": participants or ["human"],
                "status": "running",
            }
        )
        self.active_session_id = session["id"]
        self._link_task_session(session["id"])
        logger.info(
            "Session created",
            session_id=session["id"],
            workspace_path=self.workspace_path,
            owner=self.owner_employee_id,
        )
        return session

    def record_user_message(
        self,
        session_id: str,
        text: str,
        actor_employee_id: str | None = None,
        message_id: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"text": text}
        if actor_employee_id:
            payload["actorEmployeeId"] = actor_employee_id
        event = relay_event("user.message", session_id, payload)
        if message_id:
            event["id"] = message_id
        session = self._append(session_id, event)
        logger.info(
            "User message recorded", session_id=session_id, message_id=event["id"]
        )
        return session

    def complete_session(
        self, session_id: str, outcome: str, task_status: str = "done"
    ) -> dict[str, Any]:
        session = self._append(
            session_id,
            relay_event("session.completed", session_id, {"outcome": outcome}),
        )
        self._update_task_status(task_status, outcome, {"sessionId": session_id})
        logger.info("Session completed", session_id=session_id, outcome=outcome)
        return session

    def fail_session(self, session_id: str, outcome: str) -> dict[str, Any]:
        session = self._append(
            session_id, relay_event("session.failed", session_id, {"outcome": outcome})
        )
        self._update_task_status("blocked", outcome, {"sessionId": session_id})
        logger.info("Session failed", session_id=session_id, outcome=outcome)
        return session

    def cancel_session(
        self, session_id: str, note: str = "Cancelled by human."
    ) -> dict[str, Any]:
        current = self.store.get_session(session_id)
        if current["status"] == "cancelled":
            return current
        session = self._append(
            session_id,
            relay_event(
                "human.decision",
                session_id,
                {
                    "decision": {
                        "id": new_relay_id("dec"),
                        "kind": "cancel",
                        "createdAt": now_iso(),
                        "note": note,
                    }
                },
            ),
        )
        self._update_task_status("blocked", note, {"sessionId": session_id})
        logger.info("Session cancelled", session_id=session_id, note=note)
        return session

    def record_decision(
        self,
        session_id: str,
        kind: str,
        note: str | None = None,
        target_agent: str | None = None,
    ) -> dict[str, Any]:
        if kind == "cancel":
            return self.cancel_session(session_id, note or "Cancelled by human.")
        decision = {
            "id": new_relay_id("dec"),
            "kind": kind,
            "createdAt": now_iso(),
            **({"note": note} if note else {}),
            **({"targetAgent": target_agent} if target_agent else {}),
        }
        logger.info(
            "Human decision recorded",
            session_id=session_id,
            kind=kind,
            target_agent=target_agent,
        )
        self._append(
            session_id,
            relay_event("human.decision", session_id, {"decision": decision}),
        )
        if kind == "approve":
            return self._append(
                session_id,
                relay_event(
                    "session.status",
                    session_id,
                    {"status": "running", "phase": "approved"},
                ),
            )
        if kind == "reject":
            return self._append(
                session_id,
                relay_event(
                    "session.status",
                    session_id,
                    {
                        "status": "waiting_for_human",
                        "phase": "feedback",
                        "pendingDecision": "feedback",
                    },
                ),
            )
        if kind == "mark_done":
            return self.complete_session(
                session_id, note or "Marked done from Relay API."
            )
        if kind == "rerun":
            return self._append(
                session_id,
                relay_event(
                    "session.status",
                    session_id,
                    {
                        "status": "running",
                        "phase": f"rerun:{target_agent}" if target_agent else "rerun",
                    },
                ),
            )
        if kind == "handoff" and target_agent:
            return self._append(
                session_id,
                relay_event(
                    "session.status",
                    session_id,
                    {
                        "status": "running",
                        "phase": f"handoff:{target_agent}",
                    },
                ),
            )
        return self.store.get_session(session_id)

    def handoff_session(
        self,
        session_id: str,
        target_agent: str,
        assignments: list[dict[str, Any]],
        note: str | None = None,
        target_agent_id: str | None = None,
    ) -> dict[str, Any]:
        self._validate_assignment(session_id)
        self._append(
            session_id,
            relay_event(
                "human.decision",
                session_id,
                {
                    "decision": {
                        "id": new_relay_id("dec"),
                        "kind": "handoff",
                        "createdAt": now_iso(),
                        **({"note": note} if note else {}),
                        "targetAgent": target_agent,
                        **(
                            {"targetAgentId": target_agent_id}
                            if target_agent_id
                            else {}
                        ),
                    }
                },
            ),
        )
        self.assign_session(session_id, assignments)
        logger.info("Session handoff", session_id=session_id, target_agent=target_agent)
        return self._append(
            session_id,
            relay_event(
                "session.status",
                session_id,
                {
                    "status": "running",
                    "phase": f"handoff:{target_agent}",
                },
            ),
        )

    def archive_session(self, session_id: str) -> dict[str, Any]:
        snapshot = self.store.get_session(session_id)
        if snapshot.get("archived"):
            return snapshot
        self._append(session_id, relay_event("session.archived", session_id, {}))
        logger.info("Session archived", session_id=session_id)
        return self.store.get_session(session_id)

    def delete_session(
        self, session_id: str, snapshot: dict[str, Any] | None = None
    ) -> None:
        if snapshot is None:
            snapshot = self.store.get_session(session_id)
        if snapshot.get("status") != "cancelled" and any(
            run.get("status") == "running" for run in snapshot.get("agentRuns", [])
        ):
            raise SessionRunInFlightError(session_id)
        atomic_delete = getattr(self.store, "delete_session_with_task_unlinks", None)
        if self.task_store and atomic_delete:
            if not atomic_delete(session_id, self.task_store):
                raise SessionRunInFlightError(session_id)
            logger.info("Session deleted", session_id=session_id)
            return
        if self.task_store:
            for task in self.task_store.list_tasks():
                if session_id in task.get("linkedSessionIds", []):
                    self.task_store.unlink_session(task["id"], session_id)
        self.store.delete_session(session_id)
        logger.info("Session deleted", session_id=session_id)

    def rename_session(self, session_id: str, title: str) -> dict[str, Any]:
        snapshot = self.store.get_session(session_id)
        if snapshot.get("title") == title:
            return snapshot
        session = self._append(
            session_id, relay_event("session.renamed", session_id, {"title": title})
        )
        logger.info("Session renamed", session_id=session_id, title=title)
        return session

    def assign_session(
        self, session_id: str, assignments: list[dict[str, Any]]
    ) -> dict[str, Any]:
        self._validate_assignment(session_id)
        self.create_artifact(
            session_id,
            {
                "kind": "plan",
                "title": "Assignment plan",
                "body": json.dumps({"assignments": assignments}, indent=2),
                "extension": "json",
            },
        )
        logger.info(
            "Session assignments updated",
            session_id=session_id,
            assignments=[
                {"executorKind": a.get("executorKind") or a["agent"], "mode": a["mode"]}
                for a in assignments
            ],
        )
        return self._append(
            session_id,
            relay_event(
                "session.status",
                session_id,
                {
                    "status": "running",
                    "phase": "assigned",
                },
            ),
        )

    def _validate_assignment(self, session_id: str) -> None:
        snapshot = self.store.get_session(session_id)
        if snapshot.get("archived"):
            raise SessionArchivedError(session_id)
        if any(run.get("status") == "running" for run in snapshot.get("agentRuns", [])):
            raise SessionRunInFlightError(session_id)

    def create_artifact(
        self, session_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        if hasattr(self.store, "create_artifact"):
            artifact, _session = self.store.create_artifact(session_id, payload)
            logger.debug(
                "Artifact created",
                session_id=session_id,
                artifact_id=artifact["id"],
                kind=payload.get("kind"),
            )
            return artifact
        artifact = self.store.write_artifact(session_id, payload)
        self._append(
            session_id,
            relay_event("artifact.created", session_id, {"artifact": artifact}),
        )
        logger.debug(
            "Artifact created",
            session_id=session_id,
            artifact_id=artifact["id"],
            kind=payload.get("kind"),
        )
        return artifact

    def record_agent_started(
        self, session_id: str, step: dict[str, Any]
    ) -> dict[str, Any]:
        self.active_session_id = session_id
        self._link_task_session(session_id)
        role = step.get("role")
        logger.info(
            "Agent run started",
            session_id=session_id,
            run_id=step["runId"],
            agent=step["agent"],
            mode=step["mode"],
            role=role,
        )
        session = self._append(
            session_id,
            relay_event(
                "agent.started",
                session_id,
                {
                    "runId": step["runId"],
                    "agent": step["agent"],
                    **({"role": role} if role else {}),
                    "mode": step["mode"],
                    **(
                        {"logicalAgentId": step["logicalAgentId"]}
                        if step.get("logicalAgentId")
                        else {}
                    ),
                    **(
                        {"placementId": step["placementId"]}
                        if step.get("placementId")
                        else {}
                    ),
                    **(
                        {"daemonNodeId": step["daemonNodeId"]}
                        if step.get("daemonNodeId")
                        else {}
                    ),
                    **(
                        {"agentVersion": step["agentVersion"]}
                        if step.get("agentVersion") is not None
                        else {}
                    ),
                    **(
                        {"workspaceIdentity": step["workspaceIdentity"]}
                        if step.get("workspaceIdentity")
                        else {}
                    ),
                },
            ),
        )
        self._update_task_status(
            "review" if step["mode"] == "review" else "running",
            f"{step['agent']} {step['mode']} started.",
            {
                "agent": step["agent"],
                "sessionId": session_id,
            },
        )
        return session

    def record_agent_output(
        self, session_id: str, run_id: str, agent: str, stream: str, text: str
    ) -> None:
        self._append(
            session_id,
            relay_event(
                "agent.output",
                session_id,
                {
                    "runId": run_id,
                    "agent": agent,
                    "stream": stream,
                    "text": text,
                },
            ),
        )

    def record_agent_completed(
        self, session_id: str, state: dict[str, Any], step_result: dict[str, Any]
    ) -> dict[str, Any]:
        logger.info(
            "Agent run completed",
            session_id=session_id,
            run_id=step_result["runId"],
            agent=step_result["agent"],
            mode=step_result["mode"],
            status=step_result["status"],
            exit_code=step_result["exitCode"],
        )
        state_patch = {
            "agent_logs": [step_result.get("agentLog", "")],
            "last_exit_code": step_result["exitCode"],
            "token_usage": step_result.get("tokenUsage"),
        }
        completed_payload = {
            "runId": step_result["runId"],
            "agent": step_result["agent"],
            "status": step_result["status"],
            "exitCode": step_result["exitCode"],
            "agentLog": step_result.get("agentLog", ""),
        }
        if step_result.get("tokenUsage"):
            completed_payload["tokenUsage"] = step_result["tokenUsage"]
        self._append(
            session_id, relay_event("agent.completed", session_id, completed_payload)
        )
        if step_result["status"] == "failed":
            self._update_task_status(
                "blocked",
                f"{step_result['agent']} {step_result['mode']} failed with exit code {step_result['exitCode']}.",
                {
                    "agent": step_result["agent"],
                    "sessionId": session_id,
                },
            )
        elif step_result.get("pipelineHasNext"):
            # Another assignment follows immediately; keep the task running
            # instead of flapping through waiting_for_human/review between steps.
            self._update_task_status(
                "running",
                f"{step_result['agent']} {step_result['mode']} completed.",
                {
                    "agent": step_result["agent"],
                    "sessionId": session_id,
                },
            )
        elif step_result["mode"] == "review":
            self._update_task_status(
                "review",
                f"{step_result['agent']} review completed.",
                {"agent": step_result["agent"], "sessionId": session_id},
            )
        else:
            self._update_task_status(
                "waiting_for_human",
                f"{step_result['agent']} {step_result['mode']} completed.",
                {
                    "agent": step_result["agent"],
                    "sessionId": session_id,
                },
            )
        return merge_agent_state(state, state_patch)

    def _append(self, session_id: str, event: dict[str, Any]) -> dict[str, Any]:
        return self.store.append_event(session_id, event)

    def _link_task_session(self, session_id: str) -> None:
        if not self.task_store or not self.task_id:
            return
        task = self.task_store.get_task(self.task_id)
        if session_id not in task["linkedSessionIds"]:
            self.task_store.link_session(self.task_id, session_id)

    def _update_task_status(
        self, status: str, message: str, extras: dict[str, Any] | None = None
    ) -> None:
        if not self.task_store or not self.task_id:
            return
        extras = extras or {}
        self.task_store.append_event(
            self.task_id,
            relay_task_event("task.status", self.task_id, {"status": status}),
        )
        self.task_store.record_activity(self.task_id, message, extras)
