from __future__ import annotations

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
