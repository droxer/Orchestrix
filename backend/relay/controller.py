from __future__ import annotations

from typing import Any

from loguru import logger

from .ids import new_relay_id, now_iso
from .stores import LocalSessionStore, LocalTaskStore, relay_event, relay_task_event, role_for_agent


def initial_agent_state(task_goal: str) -> dict[str, Any]:
    return {
        "task_goal": task_goal,
        "agent_logs": [],
        "last_exit_code": 0,
        "agent_failures": {},
        "review_verdict": "",
        "review_feedback": "",
    }


def merge_agent_state(state: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    return {
        **state,
        **patch,
        "agent_logs": [*state.get("agent_logs", []), *patch.get("agent_logs", [])],
        "agent_failures": {**state.get("agent_failures", {}), **patch.get("agent_failures", {})},
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
        store: LocalSessionStore | None = None,
        *,
        task_store: LocalTaskStore | None = None,
        task_id: str | None = None,
        workspace_path: str = "/workspace",
        owner_employee_id: str | None = None,
    ):
        self.store = store or LocalSessionStore()
        self.task_store = task_store
        self.task_id = task_id
        self.workspace_path = workspace_path
        self.owner_employee_id = owner_employee_id
        self.active_session_id = ""

    def create_session(self, task_goal: str, participants: list[str] | None = None, pending_start: bool = False) -> dict[str, Any]:
        session = self.store.create_session({
            "workspacePath": self.workspace_path,
            **({"ownerEmployeeId": self.owner_employee_id} if self.owner_employee_id else {}),
            "taskGoal": task_goal,
            "participants": participants or ["human"],
            "status": "pending_approval" if pending_start else "running",
            **({"pendingDecision": "start"} if pending_start else {}),
        })
        self.active_session_id = session["id"]
        self._link_task_session(session["id"])
        logger.info("Session created", session_id=session["id"], workspace_path=self.workspace_path, owner=self.owner_employee_id)
        return session

    def complete_session(self, session_id: str, outcome: str) -> dict[str, Any]:
        session = self._append(session_id, relay_event("session.completed", session_id, {"outcome": outcome}))
        self._update_task_status("done", outcome, {"sessionId": session_id})
        logger.info("Session completed", session_id=session_id, outcome=outcome)
        return session

    def fail_session(self, session_id: str, outcome: str) -> dict[str, Any]:
        session = self._append(session_id, relay_event("session.failed", session_id, {"outcome": outcome}))
        self._update_task_status("blocked", outcome, {"sessionId": session_id})
        logger.info("Session failed", session_id=session_id, outcome=outcome)
        return session

    def cancel_session(self, session_id: str, note: str = "Cancelled by human.") -> dict[str, Any]:
        current = self.store.get_session(session_id)
        if current["status"] == "cancelled":
            return current
        session = self._append(session_id, relay_event("human.decision", session_id, {
            "decision": {
                "id": new_relay_id("dec"),
                "kind": "cancel",
                "createdAt": now_iso(),
                "note": note,
                **({"actorEmployeeId": self.owner_employee_id} if self.owner_employee_id else {}),
            }
        }))
        self._update_task_status("blocked", note, {"sessionId": session_id})
        logger.info("Session cancelled", session_id=session_id, note=note)
        return session

    def record_decision(self, session_id: str, kind: str, note: str | None = None, target_agent: str | None = None) -> dict[str, Any]:
        decision = {
            "id": new_relay_id("dec"),
            "kind": kind,
            "createdAt": now_iso(),
            **({"note": note} if note else {}),
            **({"targetAgent": target_agent} if target_agent else {}),
            **({"actorEmployeeId": self.owner_employee_id} if self.owner_employee_id else {}),
        }
        logger.info("Human decision recorded", session_id=session_id, kind=kind, target_agent=target_agent)
        self._append(session_id, relay_event("human.decision", session_id, {"decision": decision}))
        if kind == "approve":
            return self._append(session_id, relay_event("session.status", session_id, {"status": "running", "phase": "approved"}))
        if kind == "reject":
            return self._append(session_id, relay_event("session.status", session_id, {
                "status": "waiting_for_human",
                "phase": "feedback",
                "pendingDecision": "feedback",
            }))
        if kind == "cancel":
            return self.cancel_session(session_id, note or "Cancelled by human.")
        if kind == "mark_done":
            return self.complete_session(session_id, note or "Marked done from Relay API.")
        if kind == "rerun":
            return self._append(session_id, relay_event("session.status", session_id, {
                "status": "pending_approval",
                "phase": f"rerun:{target_agent}" if target_agent else "rerun",
                "pendingDecision": "start",
            }))
        if kind == "handoff" and target_agent:
            return self._append(session_id, relay_event("session.status", session_id, {
                "status": "running",
                "phase": f"handoff:{target_agent}",
            }))
        return self.store.get_session(session_id)

    def handoff_session(self, session_id: str, target_agent: str, assignments: list[dict[str, Any]], note: str | None = None) -> dict[str, Any]:
        self._append(session_id, relay_event("human.decision", session_id, {
            "decision": {
                "id": new_relay_id("dec"),
                "kind": "handoff",
                "createdAt": now_iso(),
                **({"note": note} if note else {}),
                "targetAgent": target_agent,
                **({"actorEmployeeId": self.owner_employee_id} if self.owner_employee_id else {}),
            }
        }))
        self.assign_session(session_id, assignments)
        logger.info("Session handoff", session_id=session_id, target_agent=target_agent)
        return self._append(session_id, relay_event("session.status", session_id, {
            "status": "pending_approval",
            "phase": f"handoff:{target_agent}",
            "pendingDecision": "start",
        }))

    def archive_session(self, session_id: str) -> dict[str, Any]:
        snapshot = self.store.get_session(session_id)
        if snapshot.get("archived"):
            return snapshot
        self._append(session_id, relay_event("session.archived", session_id, {}))
        logger.info("Session archived", session_id=session_id)
        return self.store.get_session(session_id)

    def assign_session(self, session_id: str, assignments: list[dict[str, Any]]) -> dict[str, Any]:
        snapshot = self.store.get_session(session_id)
        if snapshot.get("archived"):
            raise SessionArchivedError(session_id)
        if any(run.get("status") == "running" for run in snapshot.get("agentRuns", [])):
            raise SessionRunInFlightError(session_id)
        self.create_artifact(session_id, {
            "kind": "plan",
            "title": "Assignment plan",
            "body": __import__("json").dumps({"assignments": assignments}, indent=2),
            "extension": "json",
        })
        logger.info("Session assignments updated", session_id=session_id, assignments=[{"agent": a["agent"], "mode": a["mode"]} for a in assignments])
        return self._append(session_id, relay_event("session.status", session_id, {
            "status": "pending_approval",
            "phase": "waiting:start",
            "pendingDecision": "start",
        }))

    def create_artifact(self, session_id: str, input: dict[str, Any]) -> dict[str, Any]:
        artifact = self.store.write_artifact(session_id, input)
        self._append(session_id, relay_event("artifact.created", session_id, {"artifact": artifact}))
        logger.debug("Artifact created", session_id=session_id, artifact_id=artifact["id"], kind=input.get("kind"))
        return artifact

    def record_agent_started(self, session_id: str, step: dict[str, Any]) -> dict[str, Any]:
        self.active_session_id = session_id
        self._link_task_session(session_id)
        role = step.get("role") or role_for_agent(step["agent"], step["mode"])
        logger.info("Agent run started", session_id=session_id, run_id=step["runId"], agent=step["agent"], mode=step["mode"], role=role)
        session = self._append(session_id, relay_event("agent.started", session_id, {
            "runId": step["runId"],
            "agent": step["agent"],
            "role": role,
            "mode": step["mode"],
        }))
        self._update_task_status("review" if step["mode"] == "review" else "running", f"{step['agent']} {step['mode']} started.", {
            "agent": step["agent"],
            "sessionId": session_id,
        })
        return session

    def record_agent_output(self, session_id: str, run_id: str, agent: str, stream: str, text: str) -> None:
        self._append(session_id, relay_event("agent.output", session_id, {
            "runId": run_id,
            "agent": agent,
            "stream": stream,
            "text": text,
        }))

    def record_agent_completed(self, session_id: str, state: dict[str, Any], input: dict[str, Any]) -> dict[str, Any]:
        logger.info("Agent run completed", session_id=session_id, run_id=input["runId"], agent=input["agent"], mode=input["mode"], status=input["status"], exit_code=input["exitCode"])
        state_patch = {"agent_logs": [input.get("agentLog", "")], "last_exit_code": input["exitCode"], "token_usage": input.get("tokenUsage")}
        if is_review_assignment(input["mode"]):
            state_patch["review_verdict"] = input.get("reviewVerdict", "")
            state_patch["review_feedback"] = input.get("reviewFeedback", "")
        self.create_artifact(session_id, {
            "kind": "review" if input["mode"] == "review" else "command_log",
            "title": f"{input['agent']} {input['mode']} output",
            "body": input.get("agentLog", ""),
            "agentRunId": input["runId"],
        })
        completed_payload = {
            "runId": input["runId"],
            "agent": input["agent"],
            "status": input["status"],
            "exitCode": input["exitCode"],
        }
        if input.get("tokenUsage"):
            completed_payload["tokenUsage"] = input["tokenUsage"]
        self._append(session_id, relay_event("agent.completed", session_id, completed_payload))
        if input["status"] == "failed":
            self._update_task_status("blocked", f"{input['agent']} {input['mode']} failed with exit code {input['exitCode']}.", {
                "agent": input["agent"],
                "sessionId": session_id,
            })
        elif input["mode"] == "review":
            self._update_task_status("review", f"{input['agent']} review completed.", {"agent": input["agent"], "sessionId": session_id})
        else:
            self._update_task_status("waiting_for_human", f"{input['agent']} {input['mode']} completed.", {
                "agent": input["agent"],
                "sessionId": session_id,
            })
        if is_review_assignment(input["mode"]):
            verdict = input.get("reviewVerdict") or "failed"
            self._append(session_id, relay_event("review.verdict", session_id, {
                "runId": input["runId"],
                "agent": input["agent"],
                "verdict": verdict,
                "feedback": input.get("reviewFeedback", ""),
            }))
            if verdict == "approved":
                self._update_task_status("done", f"{input['agent']} approved the work.", {"agent": input["agent"], "sessionId": session_id})
            elif verdict == "rejected":
                self._update_task_status("blocked", f"{input['agent']} rejected the work.", {"agent": input["agent"], "sessionId": session_id})
        return merge_agent_state(state, state_patch)

    def _append(self, session_id: str, event: dict[str, Any]) -> dict[str, Any]:
        return self.store.append_event(session_id, event)

    def _link_task_session(self, session_id: str) -> None:
        if not self.task_store or not self.task_id:
            return
        task = self.task_store.get_task(self.task_id)
        if session_id not in task["linkedSessionIds"]:
            self.task_store.link_session(self.task_id, session_id)

    def _update_task_status(self, status: str, message: str, input: dict[str, Any] | None = None) -> None:
        if not self.task_store or not self.task_id:
            return
        input = input or {}
        self.task_store.append_event(self.task_id, relay_task_event("task.status", self.task_id, {"status": status}))
        self.task_store.record_activity(self.task_id, message, input)
