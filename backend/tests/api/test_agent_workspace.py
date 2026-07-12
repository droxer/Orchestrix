from __future__ import annotations

import base64

from fastapi.testclient import TestClient

from relay.app import create_app
from relay.core.ids import new_relay_id


def _bootstrap(client: TestClient) -> None:
    assert client.post("/auth/bootstrap", json={"token": "admin_token", "username": "admin", "password": "secret123"}).status_code == 200


def _agent(client: TestClient) -> dict:
    assert client.post("/cp/users", json={"username": "alice", "password": "userpass", "employeeId": "alice"}).status_code == 201
    response = client.post("/cp/agents", json={"supervisorEmployeeId": "alice", "displayName": "Builder", "executorKind": "codex"})
    assert response.status_code == 201, response.text
    return response.json()["agent"]


def _home_path(agent_id: str, relative: str) -> str:
    encoded = base64.urlsafe_b64encode(agent_id.encode()).decode().rstrip("=")
    return f"agents/agent-{encoded}/{relative}"


def test_agent_workspace_uses_artifact_snapshot_without_live_placement(monkeypatch, tmp_path):
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    app = create_app(tmp_path)
    client = TestClient(app)
    _bootstrap(client)
    agent = _agent(client)
    session = app.state.session_store.create_session({"workspacePath": "/workspace", "ownerEmployeeId": "alice", "ownerAgentId": agent["id"], "taskGoal": "write report"})
    app.state.session_store.index_workspace_artifact(session["id"], {
        "id": new_relay_id("art"), "kind": "workspace_file", "agentId": agent["id"], "title": "report.md",
        "workspaceRelativePath": _home_path(agent["id"], "report.md"), "createdAt": "2026-07-11T00:00:00Z", "bytes": 5,
    }, b"hello")

    listing = client.get(f"/agents/{agent['id']}/workspace/files")
    assert listing.status_code == 200, listing.text
    assert listing.json()["source"] == "snapshot"
    assert [(entry["name"], entry["kind"]) for entry in listing.json()["entries"]] == [("report.md", "file")]
    file = client.get(f"/agents/{agent['id']}/workspace/file?path=report.md")
    assert file.status_code == 200
    assert file.json()["content"] == "hello"
    assert client.get(f"/agents/{agent['id']}/workspace/file?path=../report.md").status_code == 400
    assert client.get(f"/agents/{agent['id']}/workspace/file?path=missing.md").status_code == 404


def test_live_workspace_timeout_returns_placement_unavailable(monkeypatch, tmp_path):
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    monkeypatch.setattr("relay.api.agent_workspace_routes.WORKSPACE_COMMAND_TIMEOUT_SECONDS", 0.01)
    app = create_app(tmp_path)
    client = TestClient(app)
    _bootstrap(client)
    agent = _agent(client)
    app.state.registry.register({"sandboxId": "node_1", "employeeId": "alice", "token": "node_token", "protocolVersion": 1, "supportedAgents": ["codex"], "capabilities": ["workspace-read"], "status": "ready"})
    app.state.agent_placement_store.create_placement(agent, "node_1", {})
    response = client.get(f"/agents/{agent['id']}/workspace/files")
    assert response.status_code == 503
    assert response.json()["detail"] == {"reason": "placement-unavailable"}


def test_live_workspace_listing_uses_the_selected_placement(monkeypatch, tmp_path):
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    app = create_app(tmp_path)
    client = TestClient(app)
    _bootstrap(client)
    agent = _agent(client)
    app.state.registry.register({"sandboxId": "node_1", "employeeId": "alice", "token": "node_token", "protocolVersion": 1, "supportedAgents": ["codex"], "capabilities": ["workspace-read"], "status": "ready"})
    app.state.agent_placement_store.create_placement(agent, "node_1", {})

    async def listing(_ctx, node, command):
        assert node["id"] == "node_1"
        assert command["type"] == "workspace.list"
        return {"type": "workspace.listing", "path": "", "exists": True, "entries": [{"name": "report.md", "path": "report.md", "kind": "file", "bytes": 5, "updatedAt": "2026-07-11T00:00:00Z"}]}

    monkeypatch.setattr("relay.api.agent_workspace_routes._dispatch", listing)
    response = client.get(f"/agents/{agent['id']}/workspace/files")
    assert response.status_code == 200
    assert response.json()["source"] == "live"
    assert response.json()["nodeId"] == "node_1"
    assert response.json()["entries"][0]["name"] == "report.md"


def test_agent_workspace_requires_supervisor_or_admin(monkeypatch, tmp_path):
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    app = create_app(tmp_path)
    admin = TestClient(app)
    _bootstrap(admin)
    agent = _agent(admin)
    assert admin.post("/cp/users", json={"username": "bob", "password": "userpass", "employeeId": "bob"}).status_code == 201
    bob = TestClient(app)
    assert bob.post("/auth/login", json={"username": "bob", "password": "userpass"}).status_code == 200
    assert bob.get(f"/agents/{agent['id']}/workspace/files").status_code == 403
    assert admin.get("/agents/missing/workspace/files").status_code == 404


def test_workspace_brief_accepts_legacy_agent_employee_id(monkeypatch, tmp_path):
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    app = create_app(tmp_path)
    client = TestClient(app)
    _bootstrap(client)
    agent = _agent(client)
    legacy_agent = {
        **agent,
        "employeeId": agent["supervisorEmployeeId"],
    }
    legacy_agent.pop("supervisorEmployeeId")
    get_agent = app.state.agent_store.get_agent
    monkeypatch.setattr(
        app.state.agent_store,
        "get_agent",
        lambda agent_id: legacy_agent if agent_id == agent["id"] else get_agent(agent_id),
    )

    response = client.get(f"/workspace/brief?agentId={agent['id']}")

    assert response.status_code == 200, response.text
    assert response.json()["employeeId"] == "alice"
