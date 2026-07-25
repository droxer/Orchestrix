from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import Column, Uuid

from ..core.ids import new_database_id, new_relay_id, now_iso
from ..core.models import (
    AGENT_NAMES,
    AgentName,
    TaskPriority,
    TaskRoutineCadence,
    TaskRoutineType,
    TaskStatus,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RELAY_DATA_DIR = REPO_ROOT / ".relay"


def database_id_column() -> Column[Any]:
    return Column("id", Uuid(as_uuid=False), primary_key=True, default=new_database_id)


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _format_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        # SQLite's DATETIME result has no timezone offset. Relay writes all
        # timestamps as UTC, so never reinterpret a database value in the
        # host's local timezone when formatting it back onto the wire.
        value = value.replace(tzinfo=timezone.utc)
    return (
        value.astimezone(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _write_json(path: Path, value: Any, mode: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    if mode is None:
        with tmp.open("w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2)
            handle.write("\n")
    else:
        fd = os.open(tmp, flags, mode)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2)
            handle.write("\n")
    tmp.replace(path)


def _append_jsonl(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(value, separators=(",", ":")))
        handle.write("\n")


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise KeyError(path)
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]


def relay_event(
    event_type: str, session_id: str, payload: dict[str, Any]
) -> dict[str, Any]:
    return {
        "id": new_relay_id("evt"),
        "type": event_type,
        "sessionId": session_id,
        "timestamp": now_iso(),
        **payload,
    }


def relay_task_event(
    event_type: str, task_id: str, payload: dict[str, Any]
) -> dict[str, Any]:
    return {
        "id": new_relay_id("evt"),
        "type": event_type,
        "taskId": task_id,
        "timestamp": now_iso(),
        **payload,
    }


def merge_token_usage(values: list[dict[str, Any] | None]) -> dict[str, int] | None:
    totals = {"input": 0, "output": 0, "cache": 0}
    for value in values:
        if not isinstance(value, dict):
            continue
        totals["input"] += int(value.get("input") or 0)
        totals["output"] += int(value.get("output") or 0)
        totals["cache"] += int(value.get("cache") or 0)
    if totals["input"] == 0 and totals["output"] == 0 and totals["cache"] == 0:
        return None
    return {**totals, "total": totals["input"] + totals["output"] + totals["cache"]}


def materialize_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    created = next(
        (event for event in events if event.get("type") == "session.created"), None
    )
    if not created:
        raise ValueError("Relay session event log is missing session.created.")
    session: dict[str, Any] = {
        "id": created["sessionId"],
        "workspacePath": created["workspacePath"],
        "taskGoal": created["taskGoal"],
        "participants": created.get("participants", ["human"]),
        "status": "running",
        "phase": "created",
        "createdAt": created["timestamp"],
        "updatedAt": created["timestamp"],
        "agentRuns": [],
        "artifacts": [],
        "decisions": [],
        "events": [],
        "archived": False,
    }
    if created.get("ownerEmployeeId"):
        session["ownerEmployeeId"] = created["ownerEmployeeId"]
    if created.get("ownerAgentId"):
        session["ownerAgentId"] = created["ownerAgentId"]
    if created.get("teamId"):
        session["teamId"] = created["teamId"]
    if created.get("daemonNodeId"):
        session["daemonNodeId"] = created["daemonNodeId"]
    for event in events:
        session["events"].append(event)
        session["updatedAt"] = event["timestamp"]
        event_type = event.get("type")
        if event_type == "session.status":
            session["status"] = event["status"]
            session["phase"] = event["phase"]
            if event.get("pendingDecision"):
                session["pendingDecision"] = event["pendingDecision"]
            else:
                session.pop("pendingDecision", None)
            if event["status"] not in ("completed", "failed"):
                session.pop("finalOutcome", None)
        elif event_type == "agent.started":
            # A staged daemon command can be recovered by another backend
            # replica. Replaying its start must not duplicate the run or move a
            # terminal session back to running.
            if not any(run["id"] == event["runId"] for run in session["agentRuns"]):
                session["status"] = "running"
                session["phase"] = f"{event['agent']}:{event['mode']}"
                session["currentAgent"] = event["agent"]
                session["agentRuns"].append(
                    {
                        "id": event["runId"],
                        "agent": event["agent"],
                        **({"role": event["role"]} if event.get("role") else {}),
                        "mode": event["mode"],
                        "status": "running",
                        "startedAt": event["timestamp"],
                        "artifactIds": [],
                        **(
                            {"logicalAgentId": event["logicalAgentId"]}
                            if event.get("logicalAgentId")
                            else {}
                        ),
                        **(
                            {"placementId": event["placementId"]}
                            if event.get("placementId")
                            else {}
                        ),
                        **(
                            {"daemonNodeId": event["daemonNodeId"]}
                            if event.get("daemonNodeId")
                            else {}
                        ),
                        **(
                            {"agentVersion": event["agentVersion"]}
                            if event.get("agentVersion")
                            else {}
                        ),
                        **(
                            {"workspaceIdentity": event["workspaceIdentity"]}
                            if event.get("workspaceIdentity")
                            else {}
                        ),
                    }
                )
        elif event_type == "agent.completed":
            for run in session["agentRuns"]:
                if run["id"] == event["runId"]:
                    run["status"] = event["status"]
                    run["completedAt"] = event["timestamp"]
                    run["exitCode"] = event["exitCode"]
                    if "agentLog" in event:
                        run["agentLog"] = event["agentLog"]
                    if event.get("tokenUsage"):
                        run["tokenUsage"] = event["tokenUsage"]
            token_usage = merge_token_usage(
                [run.get("tokenUsage") for run in session["agentRuns"]]
            )
            if token_usage:
                session["tokenUsage"] = token_usage
            else:
                session.pop("tokenUsage", None)
            session.pop("currentAgent", None)
            session["phase"] = (
                "agent_completed"
                if event["status"] == "completed"
                else "cancelled"
                if event["status"] == "cancelled"
                else "agent_failed"
            )
        elif event_type == "artifact.created":
            artifact = event["artifact"]
            session["artifacts"].append(artifact)
            if artifact.get("agentRunId"):
                for run in session["agentRuns"]:
                    if run["id"] == artifact["agentRunId"]:
                        run.setdefault("artifactIds", []).append(artifact["id"])
        elif event_type == "human.decision":
            decision = event["decision"]
            session["decisions"].append(decision)
            if decision["kind"] == "handoff" and decision.get("targetAgent"):
                session["currentAgent"] = decision["targetAgent"]
            if decision["kind"] == "cancel":
                session["status"] = "cancelled"
                session["phase"] = "cancelled"
                session.pop("pendingDecision", None)
        elif event_type == "session.completed":
            session["status"] = "completed"
            session["phase"] = "completed"
            session["finalOutcome"] = event["outcome"]
            session.pop("currentAgent", None)
            session.pop("pendingDecision", None)
        elif event_type == "session.failed":
            session["status"] = "failed"
            session["phase"] = "failed"
            session["finalOutcome"] = event["outcome"]
            session.pop("currentAgent", None)
            session.pop("pendingDecision", None)
        elif event_type == "session.archived":
            session["archived"] = True
        elif event_type == "session.renamed":
            session["title"] = event["title"]
    return session


def materialize_task_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    created = next(
        (event for event in events if event.get("type") == "task.created"), None
    )
    if not created:
        raise ValueError("Relay task event log is missing task.created.")
    task: dict[str, Any] = {
        "id": created["taskId"],
        "title": created["title"],
        "description": created.get("description", ""),
        "priority": created.get("priority", "normal"),
        "status": "backlog",
        "isRoutine": bool(created.get("isRoutine")),
        "routineEnabled": bool(created.get("routineEnabled")),
        "linkedSessionIds": [],
        "occurrenceIds": [],
        "activity": [],
        "createdAt": created["timestamp"],
        "updatedAt": created["timestamp"],
        "events": [],
    }
    if created.get("ownerEmployeeId"):
        task["ownerEmployeeId"] = created["ownerEmployeeId"]
    if created.get("assigneeEmployeeId"):
        task["assigneeEmployeeId"] = created["assigneeEmployeeId"]
    if created.get("dueDate"):
        task["dueDate"] = created["dueDate"]
    if created.get("sourceRoutineId"):
        task["sourceRoutineId"] = created["sourceRoutineId"]
    if created.get("scheduledFor"):
        task["scheduledFor"] = created["scheduledFor"]
    _apply_task_routine_fields(task, created)
    for event in events:
        task["events"].append(event)
        task["updatedAt"] = event["timestamp"]
        event_type = event.get("type")
        if event_type == "task.updated":
            for key in (
                "title",
                "description",
                "priority",
                "assigneeEmployeeId",
                "dueDate",
            ):
                if key in event and event[key] is not None:
                    if key in ("assigneeEmployeeId", "dueDate") and event[key] == "":
                        task.pop(key, None)
                    else:
                        task[key] = event[key]
            _apply_task_routine_fields(task, event)
        elif event_type == "task.assigned":
            if event.get("teamId"):
                task["assignedTeamId"] = event["teamId"]
                task.pop("assignedAgent", None)
                task.pop("assignedAgentId", None)
            else:
                task["assignedAgent"] = event["agent"]
                if event.get("agentId"):
                    task["assignedAgentId"] = event["agentId"]
                else:
                    task.pop("assignedAgentId", None)
                task.pop("assignedTeamId", None)
        elif event_type == "task.unassigned":
            task.pop("assignedAgent", None)
            task.pop("assignedAgentId", None)
            task.pop("assignedTeamId", None)
        elif event_type == "task.dispatch_claimed":
            task["dispatchClaim"] = event["claim"]
        elif event_type == "task.dispatch_released":
            if task.get("dispatchClaim", {}).get("id") == event.get("claimId"):
                task.pop("dispatchClaim", None)
        elif event_type == "task.dispatch_outcome":
            task["dispatchOutcome"] = event["outcome"]
        elif event_type == "task.occurrence_created":
            occurrence_id = event["occurrenceId"]
            if occurrence_id not in task["occurrenceIds"]:
                task["occurrenceIds"].append(occurrence_id)
        elif event_type == "task.status":
            task["status"] = event["status"]
        elif event_type == "task.deleted":
            task["deletedAt"] = event["timestamp"]
        elif event_type == "task.session_linked":
            if event["sessionId"] not in task["linkedSessionIds"]:
                task["linkedSessionIds"].append(event["sessionId"])
        elif event_type == "task.activity":
            task["activity"].append(event["activity"])
    return task


def _apply_task_routine_fields(task: dict[str, Any], event: dict[str, Any]) -> None:
    if "isRoutine" in event and event["isRoutine"] is not None:
        task["isRoutine"] = bool(event["isRoutine"])
        if not task["isRoutine"]:
            task["routineEnabled"] = False
            task.pop("routineType", None)
            task.pop("routineCadence", None)
            task.pop("routineNextRunDate", None)
            return
    if not task.get("isRoutine"):
        return
    if "routineEnabled" in event and event["routineEnabled"] is not None:
        task["routineEnabled"] = bool(event["routineEnabled"])
    if "routineType" in event and event["routineType"] is not None:
        task["routineType"] = event["routineType"]
    if "routineCadence" in event and event["routineCadence"] is not None:
        task["routineCadence"] = event["routineCadence"]
    if "routineNextRunDate" in event and event["routineNextRunDate"] is not None:
        if event["routineNextRunDate"]:
            task["routineNextRunDate"] = event["routineNextRunDate"]
        else:
            task.pop("routineNextRunDate", None)


def daemon_event(event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": new_relay_id("devt"),
        "type": event_type,
        "timestamp": now_iso(),
        **payload,
    }


def safe_name(value: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in value)
    return safe or "relay"


def valid_agent(value: Any) -> AgentName | None:
    return value if value in AGENT_NAMES else None


def task_priority(value: Any) -> TaskPriority | None:
    return value if value in ("low", "normal", "high") else None


def task_status(value: Any) -> TaskStatus | None:
    return (
        value
        if value
        in (
            "backlog",
            "assigned",
            "running",
            "waiting_for_human",
            "review",
            "done",
            "blocked",
        )
        else None
    )


def task_routine_type(value: Any) -> TaskRoutineType | None:
    return value if value in ("task", "job") else None


def task_routine_cadence(value: Any) -> TaskRoutineCadence | None:
    return value if value in ("daily", "weekly", "monthly", "custom") else None
