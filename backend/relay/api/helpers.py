from __future__ import annotations

import mimetypes
import os
import shlex
from pathlib import Path
from typing import Any

from fastapi import HTTPException, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse

from ..auth import require_user_session
from ..daemon import DaemonNodeRegistry, sandbox_ui_token_matches, workspace_paths_match
from ..models import AGENT_NAMES
from ..stores import valid_agent


async def json_body(request: Request) -> dict[str, Any]:
    try:
        value = await request.json()
    except Exception:
        return {}
    return value if isinstance(value, dict) else {}


def bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    parts = header.split(" ", 1)
    return parts[1] if len(parts) == 2 and parts[0].lower() == "bearer" else None


def string_field(value: dict[str, Any], key: str) -> str:
    field = value.get(key)
    return field.strip() if isinstance(field, str) else ""


def employee_record(auth_store: Any, employee_id: str) -> dict[str, Any] | None:
    if hasattr(auth_store, "list_employees"):
        for employee in auth_store.list_employees():
            if employee.get("id") == employee_id:
                return employee
    for user in auth_store.list_users():
        if user.get("employeeId") == employee_id:
            return {
                "id": employee_id,
                "displayName": user.get("displayName") or user.get("username") or employee_id,
                "email": user.get("email"),
                "createdAt": user.get("createdAt"),
                "updatedAt": user.get("createdAt"),
            }
    return None


def backend_base_url(request: Request) -> str:
    return str(request.base_url).rstrip("/")


def daemon_start_env(request: Request, node: dict[str, Any]) -> dict[str, str]:
    env = {
        "RELAY_BACKEND_URL": backend_base_url(request),
        "RELAY_SANDBOX_ID": node["id"],
    }
    if node.get("employeeId"):
        env["RELAY_EMPLOYEE_ID"] = node["employeeId"]
    if node.get("nodeToken"):
        env["RELAY_DAEMON_NODE_TOKEN"] = node["nodeToken"]
    if node.get("workspacePath"):
        env["RELAY_WORKSPACE"] = node["workspacePath"]
    return env


def daemon_start_command(request: Request, node: dict[str, Any]) -> str:
    parts = [
        "relay-daemon",
        "--backend-url",
        backend_base_url(request),
        "--sandbox-id",
        node["id"],
        "--token",
        node.get("nodeToken") or "",
    ]
    if node.get("employeeId"):
        parts[5:5] = ["--employee-id", node["employeeId"]]
    return " ".join(shlex.quote(part) for part in parts)


def get_session_or_404(store: Any, session_id: str) -> dict[str, Any]:
    try:
        return store.get_session(session_id)
    except Exception:
        raise HTTPException(404, "Session not found.")


def get_task_or_404(store: Any, task_id: str) -> dict[str, Any]:
    try:
        return store.get_task(task_id)
    except Exception:
        raise HTTPException(404, "Task not found.")


def request_actor(request: Request, auth_store: Any) -> dict[str, Any]:
    user = require_user_session(request, auth_store)
    employee_id = user.get("employeeId") or user.get("username") or user["id"]
    return {
        "user": user,
        "employeeId": employee_id,
        "isAdmin": user.get("role") == "admin",
    }


def request_actor_or_none(request: Request, auth_store: Any) -> dict[str, Any] | None:
    try:
        return request_actor(request, auth_store)
    except HTTPException:
        return None


def owner_employee_id_for_create(actor: dict[str, Any], body: dict[str, Any]) -> str:
    requested = string_field(body, "ownerEmployeeId") or string_field(body, "employeeId")
    if actor["isAdmin"] and requested:
        return requested
    return actor["employeeId"]


def actor_can_access_record(actor: dict[str, Any], record: dict[str, Any]) -> bool:
    if actor["isAdmin"]:
        return True
    return record.get("ownerEmployeeId") == actor["employeeId"]


def actor_can_access_sandbox(actor: dict[str, Any], sandbox: dict[str, Any]) -> bool:
    if actor["isAdmin"]:
        return True
    return sandbox.get("employeeId") == actor["employeeId"]


def get_session_for_actor(store: Any, session_id: str, actor: dict[str, Any]) -> dict[str, Any]:
    session = get_session_or_404(store, session_id)
    if not actor_can_access_record(actor, session):
        raise HTTPException(403, "Session access denied.")
    return session


def get_task_for_actor(store: Any, task_id: str, actor: dict[str, Any]) -> dict[str, Any]:
    task = get_task_or_404(store, task_id)
    if not actor_can_access_record(actor, task):
        raise HTTPException(403, "Task access denied.")
    return task


def assignment_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result = []
    for item in value:
        if not isinstance(item, dict):
            continue
        agent = valid_agent(item.get("agent"))
        if not agent:
            continue
        result.append({
            "agent": agent,
            "mode": "review" if item.get("mode") == "review" else "implement",
            **({"role": item["role"]} if role_name(item.get("role")) else {}),
        })
    return result


def participants_for_assignments(assignments: Any, assigned_agent: str | None) -> list[str]:
    agents = [assignment["agent"] for assignment in assignment_list(assignments)]
    if assigned_agent:
        agents.append(assigned_agent)
    return list(dict.fromkeys(["human", *agents]))


def role_name(value: Any) -> str | None:
    return value if value in ("implementer", "reviewer", "planner", "tester", "fixer") else None


def authorized_sandbox_for_token(registry: DaemonNodeRegistry, token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    return next((sandbox for sandbox in registry.list_ready() if sandbox_ui_token_matches(sandbox, token)), None)


def session_belongs_to_sandbox(session: dict[str, Any], sandbox: dict[str, Any]) -> bool:
    return not sandbox.get("workspacePath") or workspace_paths_match(session.get("workspacePath"), sandbox.get("workspacePath"))


def daemon_node_event(value: dict[str, Any]) -> dict[str, Any]:
    event_type = string_field(value, "type")
    command_id = string_field(value, "commandId")
    session_id = string_field(value, "sessionId")
    run_id = string_field(value, "runId")
    agent = valid_agent(value.get("agent"))
    if not command_id or not session_id or not run_id or not agent:
        raise ValueError("daemon node event requires commandId, sessionId, runId, and agent.")
    if event_type == "run.output":
        if value.get("stream") not in ("stdout", "stderr") or not isinstance(value.get("sequence"), (int, float)) or not isinstance(value.get("text"), str):
            raise ValueError("invalid daemon node run.output event.")
        return {
            "type": event_type,
            "commandId": command_id,
            "sessionId": session_id,
            "runId": run_id,
            "agent": agent,
            "stream": value["stream"],
            "text": value["text"],
            "sequence": int(value["sequence"]),
        }
    mode = "review" if value.get("mode") == "review" else "implement"
    if event_type == "run.completed":
        if not isinstance(value.get("exitCode"), (int, float)):
            raise ValueError("daemon node run.completed exitCode must be a finite number.")
        verdict = value.get("reviewVerdict", "")
        if verdict not in ("approved", "rejected", "failed", ""):
            raise ValueError(f"invalid reviewVerdict {verdict}.")
        return {
            "type": event_type,
            "commandId": command_id,
            "sessionId": session_id,
            "runId": run_id,
            "agent": agent,
            "mode": mode,
            "exitCode": int(value["exitCode"]),
            "agentLog": string_field(value, "agentLog"),
            "reviewVerdict": verdict,
            "reviewFeedback": string_field(value, "reviewFeedback"),
        }
    if event_type == "run.failed":
        return {
            "type": event_type,
            "commandId": command_id,
            "sessionId": session_id,
            "runId": run_id,
            "agent": agent,
            "mode": mode,
            "error": string_field(value, "error") or "Daemon node command failed.",
            **({"exitCode": int(value["exitCode"])} if isinstance(value.get("exitCode"), (int, float)) else {}),
        }
    if event_type == "run.cancelled":
        return {
            "type": event_type,
            "commandId": command_id,
            "sessionId": session_id,
            "runId": run_id,
            "agent": agent,
            "mode": mode,
            "reason": string_field(value, "reason") or "Cancelled by human.",
        }
    raise ValueError(f"unknown daemon node event type {event_type}.")


def web_ui_asset_response(asset_path: str) -> Response:
    candidates = [
        os.environ.get("RELAY_WEB_UI_DIST_DIR"),
        str(Path.cwd() / "web" / "out"),
        str(Path(__file__).resolve().parents[2] / "web" / "out"),
    ]
    dist = next((Path(path) for path in candidates if path and Path(path).is_dir()), None)
    if not dist:
        return HTMLResponse("Relay web UI has not been built. Run `npm run build -w web`.\n", status_code=404)
    requested = asset_path or "index.html"
    asset = (dist / requested).resolve()
    if not str(asset).startswith(str(dist.resolve())) or not asset.exists() or not asset.is_file():
        asset = dist / "index.html"
    if not asset.exists():
        return JSONResponse({"error": "Web UI asset not found."}, status_code=404)
    content_type = mimetypes.guess_type(asset.name)[0] or "application/octet-stream"
    return Response(asset.read_bytes(), media_type=content_type)


def agent_names_message(field: str) -> str:
    return f"{field} must be one of: {', '.join(AGENT_NAMES)}."
