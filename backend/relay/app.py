from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date, datetime
import os
from pathlib import Path
from typing import Any, AsyncIterator, Callable
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from loguru import logger

from .api import admin_routes, agent_routes, agent_workspace_routes, auth_routes, chat_routes, daemon_node_routes, managed_node_routes, node_workspace_routes, sandbox_routes, session_routes, task_routes, web_routes
from .core.environment import load_backend_env
from .core.storage_config import database_url_from_env, use_postgres_storage
from .persistence.stores import (
    DEFAULT_RELAY_DATA_DIR,
    DatabaseDaemonStore,
    DatabaseSessionStore,
    DatabaseTaskStore,
    LocalDaemonStore,
    LocalSessionStore,
    LocalTaskStore,
)
from .daemon_registry import DaemonNodeRegistry, ServerDaemonNodeBackend
from .security.auth import auth_store_from_env
from .chat import DatabaseChatIntegrationStore, LocalChatIntegrationStore, probe_chat_integration, provision_chat_integration
from .tasks import TaskScheduler
from .services.managed_nodes import LocalManagedNodeStore
from .persistence.agent_store import DatabaseAgentStore, LocalAgentStore
from .persistence.agent_placement_store import DatabaseAgentPlacementStore, LocalAgentPlacementStore, reconcile_single_active_placement
from .services.workspace_query import WorkspaceQueryBroker

load_backend_env()

CONTROL_PANEL_VERSION = os.environ.get("RELAY_CONTROL_PANEL_VERSION") or "python"
WEB_UI_PATH = "/"


def create_app(root_dir: str | Path = DEFAULT_RELAY_DATA_DIR) -> FastAPI:
    root_dir = Path(root_dir)
    logger.info("Relay backend starting", root_dir=str(root_dir))

    session_store = session_store_from_env(root_dir)
    task_store = task_store_from_env(root_dir)
    daemon_store = daemon_store_from_env(root_dir)
    chat_store = chat_store_from_env(root_dir)
    auth_store = auth_store_from_env(root_dir)
    managed_node_store = LocalManagedNodeStore(root_dir)
    agent_store = agent_store_from_env(root_dir)
    agent_placement_store = agent_placement_store_from_env(root_dir)
    # Heal any agent left with multiple active placements before the
    # one-agent-one-computer invariant (idempotent; a no-op once collapsed).
    reconcile_single_active_placement(agent_placement_store)
    registry = DaemonNodeRegistry(session_store, daemon_store, task_store=task_store)
    backend = ServerDaemonNodeBackend(
        registry,
        agent_store=agent_store,
        agent_placement_store=agent_placement_store,
    )

    scheduler = task_scheduler_from_env(
        task_store=task_store,
        registry=registry,
        backend=backend,
        managed_node_store=managed_node_store,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if scheduler:
            scheduler.start()
        try:
            yield
        finally:
            if scheduler:
                await scheduler.stop()

    app = FastAPI(title="Relay backend", version="0.1.0", lifespan=lifespan)
    app.state.session_store = session_store
    app.state.task_store = task_store
    app.state.daemon_store = daemon_store
    app.state.chat_store = chat_store
    app.state.chat_probe = probe_chat_integration
    app.state.chat_provision = provision_chat_integration
    app.state.chat_rotation_locks = {}
    app.state.registry = registry
    app.state.backend = backend
    app.state.auth_store = auth_store
    app.state.managed_node_store = managed_node_store
    app.state.agent_store = agent_store
    app.state.employee_agent_store = agent_store  # compatibility for migrations still reading the old name
    app.state.agent_placement_store = agent_placement_store
    app.state.workspace_query_broker = WorkspaceQueryBroker()
    app.state.task_scheduler = scheduler
    app.state.control_panel_version = CONTROL_PANEL_VERSION

    @app.get("/api")
    async def api_info() -> dict[str, Any]:
        return {
            "name": "Relay backend",
            "ui": True,
            "uiPath": "/cp",
            "webUiPath": WEB_UI_PATH,
            "endpoints": [
                "GET /tasks",
                "POST /tasks",
                "GET /sessions",
                "POST /sessions",
                "GET /sandboxes",
                "POST /sandboxes",
                "GET /daemon-nodes",
                "POST /daemon-nodes/register",
                "GET /daemon-nodes/:sandboxId/commands",
                "POST /daemon-nodes/:sandboxId/events",
            ],
        }

    app.include_router(auth_routes.router)
    app.include_router(agent_routes.router)
    app.include_router(agent_workspace_routes.router)
    app.include_router(node_workspace_routes.router)
    app.include_router(admin_routes.router)
    app.include_router(chat_routes.router)
    app.include_router(task_routes.router)
    app.include_router(session_routes.router)
    app.include_router(sandbox_routes.router)
    app.include_router(daemon_node_routes.router)
    app.include_router(managed_node_routes.router)
    # Registered last: its root catch-all serves the exported web UI and must not
    # shadow the explicit API routes above.
    app.include_router(web_routes.router)
    return app


def daemon_store_from_env(root_dir: Path) -> Any:
    daemon_store = os.environ.get("RELAY_DAEMON_STORE", "").strip().lower()
    if daemon_store != "database" and not use_postgres_storage():
        return LocalDaemonStore(root_dir)
    setting = "RELAY_DAEMON_STORE=database" if daemon_store == "database" else "RELAY_STORAGE=postgres"
    database_url = database_url_from_env(setting=setting)
    return DatabaseDaemonStore(database_url)


def agent_store_from_env(root_dir: Path) -> Any:
    if not use_postgres_storage():
        return LocalAgentStore(root_dir)
    return DatabaseAgentStore(database_url_from_env(setting="RELAY_STORAGE=postgres"))


def agent_placement_store_from_env(root_dir: Path) -> Any:
    if not use_postgres_storage():
        return LocalAgentPlacementStore(root_dir)
    return DatabaseAgentPlacementStore(database_url_from_env(setting="RELAY_STORAGE=postgres"))


def session_store_from_env(root_dir: Path) -> Any:
    if not use_postgres_storage():
        return LocalSessionStore(root_dir)
    return DatabaseSessionStore(database_url_from_env())


def task_store_from_env(root_dir: Path) -> Any:
    if not use_postgres_storage():
        return LocalTaskStore(root_dir)
    return DatabaseTaskStore(database_url_from_env())


def chat_store_from_env(root_dir: Path) -> Any:
    chat_store = os.environ.get("RELAY_CHAT_STORE", "").strip().lower()
    if chat_store != "database" and not use_postgres_storage():
        return LocalChatIntegrationStore(root_dir)
    setting = "RELAY_CHAT_STORE=database" if chat_store == "database" else "RELAY_STORAGE=postgres"
    return DatabaseChatIntegrationStore(database_url_from_env(setting=setting))


def task_scheduler_from_env(
    *,
    task_store: Any,
    registry: DaemonNodeRegistry,
    backend: ServerDaemonNodeBackend,
    managed_node_store: Any | None = None,
) -> TaskScheduler | None:
    enabled = os.environ.get("RELAY_TASK_SCHEDULER_ENABLED", "1").strip().lower()
    if enabled in ("0", "false", "no", "off"):
        return None
    return TaskScheduler(
        task_store=task_store,
        registry=registry,
        backend=backend,
        managed_node_store=managed_node_store,
        interval_seconds=float(os.environ.get("RELAY_TASK_SCHEDULER_INTERVAL_SECONDS", "10")),
        max_dispatches_per_tick=max(1, int(os.environ.get("RELAY_TASK_SCHEDULER_MAX_DISPATCHES", "5"))),
        today=scheduler_today_from_env(),
    )


def scheduler_today_from_env() -> Callable[[], date]:
    """Routine due dates are calendar days; without a configured timezone they
    roll over at server-local midnight, which surprises users in other zones."""
    timezone_name = os.environ.get("RELAY_TASK_SCHEDULER_TIMEZONE", "").strip()
    if not timezone_name:
        return date.today
    zone = ZoneInfo(timezone_name)  # invalid names fail fast at startup
    return lambda: datetime.now(zone).date()
