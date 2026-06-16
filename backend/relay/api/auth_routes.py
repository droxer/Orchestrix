from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response

from ..auth import (
    USER_COOKIE_NAME,
    require_admin_session,
    require_user_session,
    user_session_cookie_attrs,
    user_session_token_from_request,
)
from .deps import AppContextDep
from .helpers import json_body, string_field

router = APIRouter()


@router.get("/auth/status")
async def auth_status(ctx: AppContextDep) -> dict[str, Any]:
    return {"requiresBootstrap": not ctx.auth_store.has_users()}


@router.get("/auth/me")
async def auth_me(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    user = require_user_session(request, ctx.auth_store)
    return {"authenticated": True, "user": ctx.auth_store._public_user(user)}


@router.post("/auth/bootstrap")
async def auth_bootstrap(request: Request, response: Response, ctx: AppContextDep) -> dict[str, Any]:
    body = await json_body(request)
    try:
        user = ctx.auth_store.bootstrap_with_token(
            string_field(body, "token"),
            string_field(body, "username"),
            string_field(body, "password"),
        )
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    session = ctx.auth_store.create_session(user["id"])
    attrs = user_session_cookie_attrs(
        max_age_seconds=ctx.auth_store.session_ttl_seconds,
        secure=request.url.scheme == "https",
    )
    response.set_cookie(value=session["token"], **attrs)
    return {"user": user}


@router.post("/auth/login")
async def auth_login(request: Request, response: Response, ctx: AppContextDep) -> dict[str, Any]:
    body = await json_body(request)
    user = ctx.auth_store.authenticate(string_field(body, "username"), string_field(body, "password"))
    if not user:
        raise HTTPException(401, "Invalid username or password.")
    session = ctx.auth_store.create_session(user["id"])
    attrs = user_session_cookie_attrs(
        max_age_seconds=ctx.auth_store.session_ttl_seconds,
        secure=request.url.scheme == "https",
    )
    response.set_cookie(value=session["token"], **attrs)
    return {"user": ctx.auth_store._public_user(user)}


@router.post("/auth/logout")
async def auth_logout(request: Request, response: Response, ctx: AppContextDep) -> dict[str, bool]:
    token = user_session_token_from_request(request)
    if token:
        ctx.auth_store.delete_session(token)
    response.delete_cookie(
        key=USER_COOKIE_NAME,
        path="/",
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
    )
    return {"ok": True}


@router.get("/cp/version")
async def control_panel_version(request: Request, ctx: AppContextDep) -> dict[str, str]:
    require_admin_session(request, ctx.auth_store)
    return {"version": request.app.state.control_panel_version}
