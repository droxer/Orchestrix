from __future__ import annotations

import asyncio
import secrets
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response

from ..core.models import AGENT_NAMES
from ..daemon_registry import public_sandbox_record
from ..security.auth import require_admin_session
from ..services.computer_names import normalize_computer_display_name, present_computer
from ..services.node_agents import (
    assert_node_agent_runs_drained,
    remove_node_agents,
    sync_node_agents,
)
from ..services.team_membership import remove_agent_from_teams
from .deps import AppContextDep
from .helpers import (
    daemon_start_command,
    daemon_start_env,
    employee_record,
    json_body,
    string_field,
    valid_employee_workspace_path,
)

router = APIRouter()


def _with_node_display_name(ctx: AppContextDep, node: dict[str, Any]) -> dict[str, Any]:
    return present_computer(ctx, node)


def _public_control_panel_node(ctx: AppContextDep, node: dict[str, Any]) -> dict[str, Any]:
    public_node = next(
        (item for item in ctx.registry.control_panel_nodes() if item["id"] == node["id"]),
        public_sandbox_record(node),
    )
    return _with_node_display_name(ctx, public_node)


def _managed_node_placeholder(node: dict[str, Any]) -> dict[str, Any]:
    desired_state = node.get("desiredState")
    phase = node.get("phase")
    status = (
        "stopped"
        if desired_state != "running"
        else "failed"
        if phase in ("ready", "failed")
        else "provisioning"
    )
    conditions = node.get("conditions") or []
    last_error = conditions[-1].get("message") if conditions else None
    return {
        "id": node["id"],
        "managedNodeId": node["id"],
        "displayName": node.get("displayName") or node["id"],
        **({"employeeId": node["employeeId"]} if node.get("employeeId") else {}),
        "sandboxMode": node.get("sandboxMode") or "boxlite",
        "nodeLocation": "managed",
        "status": status,
        "agents": {agent: "unknown" for agent in AGENT_NAMES},
        "createdAt": node["createdAt"],
        "updatedAt": node["updatedAt"],
        "queuedCommandCount": 0,
        "activeRuns": [],
        "online": False,
        "stale": True,
        "provisioningPlaceholder": True,
        **({"lastError": last_error} if last_error else {}),
    }


@router.get("/admin/users")
async def list_users(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    return {"users": ctx.auth_store.list_users()}


@router.post("/admin/users", status_code=201)
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


@router.get("/admin/departments")
async def list_departments(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    if hasattr(ctx.auth_store, "list_departments"):
        return {"departments": ctx.auth_store.list_departments()}
    return {"departments": []}


@router.post("/admin/departments", status_code=201)
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


@router.get("/admin/employees")
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


@router.delete("/admin/employees/{employee_id}", status_code=200)
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
    removed_placements: list[str] = []
    deleted_agents: list[str] = []
    for agent in ctx.agent_store.list_agents(supervisor_employee_id=employee_id):
        for placement in ctx.agent_placement_store.list_placements(agent_id=agent["id"]):
            removed = ctx.agent_placement_store.update_placement(
                placement["id"], {"desiredState": "removed"}
            )
            removed_placements.append(removed["id"])
        deleted = ctx.agent_store.delete_agent(agent["id"])
        remove_agent_from_teams(ctx.team_store, agent["id"], employee_id)
        deleted_agents.append(deleted["id"])
    deleted_managed_nodes: list[str] = []
    for node in ctx.managed_node_store.list_nodes():
        if node.get("employeeId") != employee_id:
            continue
        deleted = ctx.managed_node_store.update_node(
            node["id"], {"desiredState": "deleted"}
        )
        daemon_node_id = deleted.get("activeDaemonNodeId")
        if daemon_node_id and ctx.registry.get(daemon_node_id):
            ctx.registry.fence_managed_node(daemon_node_id)
        deleted_managed_nodes.append(deleted["id"])
    return {
        "employee": record,
        "unassignedNodes": affected_nodes,
        "deletedAgents": deleted_agents,
        "removedPlacements": removed_placements,
        "deletedManagedNodes": deleted_managed_nodes,
    }


@router.post("/admin/employees", status_code=201)
async def create_employee(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    body = await json_body(request)
    employee_id = string_field(body, "employeeId")
    username = string_field(body, "username")
    password = string_field(body, "password")
    node_id = string_field(body, "nodeId") or None
    email = string_field(body, "email") or None
    display_name = string_field(body, "displayName") or username or employee_id
    if not employee_id:
        raise HTTPException(400, "employeeId is required.")
    if not username:
        raise HTTPException(400, "username is required.")
    if not password:
        raise HTTPException(400, "password is required.")
    # Node assignment is optional at onboarding — an employee may be created
    # first and bound to a sandbox later via the assign-node flow. Only validate
    # the node when one was supplied.
    if node_id:
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
        employee = ctx.auth_store.ensure_employee(
            user.get("employeeId") or employee_id, display_name=display_name, email=email
        )
    else:
        employee = {
            "id": employee_id,
            "displayName": display_name,
            "email": email,
            "createdAt": user.get("createdAt"),
            "updatedAt": user.get("createdAt"),
        }
    public_node: dict[str, Any] | None = None
    if node_id:
        try:
            assigned_node = ctx.registry.assign_employee(node_id, employee["id"])
            sync_node_agents(ctx, assigned_node)
        except KeyError as error:
            raise HTTPException(404, "Daemon node not found.") from error
        except ValueError as error:
            raise HTTPException(409, str(error)) from error
        public_node = _public_control_panel_node(ctx, assigned_node)
    return {"employee": employee, "user": user, **({"node": public_node} if public_node else {})}


@router.put("/admin/daemon-nodes/{node_id}/assignment")
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
        sync_node_agents(ctx, assigned_node)
    except KeyError as error:
        raise HTTPException(404, "Daemon node not found.") from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    public_node = _public_control_panel_node(ctx, assigned_node)
    return {"employee": employee, "node": public_node}


@router.delete("/admin/daemon-nodes/{node_id}/assignment")
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
    for placement in ctx.agent_placement_store.list_placements(daemon_node_id=node_id):
        if placement.get("desiredState") != "removed":
            ctx.agent_placement_store.update_placement(placement["id"], {"desiredState": "removed"})
    public_node = _public_control_panel_node(ctx, updated)
    return {"node": public_node}


@router.patch("/admin/daemon-nodes/{node_id}/disabled-agents")
async def update_control_panel_daemon_node_disabled_agents(node_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    body = await json_body(request)
    raw = body.get("disabledAgents")
    if not isinstance(raw, list) or not all(isinstance(name, str) for name in raw):
        raise HTTPException(400, "disabledAgents must be an array of agent names.")
    if not ctx.registry.get(node_id):
        raise HTTPException(404, "Daemon node not found.")
    try:
        updated = ctx.registry.set_disabled_agents(node_id, raw)
    except KeyError as error:
        raise HTTPException(404, "Daemon node not found.") from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    public_node = _public_control_panel_node(ctx, updated)
    return {"node": public_node}


@router.patch("/admin/daemon-nodes/{node_id}/agent-role-defaults")
async def update_control_panel_daemon_node_agent_role_defaults(node_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    body = await json_body(request)
    raw = body.get("agentRoleDefaults")
    if not isinstance(raw, dict):
        raise HTTPException(400, "agentRoleDefaults must be an object keyed by agent name.")
    if not ctx.registry.get(node_id):
        raise HTTPException(404, "Daemon node not found.")
    try:
        updated = ctx.registry.set_agent_role_defaults(node_id, raw)
    except KeyError as error:
        raise HTTPException(404, "Daemon node not found.") from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    public_node = _public_control_panel_node(ctx, updated)
    return {"node": public_node}


@router.delete("/admin/daemon-nodes/{node_id}", status_code=204)
async def delete_control_panel_daemon_node(node_id: str, request: Request, ctx: AppContextDep) -> Response:
    require_admin_session(request, ctx.auth_store)
    try:
        with ctx.registry.dispatch_lock:
            node = ctx.registry.get(node_id)
            if not node:
                raise KeyError(node_id)
            assert_node_agent_runs_drained(ctx, node_id)
            if node.get("managedNodeId"):
                ctx.managed_node_store.update_node(
                    node["managedNodeId"], {"desiredState": "deleted"}
                )
                ctx.registry.fence_managed_node(node_id)
            else:
                ctx.registry.delete(node_id)
            remove_node_agents(ctx, node_id)
    except KeyError as error:
        raise HTTPException(404, "Daemon node not found.") from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    return Response(status_code=204)


@router.get("/admin/daemon-nodes")
async def control_panel_nodes(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    observed = []
    for node in ctx.registry.control_panel_nodes():
        managed_node = (
            ctx.managed_node_store.get_node(node["managedNodeId"])
            if node.get("managedNodeId")
            else None
        )
        if managed_node and managed_node.get("desiredState") == "deleted":
            continue
        observed.append(_with_node_display_name(ctx, node))
    observed_managed_ids = {
        node["managedNodeId"] for node in observed if node.get("managedNodeId")
    }
    pending = [
        _managed_node_placeholder(node)
        for node in ctx.managed_node_store.list_nodes()
        if node["id"] not in observed_managed_ids
    ]
    return {"nodes": [*observed, *pending]}


@router.post("/admin/daemon-nodes", status_code=201)
async def create_control_panel_daemon_node(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    body = await json_body(request)
    employee_id = string_field(body, "employeeId") or None
    sandbox_mode = string_field(body, "sandboxMode") or "boxlite"
    requested_location = string_field(body, "nodeLocation") or None
    if sandbox_mode not in ("boxlite", "none"):
        raise HTTPException(400, 'sandboxMode must be "boxlite" or "none".')
    workspace_path = string_field(body, "workspacePath") or None
    try:
        display_name = normalize_computer_display_name(body.get("displayName"))
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    if requested_location not in (None, "employee-device"):
        raise HTTPException(400, 'nodeLocation must be "employee-device".')
    if requested_location == "employee-device" and not valid_employee_workspace_path(workspace_path):
        raise HTTPException(
            400, "An absolute workspacePath on the employee device is required."
        )
    if hasattr(ctx.auth_store, "ensure_employee"):
        if employee_id:
            ctx.auth_store.ensure_employee(employee_id)
    node = ctx.backend.provision_daemon_node({
        **({"employeeId": employee_id} if employee_id else {}),
        **({"displayName": display_name} if display_name else {}),
        "workspacePath": workspace_path,
        "sandboxMode": sandbox_mode,
        **({"nodeLocation": "employee-device"} if requested_location else {}),
    })
    effective_sandbox_mode = node.get("sandboxMode") if node.get("sandboxMode") in ("boxlite", "none") else sandbox_mode
    public_node = _public_control_panel_node(ctx, node)
    response = {
        "node": public_node,
        "daemonEnv": daemon_start_env(request, node, effective_sandbox_mode),
    }
    if node.get("sandboxToken"):
        response["sandboxToken"] = node["sandboxToken"]
    if node.get("nodeToken"):
        response["nodeToken"] = node["nodeToken"]
        response["daemonCommand"] = daemon_start_command(request, node, effective_sandbox_mode)
    return response


# ── Chat integrations ───────────────────────────────────────────────────

def _actor_name(user: dict[str, Any]) -> str:
    return str(user.get("username") or user.get("id") or "admin")


def _chat_error(error: Exception) -> HTTPException:
    if isinstance(error, KeyError):
        return HTTPException(404, "Chat integration record not found.")
    if isinstance(error, ValueError):
        return HTTPException(400, str(error))
    return HTTPException(500, "Chat integration operation failed.")


@router.get("/admin/chat-integrations")
async def list_chat_integrations(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    return {"integrations": ctx.chat_store.list_integrations()}


@router.post("/admin/chat-integrations", status_code=201)
async def create_chat_integration(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    user = require_admin_session(request, ctx.auth_store)
    body = await json_body(request)
    try:
        integration = ctx.chat_store.create_integration(body, actor=_actor_name(user))
    except (KeyError, ValueError) as error:
        raise _chat_error(error) from error
    return {"integration": integration}


@router.get("/admin/chat-integrations/{integration_id}")
async def get_chat_integration(integration_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    try:
        integration = ctx.chat_store.get_integration(integration_id)
    except (KeyError, ValueError) as error:
        raise _chat_error(error) from error
    return {"integration": integration}


@router.patch("/admin/chat-integrations/{integration_id}")
async def update_chat_integration(integration_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    user = require_admin_session(request, ctx.auth_store)
    body = await json_body(request)
    try:
        integration = ctx.chat_store.update_integration(integration_id, body, actor=_actor_name(user))
    except (KeyError, ValueError) as error:
        raise _chat_error(error) from error
    return {"integration": integration}


@router.post("/admin/chat-integrations/{integration_id}/activations")
async def activate_chat_integration(integration_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    user = require_admin_session(request, ctx.auth_store)
    try:
        ctx.chat_store.validate_activation(integration_id)
        settings = ctx.chat_store.connection_settings(integration_id)
        if settings.get("provider") == "telegram":
            provisioned, message = await request.app.state.chat_provision(settings, integration_id)
            if not provisioned:
                raise ValueError(message)
        else:
            message = "Integration activated."
        integration = ctx.chat_store.activate_integration(integration_id, actor=_actor_name(user))
    except (KeyError, ValueError) as error:
        raise _chat_error(error) from error
    return {"integration": integration, "provisioning": {"ok": True, "message": message}}


@router.post("/admin/chat-integrations/{integration_id}/health-checks")
async def check_chat_integration(integration_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    user = require_admin_session(request, ctx.auth_store)
    try:
        settings = ctx.chat_store.connection_settings(integration_id)
        provider_health = await request.app.state.chat_probe(settings)
        integration = ctx.chat_store.check_integration(
            integration_id,
            actor=_actor_name(user),
            provider_health=provider_health,
        )
    except (KeyError, ValueError) as error:
        raise _chat_error(error) from error
    return {"integration": integration}


@router.post("/admin/chat-integrations/{integration_id}/webhook-secret-rotations")
async def rotate_telegram_webhook_secret(
    integration_id: str,
    request: Request,
    ctx: AppContextDep,
) -> dict[str, Any]:
    user = require_admin_session(request, ctx.auth_store)
    locks = request.app.state.chat_rotation_locks
    lock = locks.setdefault(integration_id, asyncio.Lock())
    async with lock:
        return await _rotate_telegram_webhook_secret(integration_id, request, ctx, user)


async def _rotate_telegram_webhook_secret(
    integration_id: str,
    request: Request,
    ctx: AppContextDep,
    user: dict[str, Any],
) -> dict[str, Any]:
    try:
        ctx.chat_store.validate_telegram_webhook_rotation(integration_id)
        previous_settings = ctx.chat_store.connection_settings(integration_id)
        previous_secret = previous_settings.get("secrets", {}).get("webhookSecret")
        webhook_secret = secrets.token_urlsafe(32)
        integration = ctx.chat_store.set_telegram_webhook_secret(
            integration_id,
            webhook_secret,
            actor=_actor_name(user),
        )
        settings = ctx.chat_store.connection_settings(integration_id)
        provisioned, message = await request.app.state.chat_provision(settings, integration_id)
        if not provisioned:
            if isinstance(previous_secret, str) and previous_secret:
                restored, restore_message = await request.app.state.chat_provision(previous_settings, integration_id)
                if restored:
                    ctx.chat_store.set_telegram_webhook_secret(integration_id, previous_secret, actor=_actor_name(user))
                else:
                    raise ValueError(
                        f"{message} The previous webhook could not be restored ({restore_message}); "
                        "Relay retained the new secret to avoid rejecting a webhook that Telegram may have accepted."
                    )
            raise ValueError(message)
    except (KeyError, ValueError) as error:
        raise _chat_error(error) from error
    return {"integration": integration, "provisioning": {"ok": True, "message": message}}


@router.post("/admin/chat-integrations/{integration_id}/identity-links", status_code=201)
async def add_chat_identity_link(integration_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    user = require_admin_session(request, ctx.auth_store)
    body = await json_body(request)
    employee_id = string_field(body, "employeeId")
    default_agent_id = string_field(body, "defaultAgentId")
    if not employee_record(ctx.auth_store, employee_id):
        raise HTTPException(404, "Employee not found.")
    if default_agent_id:
        agent = ctx.agent_store.get_agent(default_agent_id)
        if (
            not agent
            or agent.get("deletedAt")
            or not agent.get("enabled", True)
            or agent.get("supervisorEmployeeId") != employee_id
        ):
            raise HTTPException(
                400, "defaultAgentId must reference an enabled agent owned by the linked employee."
            )
    try:
        integration = ctx.chat_store.add_identity_link(integration_id, body, actor=_actor_name(user))
    except (KeyError, ValueError) as error:
        raise _chat_error(error) from error
    return {"integration": integration}


@router.delete("/admin/chat-integrations/{integration_id}/identity-links/{link_id}")
async def delete_chat_identity_link(integration_id: str, link_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    user = require_admin_session(request, ctx.auth_store)
    try:
        integration = ctx.chat_store.delete_identity_link(integration_id, link_id, actor=_actor_name(user))
    except (KeyError, ValueError) as error:
        raise _chat_error(error) from error
    return {"integration": integration}


@router.post("/admin/chat-integrations/{integration_id}/allowed-conversations", status_code=201)
async def add_chat_allowed_conversation(integration_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    user = require_admin_session(request, ctx.auth_store)
    body = await json_body(request)
    try:
        integration = ctx.chat_store.add_allowed_conversation(integration_id, body, actor=_actor_name(user))
    except (KeyError, ValueError) as error:
        raise _chat_error(error) from error
    return {"integration": integration}


@router.delete("/admin/chat-integrations/{integration_id}/allowed-conversations/{conversation_record_id}")
async def delete_chat_allowed_conversation(
    integration_id: str,
    conversation_record_id: str,
    request: Request,
    ctx: AppContextDep,
) -> dict[str, Any]:
    user = require_admin_session(request, ctx.auth_store)
    try:
        integration = ctx.chat_store.delete_allowed_conversation(integration_id, conversation_record_id, actor=_actor_name(user))
    except (KeyError, ValueError) as error:
        raise _chat_error(error) from error
    return {"integration": integration}


@router.get("/admin/chat-integrations/{integration_id}/audit")
async def list_chat_integration_audit(integration_id: str, request: Request, ctx: AppContextDep, limit: int = 50) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    try:
        ctx.chat_store.get_integration(integration_id)
    except (KeyError, ValueError) as error:
        raise _chat_error(error) from error
    return {"events": ctx.chat_store.audit_events(integration_id, limit=limit)}


# ── Dashboard ────────────────────────────────────────────────────────────
# Aggregated, read-only stats for the admin Dashboard view. Built on the
# existing session/task event stores — no schema changes. Token-usage stats
# (TODO: GET /api/v1/admin/dashboard/tokens) will land once agent runs record token
# counts on their session events.

_DAY_WINDOW = 14
_TOKEN_USAGE_UNSUPPORTED_AGENTS = ("kimi",)


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


@router.get("/admin/dashboard/sessions")
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


@router.get("/admin/dashboard/activity")
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


@router.get("/admin/dashboard/tokens")
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
    summary_start = (now - timedelta(days=6)).date()
    buckets: dict[str, dict[str, int]] = {
        (window_start + timedelta(days=offset)).isoformat(): {"input": 0, "output": 0, "cache": 0, "total": 0}
        for offset in range(_DAY_WINDOW)
    }
    totals = {"input": 0, "output": 0, "cache": 0, "total": 0}
    by_employee: dict[str, dict[str, Any]] = {}
    employee_sessions: dict[str, set[str]] = {}
    recent_by_session: dict[str, dict[str, Any]] = {}

    for row in usage_rows:
        usage = _token_usage(row)
        if not usage:
            continue
        usage_timestamp = row.get("completedAt") or row.get("updatedAt")
        timestamp = _parse_timestamp(usage_timestamp)
        in_summary_window = False
        if timestamp:
            day_key = timestamp.date().isoformat()
            if day_key in buckets:
                for key in buckets[day_key]:
                    buckets[day_key][key] += usage[key]
            in_summary_window = timestamp.date() >= summary_start
        if in_summary_window:
            for key in totals:
                totals[key] += usage[key]
            employee_id = str(row.get("ownerEmployeeId") or "unassigned")
            employee = by_employee.setdefault(
                employee_id,
                {"employeeId": employee_id, "input": 0, "output": 0, "cache": 0, "total": 0, "sessionCount": 0},
            )
            for key in ("input", "output", "cache", "total"):
                employee[key] += usage[key]
            session_id = str(row.get("sessionId") or "")
            if session_id:
                employee_sessions.setdefault(employee_id, set()).add(session_id)
        session_id = str(row.get("sessionId") or row.get("runId") or "unknown")
        recent = recent_by_session.setdefault(session_id, {
            "sessionId": row.get("sessionId"),
            "employeeId": row.get("ownerEmployeeId"),
            "taskGoal": row.get("taskGoal"),
            "updatedAt": usage_timestamp,
            "input": 0,
            "output": 0,
            "cache": 0,
            "total": 0,
        })
        for key in ("input", "output", "cache", "total"):
            recent[key] += usage[key]
        if str(usage_timestamp or "") > str(recent.get("updatedAt") or ""):
            recent["updatedAt"] = usage_timestamp

    for employee_id, employee in by_employee.items():
        employee["sessionCount"] = len(employee_sessions.get(employee_id, set()))
    recent_sessions = list(recent_by_session.values())
    recent_sessions.sort(key=lambda item: item.get("updatedAt") or "", reverse=True)
    ranked_employees = sorted(by_employee.values(), key=lambda item: item["total"], reverse=True)
    return {
        "available": totals["total"] > 0,
        "totalInput": totals["input"],
        "totalOutput": totals["output"],
        "totalCache": totals["cache"],
        "total": totals["total"],
        "unsupportedAgents": list(_TOKEN_USAGE_UNSUPPORTED_AGENTS),
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
