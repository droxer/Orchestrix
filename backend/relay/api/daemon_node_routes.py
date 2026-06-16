from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from loguru import logger

from ..models import DaemonNodeRegistration
from .deps import AppContextDep
from .helpers import actor_can_access_sandbox, bearer_token, daemon_node_event, json_body, request_actor_or_none

router = APIRouter()


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
    try:
        commands = ctx.registry.take_commands(sandbox_id, bearer_token(request))
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
