from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from .deps import AppContextDep
from .helpers import json_body, require_chat_service_request

router = APIRouter()


@router.post("/chat/identity/resolve")
async def resolve_chat_identity(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_chat_service_request(request)
    body = await json_body(request)
    try:
        identity = ctx.chat_store.resolve_identity(body)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    if not identity:
        raise HTTPException(404, "No active chat identity link is available for this conversation.")
    return {"identity": identity}
