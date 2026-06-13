from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def clear_storage_env(monkeypatch) -> None:
    monkeypatch.delenv("RELAY_STORAGE", raising=False)
    monkeypatch.delenv("RELAY_AUTH_STORE", raising=False)
    monkeypatch.delenv("RELAY_DAEMON_STORE", raising=False)
    monkeypatch.delenv("RELAY_DATABASE_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
