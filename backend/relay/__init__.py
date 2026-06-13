from __future__ import annotations

from typing import Any

__all__ = [
    "DEFAULT_RELAY_DATA_DIR",
    "DaemonNodeRegistry",
    "DatabaseDaemonStore",
    "DatabaseSessionStore",
    "DatabaseTaskStore",
    "DatabaseUserAuthStore",
    "LocalDaemonStore",
    "LocalSessionStore",
    "LocalTaskStore",
    "ServerDaemonNodeBackend",
    "SessionController",
    "create_app",
]


def __getattr__(name: str) -> Any:
    if name == "create_app":
        from .app import create_app

        return create_app
    if name == "SessionController":
        from .controller import SessionController

        return SessionController
    if name in {"DaemonNodeRegistry", "ServerDaemonNodeBackend"}:
        from .daemon import DaemonNodeRegistry, ServerDaemonNodeBackend

        return {"DaemonNodeRegistry": DaemonNodeRegistry, "ServerDaemonNodeBackend": ServerDaemonNodeBackend}[name]
    if name in {
        "DEFAULT_RELAY_DATA_DIR",
        "DatabaseDaemonStore",
        "DatabaseSessionStore",
        "DatabaseTaskStore",
        "LocalDaemonStore",
        "LocalSessionStore",
        "LocalTaskStore",
    }:
        from .stores import DEFAULT_RELAY_DATA_DIR, DatabaseDaemonStore, DatabaseSessionStore, DatabaseTaskStore, LocalDaemonStore, LocalSessionStore, LocalTaskStore

        return {
            "DEFAULT_RELAY_DATA_DIR": DEFAULT_RELAY_DATA_DIR,
            "DatabaseDaemonStore": DatabaseDaemonStore,
            "DatabaseSessionStore": DatabaseSessionStore,
            "DatabaseTaskStore": DatabaseTaskStore,
            "LocalDaemonStore": LocalDaemonStore,
            "LocalSessionStore": LocalSessionStore,
            "LocalTaskStore": LocalTaskStore,
        }[name]
    if name == "DatabaseUserAuthStore":
        from .auth import DatabaseUserAuthStore

        return DatabaseUserAuthStore
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
