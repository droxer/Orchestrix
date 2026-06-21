from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from .deps import AppContextDep
from .helpers import json_body, require_chat_service_request, string_field

router = APIRouter()


def _resolve_owner(ctx: AppContextDep, body: dict[str, Any]) -> dict[str, Any]:
    """Resolve the chat identity (and thus the owning employee) or raise."""
    try:
        identity = ctx.chat_store.resolve_identity(body)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    if not identity:
        raise HTTPException(404, "No active chat identity link is available for this conversation.")
    return identity


def _owned_by(session: dict[str, Any], employee_id: str) -> bool:
    owner = session.get("ownerEmployeeId")
    # Ownerless legacy sessions stay accessible; otherwise the owner must match.
    return owner is None or owner == employee_id


@router.post("/chat/identity/resolve")
async def resolve_chat_identity(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_chat_service_request(request)
    body = await json_body(request)
    return {"identity": _resolve_owner(ctx, body)}


@router.post("/chat/conversation/session")
async def chat_conversation_session(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    """Resolve the live session a chat thread is currently bound to, if any."""
    require_chat_service_request(request)
    body = await json_body(request)
    identity = _resolve_owner(ctx, body)
    record = ctx.chat_store.get_conversation_session(body)
    if not record or not record.get("sessionId"):
        return {"session": None}
    try:
        session = ctx.session_store.get_session(record["sessionId"])
    except KeyError:
        return {"session": None}
    # Never surface another employee's session, or a closed (archived) one.
    if not _owned_by(session, identity["employeeId"]) or session.get("archived"):
        return {"session": None}
    return {"session": session}


@router.post("/chat/conversation/sessions")
async def chat_conversation_sessions(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    """List the owning employee's open conversations for switch/list commands."""
    require_chat_service_request(request)
    body = await json_body(request)
    identity = _resolve_owner(ctx, body)
    sessions = [
        session
        for session in ctx.session_store.list_sessions()
        if not session.get("archived") and session.get("ownerEmployeeId") == identity["employeeId"]
    ]
    return {"sessions": sessions}


@router.post("/chat/conversation/mapping")
async def chat_conversation_mapping(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    """Bind a chat thread to a session the resolved employee owns."""
    require_chat_service_request(request)
    body = await json_body(request)
    identity = _resolve_owner(ctx, body)
    session_id = string_field(body, "sessionId")
    if not session_id:
        raise HTTPException(400, "sessionId is required.")
    try:
        session = ctx.session_store.get_session(session_id)
    except KeyError:
        raise HTTPException(404, "Session not found.")
    if not _owned_by(session, identity["employeeId"]):
        raise HTTPException(403, "Session is owned by another employee.")
    record = ctx.chat_store.set_conversation_session(body, session_id, identity["employeeId"])
    return {"mapping": record}
