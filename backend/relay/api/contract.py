from __future__ import annotations

from dataclasses import dataclass
from re import escape, match, sub
from typing import Any

from fastapi import APIRouter
from fastapi.routing import APIRoute
from loguru import logger

API_VERSION = "v1"
API_PREFIX = f"/api/{API_VERSION}"
API_DOCS_PATH = "/api/docs"
API_OPENAPI_PATH = "/api/openapi.json"
API_REDOC_PATH = "/api/redoc"
WEB_UI_ROUTE_ROOTS = frozenset(
    {
        "admin",
        "agents",
        "backlog",
        "channels",
        "login",
        "routines",
        "teams",
        "threads",
    }
)
_WEB_API_COLLISIONS = frozenset({"agents", "teams"})
_STATIC_ASSET_SUFFIXES = frozenset(
    {".css", ".gif", ".ico", ".jpeg", ".jpg", ".js", ".map", ".png", ".svg", ".webp", ".woff", ".woff2"}
)


@dataclass(frozen=True)
class CanonicalRoute:
    path: str
    methods: frozenset[str]
    tag: str
    status_code: int | None = None


@dataclass(frozen=True)
class RouteMigration:
    successor: str | None
    publish: bool = True


# Each operation rename is declared once. The same metadata publishes canonical
# routes and formats successor links for concrete legacy requests.
_ROUTE_MIGRATIONS = {
    "/tasks/claim-next": RouteMigration(None, publish=False),
    "/sessions/{session_id}/title": RouteMigration(
        "/threads/{session_id}", publish=False
    ),
    "/sessions/{session_id}/archive": RouteMigration(
        "/threads/{session_id}", publish=False
    ),
    "/sessions/{session_id}/cancel": RouteMigration(
        "/threads/{session_id}/cancellations"
    ),
    "/sandboxes/{sandbox_id}/runs/{session_id}/cancel": RouteMigration(
        "/threads/{session_id}/cancellations", publish=False
    ),
    "/tasks/{task_id}/assign": RouteMigration("/tasks/{task_id}/assignment"),
    "/tasks/{task_id}/start": RouteMigration("/tasks/{task_id}/runs"),
    "/tasks/{task_id}/pickup": RouteMigration("/tasks/{task_id}/pickups"),
    "/cp/daemon-nodes/{node_id}/assign": RouteMigration(
        "/admin/daemon-nodes/{node_id}/assignment"
    ),
    "/cp/daemon-nodes/{node_id}/unassign": RouteMigration(
        "/admin/daemon-nodes/{node_id}/assignment"
    ),
    "/cp/chat-integrations/{integration_id}/activate": RouteMigration(
        "/admin/chat-integrations/{integration_id}/activations"
    ),
    "/cp/chat-integrations/{integration_id}/check": RouteMigration(
        "/admin/chat-integrations/{integration_id}/health-checks"
    ),
    "/cp/chat-integrations/{integration_id}/rotate-webhook-secret": RouteMigration(
        "/admin/chat-integrations/{integration_id}/webhook-secret-rotations"
    ),
    "/cp/managed-nodes/{node_id}/retry": RouteMigration(
        "/admin/managed-nodes/{node_id}/attempts", publish=False
    ),
    "/cp/managed-nodes/{node_id}/drain": RouteMigration(
        "/admin/managed-nodes/{node_id}", publish=False
    ),
    "/cp/managed-nodes/{node_id}/permanent": RouteMigration(
        "/admin/managed-nodes/{node_id}/record"
    ),
    "/daemon-nodes/register": RouteMigration("/daemon-node-registrations"),
    "/daemon-nodes/local-enrollment": RouteMigration(
        "/daemon-node-enrollments/local"
    ),
    "/daemon-enroll": RouteMigration("/daemon-node-enrollments"),
}

_METHOD_RENAMES = {
    ("/tasks/{task_id}/assign", "POST"): "PUT",
    ("/cp/daemon-nodes/{node_id}/assign", "POST"): "PUT",
    ("/cp/daemon-nodes/{node_id}/unassign", "POST"): "DELETE",
}

_STATUS_OVERRIDES = {
    ("/sessions/{session_id}/cancel", "POST"): 202,
    ("/tasks/{task_id}/pickup", "POST"): 201,
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
    migration = _ROUTE_MIGRATIONS.get(path)
    if (migration and not migration.publish) or path.startswith("/profile-images/"):
        return None
    canonical_path = (
        migration.successor if migration else _canonical_resource_path(path)
    )
    if canonical_path is None:
        return None
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
    if path == "/cp":
        return "/admin"
    for legacy_template, migration in _ROUTE_MIGRATIONS.items():
        pattern = "^" + sub(
            r"\\\{([^{}]+)\\\}", r"(?P<\1>[^/]+)", escape(legacy_template)
        ) + "$"
        matched = match(pattern, path)
        if not matched:
            continue
        if migration.successor is None:
            return None
        return f"{API_PREFIX}{migration.successor.format(**matched.groupdict())}"
    return f"{API_PREFIX}{_canonical_resource_path(path)}"


@dataclass
class CanonicalRouterGroups:
    public: APIRouter
    admin: APIRouter
    internal_chat: APIRouter
    daemon: APIRouter


def canonical_router_groups() -> CanonicalRouterGroups:
    return CanonicalRouterGroups(
        public=APIRouter(),
        admin=APIRouter(),
        internal_chat=APIRouter(),
        daemon=APIRouter(),
    )


def _canonical_group(groups: CanonicalRouterGroups, path: str) -> APIRouter:
    relative = path.removeprefix(API_PREFIX)
    if relative.startswith("/admin/"):
        return groups.admin
    if relative.startswith("/internal/chat/"):
        return groups.internal_chat
    if relative.startswith(("/daemon-nodes", "/daemon-node-")):
        return groups.daemon
    return groups.public


def include_canonical_router(groups: CanonicalRouterGroups, router: APIRouter) -> None:
    for route in router.routes:
        if not isinstance(route, APIRoute):
            continue
        contract = canonical_route(route.path, route.methods or set())
        if contract is None:
            continue
        _canonical_group(groups, contract.path).add_api_route(
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
        method = scope.get("method") or "GET"
        accept = dict(scope.get("headers") or []).get(b"accept", b"").lower()
        suffix = "." + path.rsplit(".", 1)[-1].lower() if "." in path.rsplit("/", 1)[-1] else ""
        if (
            method == "GET"
            and root in _WEB_API_COLLISIONS
            and (b"text/html" in accept or suffix in _STATIC_ASSET_SUFFIXES)
        ):
            web_scope = {**scope, "path": "/__relay_web__", "raw_path": b"/__relay_web__"}
            web_scope["state"] = {
                **(scope.get("state") or {}),
                "relay_web_asset_path": path.lstrip("/"),
            }
            await self.app(web_scope, receive, send)
            return
        successor = (
            canonical_concrete_path(path) if root in self._legacy_roots else None
        )
        if root not in self._legacy_roots:
            await self.app(scope, receive, send)
            return
        key = (method, root)
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
