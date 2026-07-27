from __future__ import annotations

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse

from .helpers import web_ui_asset_response

router = APIRouter()


@router.get("/cp", include_in_schema=False)
async def control_panel() -> RedirectResponse:
    return RedirectResponse("/admin", status_code=308)


@router.get("/__relay_web__", include_in_schema=False)
async def dispatched_web_asset(request: Request) -> Response:
    asset_path = getattr(request.state, "relay_web_asset_path", None)
    if not isinstance(asset_path, str):
        return JSONResponse({"detail": "Not found."}, status_code=404)
    return web_ui_asset_response(asset_path)


# Catch-all for the exported web UI served at the root path. Registered last in
# app.py so explicit API and compatibility routes take precedence. The legacy
# middleware content-negotiates the two colliding /agents and /teams roots.
@router.get("/{asset_path:path}", include_in_schema=False)
async def web_asset(asset_path: str = "") -> Response:
    return web_ui_asset_response(asset_path)
