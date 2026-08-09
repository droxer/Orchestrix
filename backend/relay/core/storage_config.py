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


# Managed Postgres providers (Railway, Heroku, Render, Fly) publish DATABASE_URL
# with a bare `postgres://` or `postgresql://` scheme. SQLAlchemy resolves those
# to psycopg2, which Relay does not depend on — psycopg 3 is the installed
# driver. Pin the driver so a provider-supplied URL works unedited.
_PSYCOPG_DRIVER = "postgresql+psycopg"
_BARE_POSTGRES_SCHEMES = ("postgresql://", "postgres://")


def normalize_database_url(database_url: str) -> str:
    """Pin the psycopg 3 driver on provider-issued Postgres URLs.

    URLs that already name a driver (`postgresql+psycopg://`,
    `postgresql+asyncpg://`) and non-Postgres URLs (`sqlite:///`) pass through
    untouched — an explicit driver is always the operator's choice.
    """
    url = database_url.strip()
    for scheme in _BARE_POSTGRES_SCHEMES:
        if url.startswith(scheme):
            return f"{_PSYCOPG_DRIVER}://{url[len(scheme):]}"
    return url


def database_url_from_env(*, setting: str = "RELAY_STORAGE=postgres") -> str:
    database_url = os.environ.get("RELAY_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError(f"{setting} requires RELAY_DATABASE_URL or DATABASE_URL.")
    return normalize_database_url(database_url)
