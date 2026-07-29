from __future__ import annotations

from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from relay.api.session_routes import is_workspace_artifact, workspace_artifacts
from relay.app import create_app


def test_is_workspace_artifact_only_allows_generated_files() -> None:
    assert is_workspace_artifact({"kind": "workspace_file"}) is True
    assert is_workspace_artifact({"kind": "plan"}) is False
    assert is_workspace_artifact({"kind": "review"}) is False
    assert is_workspace_artifact({"kind": "command_log"}) is False


def test_workspace_artifacts_filters_to_generated_files() -> None:
    session = {
        "artifacts": [
            {"id": "plan", "kind": "plan"},
            {"id": "log", "kind": "command_log"},
            {"id": "diff", "kind": "diff"},
            {"id": "deck", "kind": "workspace_file"},
        ],
    }
    filtered = workspace_artifacts(session)
    assert [artifact["id"] for artifact in filtered] == ["deck"]


def test_session_assignment_and_handoff_preserve_ask_mode(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        response = client.post("/api/v1/auth/bootstrap", json={
            "token": "admin_token",
            "username": "admin",
            "password": "secret123",
        })
        assert response.status_code == 200

        created = client.post("/api/v1/threads", json={
            "taskGoal": "Explain the task",
            "assignments": [{"agent": "codex", "mode": "ask"}],
        })
        assert created.status_code == 201
        session_id = created.json()["id"]

        [plan] = [artifact for artifact in created.json()["artifacts"] if artifact["title"] == "Assignment plan"]
        assert '"mode": "ask"' in app.state.session_store.read_artifact(session_id, plan["id"])

        handed = client.post(f"/api/v1/threads/{session_id}/handoffs", json={
            "targetAgent": "claude",
            "mode": "ask",
            "note": "Answer without editing files.",
        })
        assert handed.status_code == 200
        assert handed.json()["decisions"][-1]["kind"] == "handoff"
        assert handed.json()["decisions"][-1]["targetAgent"] == "claude"

        [latest_plan] = [
            artifact
            for artifact in handed.json()["artifacts"]
            if artifact["title"] == "Assignment plan"
        ][-1:]
        assert '"mode": "ask"' in app.state.session_store.read_artifact(session_id, latest_plan["id"])


def test_session_creation_persists_the_selected_computer(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        response = client.post(
            "/api/v1/auth/bootstrap",
            json={
                "token": "admin_token",
                "username": "admin",
                "password": "secret123",
            },
        )
        assert response.status_code == 200
        app.state.registry.register(
            {
                "sandboxId": "node_a",
                "employeeId": "admin",
                "token": "node_token",
                "workspacePath": "/workspace/admin",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            }
        )

        created = client.post(
            "/api/v1/threads",
            json={"taskGoal": "Start here", "daemonNodeId": "node_a"},
        )

        assert created.status_code == 201, created.text
        assert created.json()["daemonNodeId"] == "node_a"
