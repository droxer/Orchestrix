from __future__ import annotations

import os


def storage_mode() -> str:
    mode = os.environ.get("RELAY_STORAGE", "").strip().lower()
    if mode in ("", "file", "local"):
        return "file"
    if mode in ("postgres", "postgresql", "database", "db"):
        return "postgres"
    raise RuntimeError("RELAY_STORAGE must be one of: file, local, postgres.")


def use_postgres_storage() -> bool:
    return storage_mode() == "postgres"


def database_url_from_env(*, setting: str = "RELAY_STORAGE=postgres") -> str:
    database_url = os.environ.get("RELAY_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError(f"{setting} requires RELAY_DATABASE_URL or DATABASE_URL.")
    return database_url
