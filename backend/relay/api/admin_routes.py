from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response

from ..auth import require_admin_session
from ..daemon import public_sandbox_record
from .deps import AppContextDep
from .helpers import daemon_start_command, daemon_start_env, employee_record, json_body, string_field

router = APIRouter()


@router.get("/cp/users")
async def list_users(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    return {"users": ctx.auth_store.list_users()}


@router.post("/cp/users", status_code=201)
async def create_user(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    body = await json_body(request)
    try:
        user = ctx.auth_store.create_user(
            string_field(body, "username"),
            string_field(body, "password"),
            role=string_field(body, "role") or "user",
            email=string_field(body, "email") or None,
            employee_id=string_field(body, "employeeId") or None,
            display_name=string_field(body, "displayName") or None,
            department_id=string_field(body, "departmentId") or None,
            department_name=string_field(body, "departmentName") or None,
        )
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    return {"user": user}


@router.get("/cp/departments")
async def list_departments(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    if hasattr(ctx.auth_store, "list_departments"):
        return {"departments": ctx.auth_store.list_departments()}
    return {"departments": []}


@router.post("/cp/departments", status_code=201)
async def create_department(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    if not hasattr(ctx.auth_store, "ensure_department"):
        raise HTTPException(400, "Department storage is only available with database auth storage.")
    body = await json_body(request)
    department_id = string_field(body, "id") or string_field(body, "departmentId")
    name = string_field(body, "name") or department_id
    if not department_id:
        raise HTTPException(400, "departmentId is required.")
    try:
        department = ctx.auth_store.ensure_department(
            department_id,
            name=name,
            parent_department_id=string_field(body, "parentDepartmentId") or None,
        )
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    return {"department": department}


@router.get("/cp/employees")
async def list_employees(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    if hasattr(ctx.auth_store, "list_employees"):
        return {"employees": ctx.auth_store.list_employees()}
    deleted_ids = ctx.auth_store.deleted_employee_ids() if hasattr(ctx.auth_store, "deleted_employee_ids") else set()
    employees = []
    seen = set()
    for user in ctx.auth_store.list_users():
        employee_id = user.get("employeeId")
        if not employee_id or employee_id in seen or employee_id in deleted_ids:
            continue
        seen.add(employee_id)
        employees.append({
            "id": employee_id,
            "displayName": user.get("displayName") or user.get("username") or employee_id,
            "email": user.get("email"),
            "createdAt": user.get("createdAt"),
            "updatedAt": user.get("createdAt"),
        })
    return {"employees": employees}


@router.delete("/cp/employees/{employee_id}", status_code=200)
async def soft_delete_employee(employee_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    if not hasattr(ctx.auth_store, "soft_delete_employee"):
        raise HTTPException(400, "Employee soft-delete is not supported by this auth store.")
    try:
        record = ctx.auth_store.soft_delete_employee(employee_id)
    except KeyError as error:
        raise HTTPException(404, "Employee not found.") from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    affected_nodes = ctx.registry.unassign_employee_everywhere(employee_id)
    return {"employee": record, "unassignedNodes": affected_nodes}


@router.post("/cp/employees", status_code=201)
async def create_employee(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    body = await json_body(request)
    employee_id = string_field(body, "employeeId")
    username = string_field(body, "username")
    password = string_field(body, "password")
    node_id = string_field(body, "nodeId")
    email = string_field(body, "email") or None
    display_name = string_field(body, "displayName") or username or employee_id
    if not employee_id:
        raise HTTPException(400, "employeeId is required.")
    if not username:
        raise HTTPException(400, "username is required.")
    if not password:
        raise HTTPException(400, "password is required.")
    if not node_id:
        raise HTTPException(400, "nodeId is required.")
    existing_node = ctx.registry.get(node_id)
    if not existing_node:
        raise HTTPException(404, "Daemon node not found.")
    if existing_node.get("employeeId"):
        raise HTTPException(409, "Daemon node is already assigned.")
    try:
        user = ctx.auth_store.create_user(
            username,
            password,
            role="user",
            email=email,
            employee_id=employee_id,
            display_name=display_name,
        )
    except ValueError as error:
        message = str(error)
        status = 409 if "already exists" in message else 400
        raise HTTPException(status, message) from error
    if hasattr(ctx.auth_store, "ensure_employee"):
        employee = ctx.auth_store.ensure_employee(employee_id, display_name=display_name, email=email)
    else:
        employee = {
            "id": employee_id,
            "displayName": display_name,
            "email": email,
            "createdAt": user.get("createdAt"),
            "updatedAt": user.get("createdAt"),
        }
    try:
        assigned_node = ctx.registry.assign_employee(node_id, employee_id)
    except KeyError as error:
        raise HTTPException(404, "Daemon node not found.") from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    public_node = next(
        (item for item in ctx.registry.control_panel_nodes() if item["id"] == assigned_node["id"]),
        public_sandbox_record(assigned_node),
    )
    return {"employee": employee, "user": user, "node": public_node}


@router.post("/cp/daemon-nodes/{node_id}/assign")
async def assign_control_panel_daemon_node(node_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    body = await json_body(request)
    employee_id = string_field(body, "employeeId")
    if not employee_id:
        raise HTTPException(400, "employeeId is required.")
    existing_node = ctx.registry.get(node_id)
    if not existing_node:
        raise HTTPException(404, "Daemon node not found.")
    if existing_node.get("employeeId"):
        raise HTTPException(409, "Daemon node is already assigned.")
    employee = employee_record(ctx.auth_store, employee_id)
    if not employee:
        raise HTTPException(404, "Employee not found.")
    try:
        assigned_node = ctx.registry.assign_employee(node_id, employee_id)
    except KeyError as error:
        raise HTTPException(404, "Daemon node not found.") from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    public_node = next(
        (item for item in ctx.registry.control_panel_nodes() if item["id"] == assigned_node["id"]),
        public_sandbox_record(assigned_node),
    )
    return {"employee": employee, "node": public_node}


@router.post("/cp/daemon-nodes/{node_id}/unassign")
async def unassign_control_panel_daemon_node(node_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    existing_node = ctx.registry.get(node_id)
    if not existing_node:
        raise HTTPException(404, "Daemon node not found.")
    if not existing_node.get("employeeId"):
        raise HTTPException(409, "Daemon node is not assigned.")
    try:
        updated = ctx.registry.unassign_employee(node_id)
    except KeyError as error:
        raise HTTPException(404, "Daemon node not found.") from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    public_node = next(
        (item for item in ctx.registry.control_panel_nodes() if item["id"] == updated["id"]),
        public_sandbox_record(updated),
    )
    return {"node": public_node}


@router.delete("/cp/daemon-nodes/{node_id}", status_code=204)
async def delete_control_panel_daemon_node(node_id: str, request: Request, ctx: AppContextDep) -> Response:
    require_admin_session(request, ctx.auth_store)
    if not ctx.registry.get(node_id):
        raise HTTPException(404, "Daemon node not found.")
    try:
        ctx.registry.delete(node_id)
    except KeyError as error:
        raise HTTPException(404, "Daemon node not found.") from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    return Response(status_code=204)


@router.get("/cp/daemon-nodes")
async def control_panel_nodes(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    return {"nodes": ctx.registry.control_panel_nodes()}


@router.post("/cp/daemon-nodes", status_code=201)
async def create_control_panel_daemon_node(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    body = await json_body(request)
    employee_id = string_field(body, "employeeId")
    if not employee_id:
        raise HTTPException(400, "employeeId is required.")
    if hasattr(ctx.auth_store, "ensure_employee"):
        ctx.auth_store.ensure_employee(employee_id)
    node = ctx.backend.provision_daemon_node({
        "employeeId": employee_id,
        "workspacePath": string_field(body, "workspacePath") or None,
    })
    public_node = next(
        (item for item in ctx.registry.control_panel_nodes() if item["id"] == node["id"]),
        public_sandbox_record(node),
    )
    response = {
        "node": public_node,
        "daemonEnv": daemon_start_env(request, node),
    }
    if node.get("sandboxToken"):
        response["sandboxToken"] = node["sandboxToken"]
    if node.get("nodeToken"):
        response["nodeToken"] = node["nodeToken"]
        response["daemonCommand"] = daemon_start_command(request, node)
    return response


# ── Dashboard ────────────────────────────────────────────────────────────
# Aggregated, read-only stats for the admin Dashboard view. Built on the
# existing session/task event stores — no schema changes. Token-usage stats
# (TODO: GET /cp/dashboard/tokens) will land once agent runs record token
# counts on their session events.

_DAY_WINDOW = 14


def _parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    raw = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


@router.get("/cp/dashboard/sessions")
async def dashboard_sessions(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    sessions = ctx.session_store.list_sessions()
    now = datetime.now(timezone.utc)
    window_start = (now - timedelta(days=_DAY_WINDOW - 1)).date()

    buckets: dict[str, dict[str, int]] = {
        (window_start + timedelta(days=offset)).isoformat(): {"count": 0, "completed": 0, "failed": 0}
        for offset in range(_DAY_WINDOW)
    }

    total = len(sessions)
    last_24h = 0
    last_7d = 0
    status_counts: Counter[str] = Counter()
    per_employee: Counter[str] = Counter()

    one_day = now - timedelta(hours=24)
    seven_day = now - timedelta(days=7)

    for session in sessions:
        created = _parse_timestamp(session.get("createdAt"))
        status = str(session.get("status") or "unknown")
        status_counts[status] += 1
        owner = session.get("ownerEmployeeId")
        if owner:
            per_employee[str(owner)] += 1
        if created is None:
            continue
        if created >= one_day:
            last_24h += 1
        if created >= seven_day:
            last_7d += 1
        day_key = created.date().isoformat()
        if day_key in buckets:
            bucket = buckets[day_key]
            bucket["count"] += 1
            if status == "completed":
                bucket["completed"] += 1
            elif status == "failed":
                bucket["failed"] += 1

    daily_counts = [{"date": day, **stats} for day, stats in buckets.items()]
    top_employees = [
        {"employeeId": employee_id, "sessionCount": count}
        for employee_id, count in per_employee.most_common(5)
    ]

    return {
        "total": total,
        "last24h": last_24h,
        "last7d": last_7d,
        "statusCounts": dict(status_counts),
        "dailyCounts": daily_counts,
        "topEmployees": top_employees,
    }


@router.get("/cp/dashboard/activity")
async def dashboard_activity(
    request: Request,
    ctx: AppContextDep,
    limit: int = 20,
) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    limit = max(1, min(limit, 100))

    sessions = ctx.session_store.list_sessions()
    tasks = ctx.task_store.list_tasks() if hasattr(ctx.task_store, "list_tasks") else []

    items: list[dict[str, Any]] = []

    for session in sessions:
        owner = session.get("ownerEmployeeId")
        status = session.get("status")
        created_at = session.get("createdAt")
        if created_at:
            items.append({
                "kind": "session.created",
                "timestamp": created_at,
                "sessionId": session.get("id"),
                "employeeId": owner,
                "message": session.get("taskGoal") or "Session created",
            })
        if status in {"completed", "failed"} and session.get("updatedAt"):
            items.append({
                "kind": f"session.{status}",
                "timestamp": session.get("updatedAt"),
                "sessionId": session.get("id"),
                "employeeId": owner,
                "message": session.get("taskGoal") or f"Session {status}",
            })

    for task in tasks:
        created_at = task.get("createdAt")
        if not created_at:
            continue
        items.append({
            "kind": "task.created",
            "timestamp": created_at,
            "taskId": task.get("id"),
            "employeeId": task.get("ownerEmployeeId"),
            "message": task.get("goal") or task.get("taskGoal") or "Task created",
        })

    items.sort(key=lambda item: item.get("timestamp") or "", reverse=True)
    return {"items": items[:limit]}


@router.get("/cp/dashboard/tokens")
async def dashboard_tokens(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    usage_rows = ctx.session_store.list_token_usage() if hasattr(ctx.session_store, "list_token_usage") else [
        {
            "sessionId": session.get("id"),
            "ownerEmployeeId": session.get("ownerEmployeeId"),
            "taskGoal": session.get("taskGoal"),
            "updatedAt": session.get("updatedAt"),
            **usage,
        }
        for session in ctx.session_store.list_sessions()
        for usage in [_token_usage(session.get("tokenUsage"))]
        if usage
    ]
    now = datetime.now(timezone.utc)
    window_start = (now - timedelta(days=_DAY_WINDOW - 1)).date()
    buckets: dict[str, dict[str, int]] = {
        (window_start + timedelta(days=offset)).isoformat(): {"input": 0, "output": 0, "cache": 0, "total": 0}
        for offset in range(_DAY_WINDOW)
    }
    totals = {"input": 0, "output": 0, "cache": 0, "total": 0}
    by_employee: dict[str, dict[str, Any]] = {}
    recent_sessions: list[dict[str, Any]] = []

    for row in usage_rows:
        usage = _token_usage(row)
        if not usage:
            continue
        for key in totals:
            totals[key] += usage[key]
        timestamp = _parse_timestamp(row.get("updatedAt"))
        if timestamp:
            day_key = timestamp.date().isoformat()
            if day_key in buckets:
                for key in buckets[day_key]:
                    buckets[day_key][key] += usage[key]
        employee_id = str(row.get("ownerEmployeeId") or "unassigned")
        employee = by_employee.setdefault(
            employee_id,
            {"employeeId": employee_id, "input": 0, "output": 0, "cache": 0, "total": 0, "sessionCount": 0},
        )
        for key in ("input", "output", "cache", "total"):
            employee[key] += usage[key]
        employee["sessionCount"] += 1
        recent_sessions.append({
            "sessionId": row.get("sessionId"),
            "employeeId": row.get("ownerEmployeeId"),
            "taskGoal": row.get("taskGoal"),
            "updatedAt": row.get("updatedAt"),
            **usage,
        })

    recent_sessions.sort(key=lambda item: item.get("updatedAt") or "", reverse=True)
    ranked_employees = sorted(by_employee.values(), key=lambda item: item["total"], reverse=True)
    return {
        "available": totals["total"] > 0,
        "totalInput": totals["input"],
        "totalOutput": totals["output"],
        "totalCache": totals["cache"],
        "total": totals["total"],
        "daily": [{"date": day, **stats} for day, stats in buckets.items()],
        "byEmployee": ranked_employees,
        "recentSessions": recent_sessions[:10],
    }


def _token_usage(value: Any) -> dict[str, int] | None:
    if not isinstance(value, dict):
        return None
    usage = {
        "input": int(value.get("input") or 0),
        "output": int(value.get("output") or 0),
        "cache": int(value.get("cache") or 0),
    }
    usage["total"] = usage["input"] + usage["output"] + usage["cache"]
    return usage if usage["total"] > 0 else None
