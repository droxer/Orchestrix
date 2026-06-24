from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from sqlalchemy import Column, Uuid

from .ids import new_database_id, new_relay_id, now_iso
from .models import AGENT_NAMES, AgentName, TaskPriority, TaskStatus

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RELAY_DATA_DIR = REPO_ROOT / ".relay"


def database_id_column() -> Column[Any]:
    return Column("id", Uuid(as_uuid=False), primary_key=True, default=new_database_id)


def _parse_iso(value: str | None) -> Any:
    if not value:
        return None
    return __import__("datetime").datetime.fromisoformat(value.replace("Z", "+00:00"))


def _format_iso(value: Any) -> str | None:
    if value is None:
        return None
    return value.astimezone(__import__("datetime").timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


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
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def relay_event(event_type: str, session_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"id": new_relay_id("evt"), "type": event_type, "sessionId": session_id, "timestamp": now_iso(), **payload}


def relay_task_event(event_type: str, task_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"id": new_relay_id("evt"), "type": event_type, "taskId": task_id, "timestamp": now_iso(), **payload}


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
    created = next((event for event in events if event.get("type") == "session.created"), None)
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
            session["status"] = "running"
            session["phase"] = f"{event['agent']}:{event['mode']}"
            session["currentAgent"] = event["agent"]
            session["agentRuns"].append({
                "id": event["runId"],
                "agent": event["agent"],
                "role": event["role"],
                "mode": event["mode"],
                "status": "running",
                "startedAt": event["timestamp"],
                "artifactIds": [],
            })
        elif event_type == "agent.completed":
            for run in session["agentRuns"]:
                if run["id"] == event["runId"]:
                    run["status"] = event["status"]
                    run["completedAt"] = event["timestamp"]
                    run["exitCode"] = event["exitCode"]
                    if event.get("tokenUsage"):
                        run["tokenUsage"] = event["tokenUsage"]
            token_usage = merge_token_usage([run.get("tokenUsage") for run in session["agentRuns"]])
            if token_usage:
                session["tokenUsage"] = token_usage
            else:
                session.pop("tokenUsage", None)
            session.pop("currentAgent", None)
            session["phase"] = "agent_completed" if event["status"] == "completed" else "cancelled" if event["status"] == "cancelled" else "agent_failed"
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
        elif event_type == "review.verdict":
            session["reviewVerdict"] = event["verdict"]
            session["phase"] = f"review:{event['verdict']}"
        elif event_type == "session.completed":
            session["status"] = "completed"
            session["phase"] = "completed"
            session["finalOutcome"] = event["outcome"]
            session.pop("currentAgent", None)
        elif event_type == "session.failed":
            session["status"] = "failed"
            session["phase"] = "failed"
            session["finalOutcome"] = event["outcome"]
            session.pop("currentAgent", None)
        elif event_type == "session.archived":
            session["archived"] = True
        elif event_type == "session.renamed":
            session["title"] = event["title"]
    return session


def materialize_task_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    created = next((event for event in events if event.get("type") == "task.created"), None)
    if not created:
        raise ValueError("Relay task event log is missing task.created.")
    task: dict[str, Any] = {
        "id": created["taskId"],
        "title": created["title"],
        "description": created.get("description", ""),
        "priority": created.get("priority", "normal"),
        "status": "backlog",
        "linkedSessionIds": [],
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
    for event in events:
        task["events"].append(event)
        task["updatedAt"] = event["timestamp"]
        event_type = event.get("type")
        if event_type == "task.updated":
            for key in ("title", "description", "priority", "assigneeEmployeeId", "dueDate"):
                if key in event and event[key] is not None:
                    if key in ("assigneeEmployeeId", "dueDate") and event[key] == "":
                        task.pop(key, None)
                    else:
                        task[key] = event[key]
        elif event_type == "task.assigned":
            task["assignedAgent"] = event["agent"]
        elif event_type == "task.status":
            task["status"] = event["status"]
        elif event_type == "task.session_linked":
            if event["sessionId"] not in task["linkedSessionIds"]:
                task["linkedSessionIds"].append(event["sessionId"])
        elif event_type == "task.activity":
            task["activity"].append(event["activity"])
    return task

def daemon_event(event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"id": new_relay_id("devt"), "type": event_type, "timestamp": now_iso(), **payload}


def safe_name(value: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in value)
    return safe or "relay"


def role_for_agent(agent: str, mode: str = "action") -> str:
    if mode == "review":
        return "reviewer"
    return {"claude": "implementer", "pi": "tester", "codex": "fixer", "kimi": "implementer"}.get(agent, "implementer")


def valid_agent(value: Any) -> AgentName | None:
    return value if value in AGENT_NAMES else None


def task_priority(value: Any) -> TaskPriority | None:
    return value if value in ("low", "normal", "high") else None


def task_status(value: Any) -> TaskStatus | None:
    return value if value in ("backlog", "assigned", "running", "waiting_for_human", "review", "done", "blocked") else None
