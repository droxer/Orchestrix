from __future__ import annotations

from fastapi import APIRouter, Response
from fastapi.responses import HTMLResponse

from .helpers import web_ui_asset_response

router = APIRouter()


@router.get("/cp", response_class=HTMLResponse)
async def control_panel() -> str:
    return daemon_control_panel_html()


# Catch-all for the exported web UI served at the root path. Registered last in
# app.py so explicit API routes (/cp, /auth, /sessions, ...) take precedence;
# unmatched paths fall back to the SPA's index.html for client-side routing.
@router.get("/{asset_path:path}")
async def web_asset(asset_path: str = "") -> Response:
    return web_ui_asset_response(asset_path)


def daemon_control_panel_html() -> str:
    return """<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Relay Control Panel</title></head>
<body><main><h1>Relay Control Panel</h1><p>Python backend is running.</p></main></body>
</html>
"""
