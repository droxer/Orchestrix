from __future__ import annotations

from relay.persistence.store_common import database_engine_options


def test_postgres_pool_options_are_deployment_tunable(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_DB_POOL_SIZE", "24")
    monkeypatch.setenv("RELAY_DB_MAX_OVERFLOW", "12")
    monkeypatch.setenv("RELAY_DB_POOL_TIMEOUT_SECONDS", "3")
    monkeypatch.setenv("RELAY_DB_POOL_RECYCLE_SECONDS", "240")
    monkeypatch.setenv("RELAY_DB_POOL_PRE_PING", "false")

    assert database_engine_options("postgresql+psycopg://relay:test@db/relay") == {
        "pool_size": 24,
        "max_overflow": 12,
        "pool_timeout": 3.0,
        "pool_recycle": 240,
        "pool_pre_ping": False,
        "pool_use_lifo": True,
    }


def test_sqlite_does_not_receive_server_pool_options(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_DB_POOL_SIZE", "24")

    assert database_engine_options("sqlite:///relay.db") == {}
