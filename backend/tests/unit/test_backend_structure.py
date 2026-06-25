from __future__ import annotations

from tempfile import TemporaryDirectory

import pytest

from relay.api.helpers import daemon_node_event
from relay.app import create_app
from relay.core.models import DaemonNodeRegistration
from relay.daemon_store import LocalDaemonStore
from relay.persistence.daemon_store import LocalDaemonStore as CanonicalLocalDaemonStore
from relay.persistence.session_store import LocalSessionStore as CanonicalLocalSessionStore
from relay.persistence.task_store import LocalTaskStore as CanonicalLocalTaskStore
from relay.session_store import LocalSessionStore
from relay.services.daemon import DaemonNodeRegistry
from relay.stores import LocalDaemonStore as ExportedLocalDaemonStore
from relay.stores import LocalSessionStore as ExportedLocalSessionStore
from relay.stores import LocalTaskStore as ExportedLocalTaskStore
from relay.task_store import LocalTaskStore


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


def test_stores_module_keeps_import_compatibility() -> None:
    assert ExportedLocalSessionStore is LocalSessionStore
    assert ExportedLocalTaskStore is LocalTaskStore
    assert ExportedLocalDaemonStore is LocalDaemonStore
    assert CanonicalLocalSessionStore is LocalSessionStore
    assert CanonicalLocalTaskStore is LocalTaskStore
    assert CanonicalLocalDaemonStore is LocalDaemonStore
    assert DaemonNodeRegistration.__name__ == "DaemonNodeRegistration"
    assert DaemonNodeRegistry.__name__ == "DaemonNodeRegistry"


def test_daemon_node_event_parser_keeps_error_messages() -> None:
    parsed = daemon_node_event({
        "type": "run.completed",
        "commandId": "cmd_1",
        "sessionId": "ses_1",
        "runId": "run_1",
        "agent": "codex",
        "mode": "review",
        "exitCode": 0,
        "agentLog": "ok",
        "reviewVerdict": "approved",
    })

    assert parsed["exitCode"] == 0
    assert parsed["reviewVerdict"] == "approved"

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

    with pytest.raises(ValueError, match="invalid reviewVerdict maybe"):
        daemon_node_event({
            "type": "run.completed",
            "commandId": "cmd_1",
            "sessionId": "ses_1",
            "runId": "run_1",
            "agent": "codex",
            "exitCode": 0,
            "reviewVerdict": "maybe",
        })
