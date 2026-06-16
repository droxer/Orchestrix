from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from loguru import logger

from ..daemon import provisioned_sandbox_record, public_sandbox_record, sandbox_ui_auth_error, sandbox_ui_token_matches
from ..models import SandboxRunRequest
from .deps import AppContextDep
from .helpers import actor_can_access_sandbox, bearer_token, json_body, request_actor_or_none, string_field

router = APIRouter()


@router.get("/sandboxes")
async def sandboxes(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    token = bearer_token(request)
    if token:
        allowed = [public_sandbox_record(sandbox) for sandbox in ctx.backend.list() if sandbox_ui_token_matches(sandbox, token)]
        if allowed:
            return {"sandboxes": allowed}
    actor = request_actor_or_none(request, ctx.auth_store)
    if actor:
        allowed = [public_sandbox_record(sandbox) for sandbox in ctx.backend.list() if actor_can_access_sandbox(actor, sandbox)]
    else:
        allowed = [public_sandbox_record(sandbox) for sandbox in ctx.backend.list()]
    return {"sandboxes": allowed}


@router.post("/sandboxes", status_code=201)
async def provision_sandbox(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    body = await json_body(request)
    employee_id = string_field(body, "employeeId")
    if not employee_id:
        raise HTTPException(400, "employeeId is required.")
    try:
        sandbox = ctx.backend.provision({
            "employeeId": employee_id,
            "workspacePath": string_field(body, "workspacePath") or None,
            "token": bearer_token(request),
            "nodeToken": string_field(body, "nodeToken") or None,
        })
        logger.info("Sandbox provisioned", sandbox_id=sandbox["id"], employee_id=employee_id)
        return provisioned_sandbox_record(sandbox)
    except PermissionError as error:
        logger.warning("Sandbox provisioning denied", employee_id=employee_id, error=str(error))
        raise HTTPException(401, str(error))


@router.get("/sandboxes/{sandbox_id}")
async def get_sandbox(sandbox_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    sandbox = ctx.backend.get(sandbox_id)
    if not sandbox:
        raise HTTPException(404, "Sandbox not found.")
    auth_error = sandbox_ui_auth_error(sandbox, bearer_token(request))
    if auth_error:
        raise HTTPException(401, auth_error)
    return public_sandbox_record(sandbox)


@router.post("/sandboxes/{sandbox_id}/runs", status_code=202)
async def run_sandbox(sandbox_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    sandbox = ctx.backend.get(sandbox_id)
    if not sandbox:
        raise HTTPException(404, "Sandbox not found.")
    auth_error = sandbox_ui_auth_error(sandbox, bearer_token(request))
    if auth_error:
        logger.warning("Sandbox run unauthorized", sandbox_id=sandbox_id, error=auth_error)
        raise HTTPException(401, auth_error)
    body = await json_body(request)
    try:
        parsed = SandboxRunRequest.model_validate(body).relay_dump()
    except Exception:
        raise HTTPException(400, "taskGoal and at least one assignment are required.")
    if not parsed["assignments"]:
        raise HTTPException(400, "taskGoal and at least one assignment are required.")
    logger.info("Sandbox run starting", sandbox_id=sandbox_id, session_id=parsed.get("sessionId"))
    return await ctx.backend.run(sandbox_id, parsed)


@router.post("/sandboxes/{sandbox_id}/runs/{session_id}/cancel", status_code=202)
async def cancel_sandbox_run(sandbox_id: str, session_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    sandbox = ctx.backend.get(sandbox_id)
    if not sandbox:
        raise HTTPException(404, "Sandbox not found.")
    auth_error = sandbox_ui_auth_error(sandbox, bearer_token(request))
    if auth_error:
        logger.warning("Sandbox run cancel unauthorized", sandbox_id=sandbox_id, error=auth_error)
        raise HTTPException(401, auth_error)
    body = await json_body(request)
    try:
        result = ctx.backend.cancel_run(sandbox_id, session_id, string_field(body, "reason") or "Cancelled by human.")
        logger.info("Sandbox run cancelled", sandbox_id=sandbox_id, session_id=session_id)
        return result
    except Exception as error:
        logger.warning("Sandbox run cancel failed", sandbox_id=sandbox_id, session_id=session_id, error=str(error))
        raise HTTPException(400, str(error))
