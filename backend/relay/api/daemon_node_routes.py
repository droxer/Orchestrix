from __future__ import annotations

import asyncio
import math
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from loguru import logger

from ..core.models import DaemonNodeRegistration
from ..daemon_registry import public_sandbox_record
from .deps import AppContextDep
from .helpers import actor_can_access_sandbox, authorized_sandbox_for_token, bearer_token, daemon_node_event, json_body, request_actor_or_none

router = APIRouter()

MAX_COMMAND_POLL_WAIT_SECONDS = 30.0
MAX_COMMAND_POLL_LIMIT = 50
MAX_COMMAND_LEASE_SECONDS = 60 * 60.0
MAX_ACTIVE_COMMAND_IDS = 50


def bounded_float(value: str | None, *, default: float, minimum: float, maximum: float, field: str) -> float:
    if value in (None, ""):
        return default
    try:
        parsed = float(value)
    except ValueError:
        raise HTTPException(400, f"{field} must be a number.")
    if not math.isfinite(parsed):
        raise HTTPException(400, f"{field} must be a finite number.")
    if parsed < minimum or parsed > maximum:
        raise HTTPException(400, f"{field} must be between {minimum:g} and {maximum:g}.")
    return parsed


def bounded_int(value: str | None, *, default: int, minimum: int, maximum: int, field: str) -> int:
    if value in (None, ""):
        return default
    try:
        parsed = int(value)
    except ValueError:
        raise HTTPException(400, f"{field} must be an integer.")
    if parsed < minimum or parsed > maximum:
        raise HTTPException(400, f"{field} must be between {minimum} and {maximum}.")
    return parsed


def active_command_leases(request: Request, lease_mode: str) -> list[tuple[str, str | None]]:
    leases: list[tuple[str, str | None]] = []
    if lease_mode == "explicit":
        for raw in request.query_params.getlist("activeCommandLease"):
            command_id, separator, lease_id = raw.strip().partition(":")
            if separator and command_id and lease_id and (command_id, lease_id) not in leases:
                leases.append((command_id, lease_id))
            if len(leases) >= MAX_ACTIVE_COMMAND_IDS:
                return leases
    raw_values = list(request.query_params.getlist("activeCommandId")) if lease_mode == "legacy" else []
    comma_value = request.query_params.get("activeCommandIds") if lease_mode == "legacy" else None
    if comma_value:
        raw_values.extend(comma_value.split(","))
    for raw in raw_values:
        command_id = raw.strip()
        item = (command_id, None)
        if command_id and item not in leases:
            leases.append(item)
        if len(leases) >= MAX_ACTIVE_COMMAND_IDS:
            break
    return leases


@router.get("/daemon-nodes")
async def list_daemon_nodes(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    token = bearer_token(request)
    if token:
        nodes = ctx.registry.monitor_nodes_for_token(token)
        if nodes is not None:
            return {"nodes": nodes}
    actor = request_actor_or_none(request, ctx.auth_store)
    if actor:
        nodes = [node for node in ctx.registry.monitor_nodes() if actor_can_access_sandbox(actor, node)]
    else:
        nodes = ctx.registry.monitor_nodes()
    return {"nodes": nodes}


@router.patch("/daemon-nodes/{sandbox_id}/agent-role-overrides")
async def update_daemon_node_agent_role_overrides(sandbox_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    sandbox = ctx.registry.get(sandbox_id)
    if not sandbox:
        raise HTTPException(404, "Daemon node not found.")
    token = bearer_token(request)
    authorized_sandbox = authorized_sandbox_for_token(ctx.registry, token)
    actor = None if authorized_sandbox else request_actor_or_none(request, ctx.auth_store)
    if authorized_sandbox:
        if authorized_sandbox["id"] != sandbox_id:
            raise HTTPException(403, "Daemon node access denied.")
    elif actor:
        if not actor_can_access_sandbox(actor, sandbox):
            raise HTTPException(403, "Daemon node access denied.")
    else:
        raise HTTPException(401, "Authentication required.")
    body = await json_body(request)
    raw = body.get("agentRoleOverrides")
    if not isinstance(raw, dict):
        raise HTTPException(400, "agentRoleOverrides must be an object keyed by agent name.")
    try:
        updated = ctx.registry.set_agent_role_overrides(sandbox_id, raw)
    except KeyError as error:
        raise HTTPException(404, "Daemon node not found.") from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    return {"node": next((node for node in ctx.registry.monitor_nodes() if node["id"] == sandbox_id), public_sandbox_record(updated))}


@router.post("/daemon-nodes/register")
async def register_daemon_node(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    body = await json_body(request)
    if "token" not in body and bearer_token(request):
        body["token"] = bearer_token(request)
    try:
        registration = DaemonNodeRegistration.model_validate(body).relay_dump()
        sandbox = ctx.registry.register(registration, bearer_token(request))
        logger.info(
            "Daemon node registered",
            sandbox_id=sandbox["id"],
            employee_id=sandbox.get("employeeId"),
            status=sandbox.get("status"),
        )
        return sandbox
    except PermissionError as error:
        logger.warning("Daemon node registration denied", sandbox_id=body.get("sandboxId"), error=str(error))
        raise HTTPException(401, str(error))
    except Exception as error:
        logger.warning("Daemon node registration failed", sandbox_id=body.get("sandboxId"), error=str(error))
        raise HTTPException(400, str(error))


@router.get("/daemon-nodes/{sandbox_id}/commands")
async def daemon_commands(sandbox_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    wait_seconds = bounded_float(
        request.query_params.get("waitSeconds"),
        default=0.0,
        minimum=0.0,
        maximum=MAX_COMMAND_POLL_WAIT_SECONDS,
        field="waitSeconds",
    )
    limit = bounded_int(
        request.query_params.get("limit"),
        default=10,
        minimum=1,
        maximum=MAX_COMMAND_POLL_LIMIT,
        field="limit",
    )
    lease_seconds = bounded_float(
        request.query_params.get("leaseSeconds"),
        default=60.0,
        minimum=1.0,
        maximum=MAX_COMMAND_LEASE_SECONDS,
        field="leaseSeconds",
    )
    lease_mode = request.query_params.get("leaseMode") or "legacy"
    if lease_mode not in ("explicit", "legacy"):
        raise HTTPException(400, 'leaseMode must be "explicit" or "legacy".')
    try:
        token = bearer_token(request)
        active_leases = active_command_leases(request, lease_mode)
        deadline = time.monotonic() + wait_seconds
        ctx.registry.renew_active_command_leases(sandbox_id, token, active_leases, lease_seconds=lease_seconds)
        commands = ctx.registry.take_commands(
            sandbox_id,
            token,
            limit=limit,
            lease_seconds=lease_seconds,
            renew_known_active=lease_mode == "legacy",
        )
        while not commands and time.monotonic() < deadline:
            await asyncio.sleep(min(0.25, deadline - time.monotonic()))
            ctx.registry.renew_active_command_leases(sandbox_id, token, active_leases, lease_seconds=lease_seconds)
            if ctx.registry.available_command_count(sandbox_id, token) == 0:
                continue
            commands = ctx.registry.take_commands(
                sandbox_id,
                token,
                limit=limit,
                lease_seconds=lease_seconds,
                renew_known_active=lease_mode == "legacy",
            )
        logger.debug("Daemon node commands polled", sandbox_id=sandbox_id, command_count=len(commands))
        return {"commands": commands}
    except PermissionError as error:
        logger.warning("Daemon node commands unauthorized", sandbox_id=sandbox_id, error=str(error))
        raise HTTPException(401, str(error))
    except KeyError as error:
        raise HTTPException(404, str(error))


@router.post("/daemon-nodes/{sandbox_id}/events", status_code=202)
async def daemon_events(sandbox_id: str, request: Request, ctx: AppContextDep) -> dict[str, bool]:
    try:
        event = daemon_node_event(await json_body(request))
        ctx.registry.handle_event(sandbox_id, event, bearer_token(request))
        logger.debug(
            "Daemon node event handled",
            sandbox_id=sandbox_id,
            event_type=event["type"],
            run_id=event["runId"],
        )
        return {"ok": True}
    except PermissionError as error:
        logger.warning("Daemon node event unauthorized", sandbox_id=sandbox_id, error=str(error))
        raise HTTPException(401, str(error))
    except KeyError as error:
        raise HTTPException(404, str(error))
    except Exception as error:
        logger.warning("Daemon node event rejected", sandbox_id=sandbox_id, error=str(error))
        raise HTTPException(400, str(error))
