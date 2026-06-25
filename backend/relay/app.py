from __future__ import annotations

from contextlib import asynccontextmanager
import os
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import FastAPI
from loguru import logger

from .api import admin_routes, auth_routes, chat_routes, daemon_node_routes, sandbox_routes, session_routes, task_routes, web_routes
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
from .security.auth import auth_store_from_env
from .services.chat_integrations import LocalChatIntegrationStore
from .services.daemon import DaemonNodeRegistry, ServerDaemonNodeBackend
from .services.task_scheduler import TaskScheduler

load_backend_env()

CONTROL_PANEL_VERSION = os.environ.get("RELAY_CONTROL_PANEL_VERSION") or "python"
WEB_UI_PATH = "/web"


def create_app(root_dir: str | Path = DEFAULT_RELAY_DATA_DIR) -> FastAPI:
    root_dir = Path(root_dir)
    logger.info("Relay backend starting", root_dir=str(root_dir))

    session_store = session_store_from_env(root_dir)
    task_store = task_store_from_env(root_dir)
    daemon_store = daemon_store_from_env(root_dir)
    chat_store = LocalChatIntegrationStore(root_dir)
    registry = DaemonNodeRegistry(session_store, daemon_store, task_store=task_store)
    backend = ServerDaemonNodeBackend(registry)
    auth_store = auth_store_from_env(root_dir)

    scheduler = task_scheduler_from_env(task_store=task_store, registry=registry, backend=backend)

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
    app.state.registry = registry
    app.state.backend = backend
    app.state.auth_store = auth_store
    app.state.task_scheduler = scheduler
    app.state.control_panel_version = CONTROL_PANEL_VERSION

    @app.get("/")
    async def root() -> dict[str, Any]:
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

    app.include_router(web_routes.router)
    app.include_router(auth_routes.router)
    app.include_router(admin_routes.router)
    app.include_router(chat_routes.router)
    app.include_router(task_routes.router)
    app.include_router(session_routes.router)
    app.include_router(sandbox_routes.router)
    app.include_router(daemon_node_routes.router)
    return app


def daemon_store_from_env(root_dir: Path) -> Any:
    daemon_store = os.environ.get("RELAY_DAEMON_STORE", "").strip().lower()
    if daemon_store != "database" and not use_postgres_storage():
        return LocalDaemonStore(root_dir)
    setting = "RELAY_DAEMON_STORE=database" if daemon_store == "database" else "RELAY_STORAGE=postgres"
    database_url = database_url_from_env(setting=setting)
    return DatabaseDaemonStore(database_url)


def session_store_from_env(root_dir: Path) -> Any:
    if not use_postgres_storage():
        return LocalSessionStore(root_dir)
    return DatabaseSessionStore(database_url_from_env(), root_dir)


def task_store_from_env(root_dir: Path) -> Any:
    if not use_postgres_storage():
        return LocalTaskStore(root_dir)
    return DatabaseTaskStore(database_url_from_env())


def task_scheduler_from_env(*, task_store: Any, registry: DaemonNodeRegistry, backend: ServerDaemonNodeBackend) -> TaskScheduler | None:
    enabled = os.environ.get("RELAY_TASK_SCHEDULER_ENABLED", "1").strip().lower()
    if enabled in ("0", "false", "no", "off"):
        return None
    return TaskScheduler(
        task_store=task_store,
        registry=registry,
        backend=backend,
        interval_seconds=float(os.environ.get("RELAY_TASK_SCHEDULER_INTERVAL_SECONDS", "10")),
        max_dispatches_per_tick=max(1, int(os.environ.get("RELAY_TASK_SCHEDULER_MAX_DISPATCHES", "5"))),
    )
