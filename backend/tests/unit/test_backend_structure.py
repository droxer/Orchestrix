from __future__ import annotations

from tempfile import TemporaryDirectory

import pytest

from relay.api.helpers import daemon_node_event
from relay.app import create_app
from relay.core.models import DaemonNodeRegistration
from relay.daemon_registry import DaemonNodeRegistry, ServerDaemonNodeBackend
from relay.chat import DatabaseChatIntegrationStore
from relay.persistence.daemon_store import DatabaseDaemonStore, LocalDaemonStore as CanonicalLocalDaemonStore
from relay.persistence.session_store import DatabaseSessionStore, LocalSessionStore as CanonicalLocalSessionStore
from relay.persistence.task_store import DatabaseTaskStore, LocalTaskStore as CanonicalLocalTaskStore
from relay.persistence.stores import LocalDaemonStore, LocalSessionStore, LocalTaskStore
from relay.security.auth import DatabaseUserAuthStore


def test_app_factory_wires_backend_state_and_routes() -> None:
    with TemporaryDirectory() as root:
        app = create_app(root)

    assert isinstance(app.state.session_store, LocalSessionStore)
    assert isinstance(app.state.task_store, LocalTaskStore)
    assert isinstance(app.state.daemon_store, LocalDaemonStore)
    assert app.state.task_scheduler is not None

    paths = {route.path for route in app.routes}
    assert "/auth/login" in paths
    assert "/cp/daemon-nodes" in paths
    assert "/tasks/{task_id}/pickup" in paths
    assert "/sessions/{session_id}/events" in paths
    assert "/daemon-nodes/{sandbox_id}/events" in paths


def test_app_factory_can_disable_task_scheduler(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_TASK_SCHEDULER_ENABLED", "0")
    with TemporaryDirectory() as root:
        app = create_app(root)

    assert app.state.task_scheduler is None


def test_app_factory_uses_database_stores_without_local_state(monkeypatch) -> None:
    with TemporaryDirectory() as root:
        database_url = f"sqlite:///{root}/relay.db"
        DatabaseSessionStore(database_url, create_schema=True)
        DatabaseTaskStore(database_url, create_schema=True)
        DatabaseDaemonStore(database_url, create_schema=True)
        DatabaseUserAuthStore(database_url, create_schema=True)
        DatabaseChatIntegrationStore(database_url, create_schema=True)
        monkeypatch.setenv("RELAY_STORAGE", "postgres")
        monkeypatch.setenv("RELAY_DATABASE_URL", database_url)
        monkeypatch.setenv("RELAY_TASK_SCHEDULER_ENABLED", "0")
        app = create_app(root)

    assert isinstance(app.state.session_store, DatabaseSessionStore)
    assert isinstance(app.state.task_store, DatabaseTaskStore)
    assert isinstance(app.state.daemon_store, DatabaseDaemonStore)
    assert isinstance(app.state.auth_store, DatabaseUserAuthStore)
    assert isinstance(app.state.chat_store, DatabaseChatIntegrationStore)
    assert app.state.session_store.root_dir is None
    assert app.state.session_store.artifacts_dir is None


def test_backend_uses_canonical_domain_modules() -> None:
    assert CanonicalLocalSessionStore is LocalSessionStore
    assert CanonicalLocalTaskStore is LocalTaskStore
    assert CanonicalLocalDaemonStore is LocalDaemonStore
    assert DaemonNodeRegistration.__name__ == "DaemonNodeRegistration"
    assert DaemonNodeRegistry.__name__ == "DaemonNodeRegistry"
    assert ServerDaemonNodeBackend.__name__ == "ServerDaemonNodeBackend"
    assert DaemonNodeRegistry.__module__.startswith("relay.daemon_registry")
    assert ServerDaemonNodeBackend.__module__.startswith("relay.daemon_registry")


def test_daemon_node_event_parser_keeps_error_messages_and_raw_logs() -> None:
    raw_log = "  indented output\n\n"
    parsed = daemon_node_event({
        "type": "run.completed",
        "commandId": "cmd_1",
        "sessionId": "ses_1",
        "runId": "run_1",
        "agent": "codex",
        "leaseId": "lease_1",
        "mode": "review",
        "exitCode": 0,
        "agentLog": raw_log,
    })

    assert parsed["exitCode"] == 0
    assert parsed["leaseId"] == "lease_1"
    assert parsed["agentLog"] == raw_log

    parsed_failed = daemon_node_event({
        "type": "run.failed",
        "commandId": "cmd_1",
        "sessionId": "ses_1",
        "runId": "run_1",
        "agent": "codex",
        "mode": "action",
        "error": "stream post failed",
        "agentLog": raw_log,
    })
    assert parsed_failed["agentLog"] == raw_log

    parsed_with_usage = daemon_node_event({
        "type": "run.completed",
        "commandId": "cmd_1",
        "sessionId": "ses_1",
        "runId": "run_1",
        "agent": "codex",
        "mode": "action",
        "exitCode": 0,
        "tokenUsage": {"input": 10, "output": 5, "cache": 3, "total": 18, "source": "codex"},
    })
    assert parsed_with_usage["tokenUsage"] == {"input": 10, "output": 5, "cache": 3, "total": 18, "source": "codex"}

    with pytest.raises(ValueError, match="tokenUsage total"):
        daemon_node_event({
            "type": "run.completed",
            "commandId": "cmd_1",
            "sessionId": "ses_1",
            "runId": "run_1",
            "agent": "codex",
            "exitCode": 0,
            "tokenUsage": {"input": 1, "output": 1, "cache": 0, "total": 9},
        })
