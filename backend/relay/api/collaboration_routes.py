from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from ..collaboration import CollaborationConductor, CollaborationError, MessageIntent
from .deps import AppContextDep
from .helpers import json_body, request_actor, string_field

router = APIRouter()

PURPOSES = frozenset({"accomplish", "discuss", "review"})


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
    address_agent_id = string_field(body, "addressAgentId") or None
    try:
        return await CollaborationConductor(ctx).submit(
            MessageIntent(
                thread_id=thread_id,
                text=text,
                purpose=purpose,  # type: ignore[arg-type]
                address_agent_id=address_agent_id,
                idempotency_key=string_field(body, "idempotencyKey") or None,
                user_message_id=string_field(body, "userMessageId") or None,
            ),
            actor,
        )
    except CollaborationError as error:
        raise HTTPException(
            error.status, {"code": error.code, "message": str(error)}
        ) from error
