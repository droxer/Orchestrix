from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from ..collaboration.models import MessageIntent, RecoveryIntent
from ..collaboration.service import CollaborationConductor, CollaborationError
from .deps import AppContextDep
from .helpers import json_body, request_actor, string_field

router = APIRouter()

PURPOSES = frozenset({"accomplish", "discuss", "review"})
RECOVERY_KINDS = frozenset({"rerun", "handoff"})
MODES = frozenset({"action", "ask", "review"})


def _address_agent_ids(body: dict[str, Any]) -> tuple[str, ...]:
    """Read the addressed agents, accepting the singular legacy field.

    `addressAgentId` is what the chat gateway still sends; it means the same
    thing as a one-element `addressAgentIds`.
    """
    raw = body.get("addressAgentIds")
    if isinstance(raw, list):
        ids = [item for item in raw if isinstance(item, str) and item]
        if len(ids) != len(raw):
            raise HTTPException(400, "addressAgentIds must be a list of agent ids.")
        return tuple(dict.fromkeys(ids))
    if raw is not None:
        raise HTTPException(400, "addressAgentIds must be a list of agent ids.")
    single = string_field(body, "addressAgentId") or None
    return (single,) if single else ()


@router.post("/threads/{thread_id}/messages", status_code=202)
async def submit_thread_message(
    thread_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    body = await json_body(request)
    text = string_field(body, "text")
    if not text:
        raise HTTPException(400, "text is required.")
    purpose = string_field(body, "intent") or "accomplish"
    if purpose not in PURPOSES:
        raise HTTPException(400, "intent must be accomplish, discuss, or review.")
    address_agent_ids = _address_agent_ids(body)
    try:
        return await CollaborationConductor(ctx).submit(
            MessageIntent(
                thread_id=thread_id,
                text=text,
                purpose=purpose,  # type: ignore[arg-type]
                address_agent_ids=address_agent_ids,
                idempotency_key=string_field(body, "idempotencyKey") or None,
                user_message_id=string_field(body, "userMessageId") or None,
            ),
            actor,
        )
    except CollaborationError as error:
        raise HTTPException(
            error.status, {"code": error.code, "message": str(error)}
        ) from error


@router.post("/threads/{thread_id}/recoveries", status_code=202)
async def request_thread_recovery(
    thread_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    body = await json_body(request)
    kind = string_field(body, "kind")
    if kind not in RECOVERY_KINDS:
        raise HTTPException(400, "kind must be rerun or handoff.")
    target_agent_id = string_field(body, "targetAgentId")
    if not target_agent_id:
        raise HTTPException(400, "targetAgentId is required.")
    mode = string_field(body, "mode") or "action"
    if mode not in MODES:
        raise HTTPException(400, "mode must be action, ask, or review.")
    try:
        return await CollaborationConductor(ctx).submit(
            RecoveryIntent(
                thread_id=thread_id,
                kind=kind,  # type: ignore[arg-type]
                target_agent_id=target_agent_id,
                mode=mode,
                note=string_field(body, "note") or None,
                idempotency_key=string_field(body, "idempotencyKey") or None,
            ),
            actor,
        )
    except CollaborationError as error:
        raise HTTPException(
            error.status, {"code": error.code, "message": str(error)}
        ) from error
