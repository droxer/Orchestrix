from __future__ import annotations

from dataclasses import dataclass
from re import sub
from typing import Any

from fastapi import APIRouter, FastAPI
from fastapi.routing import APIRoute
from loguru import logger

API_VERSION = "v1"
API_PREFIX = f"/api/{API_VERSION}"
API_DOCS_PATH = "/api/docs"
API_OPENAPI_PATH = "/api/openapi.json"
API_REDOC_PATH = "/api/redoc"


@dataclass(frozen=True)
class CanonicalRoute:
    path: str
    methods: frozenset[str]
    tag: str
    status_code: int | None = None


_EXCLUDED_PATHS = {
    "/tasks/claim-next",
    "/sessions/{session_id}/title",
    "/sessions/{session_id}/archive",
    "/sandboxes/{sandbox_id}/runs/{session_id}/cancel",
    "/cp/managed-nodes/{node_id}/retry",
    "/cp/managed-nodes/{node_id}/drain",
}

_PATH_RENAMES = {
    "/sessions/{session_id}/cancel": "/threads/{session_id}/cancellations",
    "/tasks/{task_id}/assign": "/tasks/{task_id}/assignment",
    "/tasks/{task_id}/start": "/tasks/{task_id}/runs",
    "/tasks/{task_id}/pickup": "/tasks/{task_id}/pickups",
    "/cp/daemon-nodes/{node_id}/assign": "/admin/daemon-nodes/{node_id}/assignment",
    "/cp/daemon-nodes/{node_id}/unassign": "/admin/daemon-nodes/{node_id}/assignment",
    "/cp/chat-integrations/{integration_id}/activate": "/admin/chat-integrations/{integration_id}/activations",
    "/cp/chat-integrations/{integration_id}/check": "/admin/chat-integrations/{integration_id}/health-checks",
    "/cp/chat-integrations/{integration_id}/rotate-webhook-secret": "/admin/chat-integrations/{integration_id}/webhook-secret-rotations",
    "/cp/managed-nodes/{node_id}/permanent": "/admin/managed-nodes/{node_id}/record",
    "/daemon-nodes/register": "/daemon-node-registrations",
    "/daemon-nodes/local-enrollment": "/daemon-node-enrollments/local",
    "/daemon-enroll": "/daemon-node-enrollments",
}

_METHOD_RENAMES = {
    ("/tasks/{task_id}/assign", "POST"): "PUT",
    ("/cp/daemon-nodes/{node_id}/assign", "POST"): "PUT",
    ("/cp/daemon-nodes/{node_id}/unassign", "POST"): "DELETE",
}

_STATUS_OVERRIDES = {
    ("/sessions/{session_id}/cancel", "POST"): 202,
    ("/teams/{team_id}", "DELETE"): 200,
    ("/cp/teams/{team_id}", "DELETE"): 200,
    ("/cp/agents/{agent_id}", "DELETE"): 200,
    ("/cp/agent-placements/{placement_id}", "DELETE"): 200,
    ("/cp/managed-nodes/{node_id}", "DELETE"): 200,
}


def _canonical_resource_path(path: str) -> str:
    if path.startswith("/sessions"):
        return f"/threads{path.removeprefix('/sessions')}"
    if path.startswith("/cp/"):
        return f"/admin/{path.removeprefix('/cp/')}"
    if path.startswith("/chat/"):
        return f"/internal/chat/{path.removeprefix('/chat/')}"
    return path


def _tag_for_path(path: str) -> str:
    parts = [part for part in path.split("/") if part]
    if parts[:2] == ["internal", "chat"]:
        return "internal-chat"
    if parts and parts[0] == "admin":
        return f"admin-{parts[1]}" if len(parts) > 1 else "admin"
    return parts[0] if parts else "api"


def canonical_route(
    path: str, methods: set[str] | frozenset[str]
) -> CanonicalRoute | None:
    if path in _EXCLUDED_PATHS or path.startswith("/profile-images/"):
        return None
    canonical_path = _PATH_RENAMES.get(path, _canonical_resource_path(path))
    canonical_methods = frozenset(
        _METHOD_RENAMES.get((path, method), method) for method in methods
    )
    status_code = next(
        (
            override
            for method in methods
            if (override := _STATUS_OVERRIDES.get((path, method))) is not None
        ),
        None,
    )
    return CanonicalRoute(
        path=f"{API_PREFIX}{canonical_path}",
        methods=canonical_methods,
        tag=_tag_for_path(canonical_path),
        status_code=status_code,
    )


def canonical_concrete_path(path: str) -> str | None:
    if path == "/tasks/claim-next":
        return None
    renamed = path
    replacements = (
        (r"^/sessions/([^/]+)/title$", r"/threads/\1"),
        (r"^/sessions/([^/]+)/archive$", r"/threads/\1"),
        (r"^/sessions/([^/]+)/cancel$", r"/threads/\1/cancellations"),
        (r"^/sandboxes/[^/]+/runs/([^/]+)/cancel$", r"/threads/\1/cancellations"),
        (r"^/tasks/([^/]+)/assign$", r"/tasks/\1/assignment"),
        (r"^/tasks/([^/]+)/start$", r"/tasks/\1/runs"),
        (r"^/tasks/([^/]+)/pickup$", r"/tasks/\1/pickups"),
        (
            r"^/cp/daemon-nodes/([^/]+)/(?:assign|unassign)$",
            r"/admin/daemon-nodes/\1/assignment",
        ),
        (
            r"^/cp/chat-integrations/([^/]+)/activate$",
            r"/admin/chat-integrations/\1/activations",
        ),
        (
            r"^/cp/chat-integrations/([^/]+)/check$",
            r"/admin/chat-integrations/\1/health-checks",
        ),
        (
            r"^/cp/chat-integrations/([^/]+)/rotate-webhook-secret$",
            r"/admin/chat-integrations/\1/webhook-secret-rotations",
        ),
        (r"^/cp/managed-nodes/([^/]+)/permanent$", r"/admin/managed-nodes/\1/record"),
        (r"^/daemon-nodes/register$", r"/daemon-node-registrations"),
        (r"^/daemon-nodes/local-enrollment$", r"/daemon-node-enrollments/local"),
        (r"^/daemon-enroll$", r"/daemon-node-enrollments"),
    )
    for pattern, replacement in replacements:
        candidate = sub(pattern, replacement, renamed)
        if candidate != renamed:
            renamed = candidate
            break
    renamed = _canonical_resource_path(renamed)
    return f"{API_PREFIX}{renamed}"


def include_canonical_router(app: FastAPI, router: APIRouter) -> None:
    for route in router.routes:
        if not isinstance(route, APIRoute):
            continue
        contract = canonical_route(route.path, route.methods or set())
        if contract is None:
            continue
        app.add_api_route(
            contract.path,
            route.endpoint,
            methods=contract.methods,
            response_model=route.response_model,
            status_code=contract.status_code or route.status_code,
            tags=[contract.tag],
            dependencies=route.dependencies,
            summary=route.summary,
            description=route.description,
            response_description=route.response_description,
            responses=route.responses,
            deprecated=route.deprecated,
            operation_id=route.operation_id,
            response_class=route.response_class,
            name=route.name,
            openapi_extra=route.openapi_extra,
        )


class LegacyApiHeadersMiddleware:
    _legacy_roots = frozenset(
        {
            "agent-runs",
            "agents",
            "artifacts",
            "auth",
            "chat",
            "cp",
            "daemon-enroll",
            "daemon-nodes",
            "sandboxes",
            "sessions",
            "tasks",
            "teams",
            "workspace",
        }
    )

    def __init__(self, app: Any) -> None:
        self.app = app
        self._logged: set[tuple[str, str]] = set()

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path") or ""
        root = path.lstrip("/").split("/", 1)[0]
        successor = (
            canonical_concrete_path(path) if root in self._legacy_roots else None
        )
        if root not in self._legacy_roots:
            await self.app(scope, receive, send)
            return
        key = (scope.get("method") or "GET", root)
        if key not in self._logged:
            self._logged.add(key)
            logger.warning(
                "Legacy API route used",
                method=key[0],
                legacy_root=root,
                successor=successor,
            )

        async def send_with_headers(message: dict[str, Any]) -> None:
            if message.get("type") == "http.response.start":
                headers = list(message.get("headers") or [])
                headers.append((b"deprecation", b"true"))
                if successor:
                    headers.append(
                        (b"link", f'<{successor}>; rel="successor-version"'.encode())
                    )
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)
