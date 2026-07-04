from __future__ import annotations

import math
import mimetypes
import os
import secrets
import shlex
from pathlib import Path
from typing import Any

from fastapi import HTTPException, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse

from ..core.models import AGENT_NAMES
from ..daemon_registry import DaemonNodeRegistry, daemon_node_token_matches, sandbox_ui_token_matches, workspace_paths_match
from ..persistence.stores import valid_agent
from ..security.auth import require_user_session

CHAT_SERVICE_EMPLOYEE_HEADER = "x-relay-employee-id"


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


def raw_string_field(value: dict[str, Any], key: str) -> str:
    field = value.get(key)
    return field if isinstance(field, str) else ""


def token_usage_field(value: dict[str, Any], key: str = "tokenUsage") -> dict[str, Any] | None:
    raw = value.get(key)
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError("tokenUsage must be an object.")
    usage = {
        "input": token_count_field(raw, "input"),
        "output": token_count_field(raw, "output"),
        "cache": token_count_field(raw, "cache"),
    }
    usage["total"] = usage["input"] + usage["output"] + usage["cache"]
    if usage["total"] == 0:
        raise ValueError("tokenUsage must include at least one reported count.")
    if "total" in raw and token_count_field(raw, "total") != usage["total"]:
        raise ValueError("tokenUsage total must equal input + output + cache.")
    if isinstance(raw.get("source"), str) and raw["source"].strip():
        usage["source"] = raw["source"].strip()
    return usage


def token_count_field(value: dict[str, Any], key: str) -> int:
    raw = value.get(key, 0)
    if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(raw) or raw < 0:
        raise ValueError(f"tokenUsage.{key} must be a non-negative finite number.")
    return int(raw)


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
        "RELAY_SANDBOX_MODE": "none",
        "RELAY_USE_LOCAL_AGENT_HOME": "1",
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
        "--sandbox",
        "none",
        "--use-local-agent-home",
    ]
    if node.get("employeeId"):
        parts.extend(["--employee-id", node["employeeId"]])
    if node.get("workspacePath"):
        parts.extend(["--workspace", node["workspacePath"]])
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


def is_workspace_artifact(artifact: dict[str, Any]) -> bool:
    return artifact.get("kind") == "workspace_file"


def workspace_artifact_key(session: dict[str, Any], artifact: dict[str, Any]) -> str:
    relative = artifact.get("workspaceRelativePath") or artifact.get("path") or artifact.get("id")
    return f"{session.get('workspacePath') or ''}::{relative}"


def workspace_artifacts(session: dict[str, Any]) -> list[dict[str, Any]]:
    """Generated-file artifacts for a session, newest record per file.

    A file re-generated by a later run gets a fresh artifact per change; the
    index and counts should surface each file once, at its latest state.
    """
    newest: dict[str, dict[str, Any]] = {}
    for artifact in session.get("artifacts", []):
        if not is_workspace_artifact(artifact):
            continue
        key = artifact.get("workspaceRelativePath") or artifact.get("path") or artifact.get("id")
        current = newest.get(key)
        if current is None or (artifact.get("createdAt") or "") >= (current.get("createdAt") or ""):
            newest[key] = artifact
    return list(newest.values())


def artifact_index_item(session: dict[str, Any], artifact: dict[str, Any]) -> dict[str, Any]:
    return {
        **artifact,
        "sessionId": session["id"],
        "sessionTitle": session.get("title"),
        "taskGoal": session.get("taskGoal"),
        "ownerEmployeeId": session.get("ownerEmployeeId"),
        "workspacePath": session.get("workspacePath"),
        "sessionUpdatedAt": session.get("updatedAt"),
    }


def request_actor(request: Request, auth_store: Any) -> dict[str, Any]:
    chat_actor = request_chat_service_actor(request)
    if chat_actor:
        return chat_actor
    user = require_user_session(request, auth_store)
    employee_id = user.get("employeeId") or user.get("username") or user["id"]
    return {
        "user": user,
        "employeeId": employee_id,
        "isAdmin": user.get("role") == "admin",
    }


def request_actor_or_none(request: Request, auth_store: Any) -> dict[str, Any] | None:
    if request.headers.get(CHAT_SERVICE_EMPLOYEE_HEADER):
        return request_chat_service_actor(request)
    try:
        return request_actor(request, auth_store)
    except HTTPException:
        return None


def request_chat_service_actor(request: Request) -> dict[str, Any] | None:
    employee_id = (request.headers.get(CHAT_SERVICE_EMPLOYEE_HEADER) or "").strip()
    if not employee_id:
        return None
    expected = os.environ.get("RELAY_CHAT_TOKEN", "").strip()
    if not expected:
        raise HTTPException(503, "RELAY_CHAT_TOKEN is not configured.")
    token = bearer_token(request)
    if not token or len(token) != len(expected) or not secrets.compare_digest(token, expected):
        raise HTTPException(401, "Invalid chat service token.")
    return {
        "user": {
            "id": f"chat:{employee_id}",
            "username": employee_id,
            "employeeId": employee_id,
            "role": "user",
        },
        "employeeId": employee_id,
        "isAdmin": False,
    }


def require_chat_service_request(request: Request) -> None:
    expected = os.environ.get("RELAY_CHAT_TOKEN", "").strip()
    if not expected:
        raise HTTPException(503, "RELAY_CHAT_TOKEN is not configured.")
    token = bearer_token(request)
    if not token or len(token) != len(expected) or not secrets.compare_digest(token, expected):
        raise HTTPException(401, "Invalid chat service token.")


def request_actor_or_sandbox(request: Request, auth_store: Any, registry: DaemonNodeRegistry) -> dict[str, Any]:
    actor = request_actor_or_none(request, auth_store)
    if actor:
        return actor
    token = bearer_token(request)
    sandbox = authorized_sandbox_for_token(registry, token)
    employee_id = sandbox.get("employeeId") if sandbox else None
    if isinstance(employee_id, str) and employee_id:
        return {
            "user": {
                "id": f"sandbox:{sandbox['id']}",
                "username": employee_id,
                "employeeId": employee_id,
                "role": "user",
            },
            "employeeId": employee_id,
            "isAdmin": False,
        }
    if token:
        raise HTTPException(401, "Invalid sandbox token.")
    return request_actor(request, auth_store)


def owner_employee_id_for_create(actor: dict[str, Any], body: dict[str, Any]) -> str:
    requested = string_field(body, "ownerEmployeeId") or string_field(body, "employeeId")
    if actor["isAdmin"] and requested:
        return requested
    return actor["employeeId"]


def assignee_employee_id_for_task(actor: dict[str, Any], body: dict[str, Any], fallback: str | None = None) -> str:
    requested = string_field(body, "assigneeEmployeeId") or string_field(body, "assignee_employee_id")
    if actor["isAdmin"] and requested:
        return requested
    if requested and requested == actor["employeeId"]:
        return requested
    return fallback or actor["employeeId"]


def actor_can_access_record(actor: dict[str, Any], record: dict[str, Any]) -> bool:
    if actor["isAdmin"]:
        return True
    return record.get("ownerEmployeeId") == actor["employeeId"] or record.get("assigneeEmployeeId") == actor["employeeId"]


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
            "mode": agent_task_mode(item.get("mode")),
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


def agent_task_mode(value: Any) -> str:
    return value if value in ("action", "review", "ask") else "action"


def authorized_sandbox_for_token(registry: DaemonNodeRegistry, token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    return next((
        sandbox for sandbox in registry.list_ready()
        if sandbox_ui_token_matches(sandbox, token) or daemon_node_token_matches(sandbox, token)
    ), None)


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
    lease_id = string_field(value, "leaseId")
    lease_field = {"leaseId": lease_id} if lease_id else {}
    if event_type == "run.output":
        if value.get("stream") not in ("stdout", "stderr") or not isinstance(value.get("sequence"), (int, float)) or not isinstance(value.get("text"), str):
            raise ValueError("invalid daemon node run.output event.")
        return {
            "type": event_type,
            "commandId": command_id,
            **lease_field,
            "sessionId": session_id,
            "runId": run_id,
            "agent": agent,
            "stream": value["stream"],
            "text": value["text"],
            "sequence": int(value["sequence"]),
        }
    mode = agent_task_mode(value.get("mode"))
    if event_type == "run.completed":
        if not isinstance(value.get("exitCode"), (int, float)):
            raise ValueError("daemon node run.completed exitCode must be a finite number.")
        token_usage = token_usage_field(value)
        # Passed through raw; the registry sanitizes each entry (path
        # confinement, extension allowlist, content caps) before indexing.
        generated_files = value.get("generatedFiles")
        return {
            "type": event_type,
            "commandId": command_id,
            **lease_field,
            "sessionId": session_id,
            "runId": run_id,
            "agent": agent,
            "mode": mode,
            "exitCode": int(value["exitCode"]),
            "agentLog": raw_string_field(value, "agentLog"),
            **({"tokenUsage": token_usage} if token_usage else {}),
            **({"generatedFiles": generated_files} if isinstance(generated_files, list) else {}),
        }
    if event_type == "run.failed":
        return {
            "type": event_type,
            "commandId": command_id,
            **lease_field,
            "sessionId": session_id,
            "runId": run_id,
            "agent": agent,
            "mode": mode,
            "error": string_field(value, "error") or "Daemon node command failed.",
            **({"agentLog": raw_string_field(value, "agentLog")} if isinstance(value.get("agentLog"), str) else {}),
            **({"exitCode": int(value["exitCode"])} if isinstance(value.get("exitCode"), (int, float)) else {}),
        }
    if event_type == "run.cancelled":
        return {
            "type": event_type,
            "commandId": command_id,
            **lease_field,
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
