from __future__ import annotations

import base64

from fastapi.testclient import TestClient
from relay.app import create_app
from relay.core.computer_identity import computer_id
from relay.core.ids import new_relay_id


def _bootstrap(client: TestClient) -> None:
    assert (
        client.post(
            "/api/v1/auth/bootstrap",
            json={"token": "admin_token", "username": "admin", "password": "secret123"},
        ).status_code
        == 200
    )


def _agent(client: TestClient) -> dict:
    assert (
        client.post(
            "/api/v1/admin/users",
            json={"username": "alice", "password": "userpass", "employeeId": "alice"},
        ).status_code
        == 201
    )
    # An offline birth-certificate computer: enough to mint a computerId
    # without auto-placing the agent, so tests that build their own live
    # placement/node afterward see exactly the placements they create.
    node = client.app.state.registry.register(
        {
            "sandboxId": "offline_node_alice",
            "employeeId": "alice",
            "workspaceId": "machine-alice",
            "token": "node_token",
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "capabilities": ["thread-workspaces"],
            "status": "stopped",
        }
    )
    response = client.post(
        "/api/v1/admin/agents",
        json={
            "supervisorEmployeeId": "alice",
            "displayName": "Builder",
            "executorKind": "codex",
            "defaultRole": "implementer",
            "computerId": computer_id(node),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["agent"]


def _home_path(agent_id: str, relative: str) -> str:
    encoded = base64.urlsafe_b64encode(agent_id.encode()).decode().rstrip("=")
    return f"agents/agent-{encoded}/{relative}"


def test_thread_workspace_uses_its_artifact_snapshot_without_live_placement(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    app = create_app(tmp_path)
    client = TestClient(app)
    _bootstrap(client)
    agent = _agent(client)
    session = app.state.session_store.create_session(
        {
            "workspacePath": "/workspace",
            "ownerEmployeeId": "alice",
            "ownerAgentId": agent["id"],
            "taskGoal": "write report",
        }
    )
    app.state.session_store.index_workspace_artifact(
        session["id"],
        {
            "id": new_relay_id("art"),
            "kind": "workspace_file",
            "agentId": agent["id"],
            "title": "report.md",
            "workspaceRelativePath": _home_path(agent["id"], "report.md"),
            "createdAt": "2026-07-11T00:00:00Z",
            "bytes": 5,
        },
        b"hello",
    )

    assert (
        client.get(f"/api/v1/agents/{agent['id']}/workspace/files").status_code == 400
    )
    listing = client.get(
        f"/api/v1/agents/{agent['id']}/workspace/files?threadId={session['id']}"
    )
    assert listing.status_code == 200, listing.text
    assert listing.json()["source"] == "snapshot"
    assert listing.json()["threadId"] == session["id"]
    assert [(entry["name"], entry["kind"]) for entry in listing.json()["entries"]] == [
        ("report.md", "file")
    ]
    file = client.get(
        f"/api/v1/agents/{agent['id']}/workspace/file"
        f"?threadId={session['id']}&path=report.md"
    )
    assert file.status_code == 200
    assert file.json()["threadId"] == session["id"]
    assert file.json()["content"] == "hello"
    assert (
        client.get(
            f"/api/v1/agents/{agent['id']}/workspace/file"
            f"?threadId={session['id']}&path=../report.md"
        ).status_code
        == 400
    )
    assert (
        client.get(
            f"/api/v1/agents/{agent['id']}/workspace/file"
            f"?threadId={session['id']}&path=missing.md"
        ).status_code
        == 404
    )


def test_thread_snapshot_fallback_does_not_mix_other_threads(monkeypatch, tmp_path):
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    app = create_app(tmp_path)
    client = TestClient(app)
    _bootstrap(client)
    agent = _agent(client)
    selected = app.state.session_store.create_session(
        {
            "workspacePath": "/workspace",
            "ownerEmployeeId": "alice",
            "ownerAgentId": agent["id"],
            "taskGoal": "selected thread",
        }
    )
    other = app.state.session_store.create_session(
        {
            "workspacePath": "/workspace",
            "ownerEmployeeId": "alice",
            "ownerAgentId": agent["id"],
            "taskGoal": "other thread",
        }
    )
    for session, content in ((selected, b"selected"), (other, b"other")):
        app.state.session_store.index_workspace_artifact(
            session["id"],
            {
                "id": new_relay_id("art"),
                "kind": "workspace_file",
                "agentId": agent["id"],
                "title": "report.md",
                "workspaceRelativePath": _home_path(agent["id"], "report.md"),
                "createdAt": "2026-07-11T00:00:00Z",
                "bytes": len(content),
            },
            content,
        )

    response = client.get(
        f"/api/v1/agents/{agent['id']}/workspace/file"
        f"?threadId={selected['id']}&path=report.md"
    )

    assert response.status_code == 200
    assert response.json()["content"] == "selected"


def test_live_workspace_timeout_returns_placement_unavailable(monkeypatch, tmp_path):
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    monkeypatch.setattr(
        "relay.api.agent_workspace_routes.WORKSPACE_COMMAND_TIMEOUT_SECONDS", 0.01
    )
    app = create_app(tmp_path)
    client = TestClient(app)
    _bootstrap(client)
    agent = _agent(client)
    session = app.state.session_store.create_session(
        {
            "workspacePath": "/workspace",
            "ownerEmployeeId": "alice",
            "ownerAgentId": agent["id"],
            "daemonNodeId": "node_1",
            "taskGoal": "live timeout",
        }
    )
    app.state.registry.register(
        {
            "sandboxId": "node_1",
            "employeeId": "alice",
            "token": "node_token",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "capabilities": ["workspace-read", "thread-workspaces"],
            "status": "ready",
        }
    )
    app.state.agent_placement_store.create_placement(agent, "node_1", {})
    response = client.get(
        f"/api/v1/agents/{agent['id']}/workspace/files?threadId={session['id']}"
    )
    assert response.status_code == 503
    assert response.json()["detail"] == {"reason": "placement-unavailable"}


def test_live_workspace_listing_uses_the_selected_placement(monkeypatch, tmp_path):
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    app = create_app(tmp_path)
    client = TestClient(app)
    _bootstrap(client)
    agent = _agent(client)
    session = app.state.session_store.create_session(
        {
            "workspacePath": "/workspace",
            "ownerEmployeeId": "alice",
            "ownerAgentId": agent["id"],
            "daemonNodeId": "node_1",
            "taskGoal": "live files",
        }
    )
    app.state.registry.register(
        {
            "sandboxId": "node_1",
            "employeeId": "alice",
            "token": "node_token",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "capabilities": ["workspace-read", "thread-workspaces"],
            "status": "ready",
        }
    )
    app.state.registry.register(
        {
            "sandboxId": "node_2",
            "employeeId": "alice",
            "token": "node_token_2",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "capabilities": ["workspace-read", "thread-workspaces"],
            "status": "ready",
        }
    )
    app.state.agent_placement_store.create_placement(agent, "node_1", {"priority": 100})
    app.state.agent_placement_store.create_placement(agent, "node_2", {"priority": 1})

    async def listing(_ctx, node, command):
        assert node["id"] == "node_1"
        assert command["type"] == "workspace.list"
        assert command["sessionId"] == session["id"]
        return {
            "type": "workspace.listing",
            "path": "",
            "exists": True,
            "entries": [
                {
                    "name": "report.md",
                    "path": "report.md",
                    "kind": "file",
                    "bytes": 5,
                    "updatedAt": "2026-07-11T00:00:00Z",
                }
            ],
        }

    monkeypatch.setattr("relay.api.agent_workspace_routes._dispatch", listing)
    response = client.get(
        f"/api/v1/agents/{agent['id']}/workspace/files?threadId={session['id']}"
    )
    assert response.status_code == 200
    assert response.json()["source"] == "live"
    assert response.json()["nodeId"] == "node_1"
    assert response.json()["threadId"] == session["id"]
    assert response.json()["entries"][0]["name"] == "report.md"


def test_live_workspace_file_passes_binary_bytes_through(monkeypatch, tmp_path):
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    app = create_app(tmp_path)
    client = TestClient(app)
    _bootstrap(client)
    agent = _agent(client)
    session = app.state.session_store.create_session(
        {
            "workspacePath": "/workspace",
            "ownerEmployeeId": "alice",
            "ownerAgentId": agent["id"],
            "daemonNodeId": "node_1",
            "taskGoal": "live binary",
        }
    )
    app.state.registry.register(
        {
            "sandboxId": "node_1",
            "employeeId": "alice",
            "token": "node_token",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "capabilities": ["workspace-read", "thread-workspaces"],
            "status": "ready",
        }
    )
    app.state.agent_placement_store.create_placement(agent, "node_1", {})
    png = b"\x89PNG\r\n\x1a\n" + bytes(8)

    async def read(_ctx, _node, command):
        assert command["type"] == "workspace.read"
        return {
            "type": "workspace.file",
            "path": "logo.png",
            "bytes": len(png),
            "isBinary": True,
            "truncated": False,
            "contentBase64": base64.b64encode(png).decode(),
        }

    monkeypatch.setattr("relay.api.agent_workspace_routes._dispatch", read)
    response = client.get(
        f"/api/v1/agents/{agent['id']}/workspace/file"
        f"?threadId={session['id']}&path=logo.png"
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["isBinary"] is True
    assert body["content"] is None
    assert base64.b64decode(body["contentBase64"]) == png


def test_shared_scope_lists_the_thread_workspace_root(monkeypatch, tmp_path):
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    app = create_app(tmp_path)
    client = TestClient(app)
    _bootstrap(client)
    agent = _agent(client)
    session = app.state.session_store.create_session(
        {
            "workspacePath": "/workspace",
            "ownerEmployeeId": "alice",
            "ownerAgentId": agent["id"],
            "daemonNodeId": "node_1",
            "taskGoal": "shared thread files",
        }
    )
    app.state.registry.register(
        {
            "sandboxId": "node_1",
            "employeeId": "alice",
            "token": "node_token",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "capabilities": [
                "workspace-read",
                "workspace-read-shared",
                "thread-workspaces",
            ],
            "status": "ready",
        }
    )
    app.state.agent_placement_store.create_placement(agent, "node_1", {})

    async def listing(_ctx, node, command):
        assert node["id"] == "node_1"
        assert command["type"] == "workspace.list"
        assert command["scope"] == "shared"
        assert command["sessionId"] == session["id"]
        return {
            "type": "workspace.listing",
            "path": "",
            "exists": True,
            "entries": [
                {
                    "name": "shared.md",
                    "path": "shared.md",
                    "kind": "file",
                    "bytes": 5,
                    "updatedAt": "2026-07-19T00:00:00Z",
                }
            ],
        }

    monkeypatch.setattr("relay.api.agent_workspace_routes._dispatch", listing)
    response = client.get(
        f"/api/v1/agents/{agent['id']}/workspace/files"
        f"?scope=shared&threadId={session['id']}"
    )
    assert response.status_code == 200, response.text
    assert response.json()["source"] == "live"

    assert response.json()["scope"] == "shared"
    assert response.json()["entries"][0]["name"] == "shared.md"


def test_team_shared_scope_allows_a_current_member_before_its_first_run(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    app = create_app(tmp_path)
    client = TestClient(app)
    _bootstrap(client)
    lead = _agent(client)
    node = client.app.state.registry.register(
        {
            "sandboxId": "offline_node_alice",
            "employeeId": "alice",
            "workspaceId": "machine-alice",
            "token": "node_token",
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["codex", "claude"],
            "capabilities": ["thread-workspaces"],
            "status": "stopped",
        }
    )
    member_response = client.post(
        "/api/v1/admin/agents",
        json={
            "supervisorEmployeeId": "alice",
            "displayName": "Reviewer",
            "executorKind": "claude",
            "defaultRole": "implementer",
            "computerId": computer_id(node),
        },
    )
    assert member_response.status_code == 201, member_response.text
    member = member_response.json()["agent"]
    team = app.state.team_store.create_team(
        "alice",
        {
            "name": "Delivery",
            "leadAgentId": lead["id"],
            "memberAgentIds": [lead["id"], member["id"]],
            "enabled": True,
        },
    )
    session = app.state.session_store.create_session(
        {
            "workspacePath": "/workspace",
            "ownerEmployeeId": "alice",
            "ownerAgentId": lead["id"],
            "teamId": team["id"],
            "daemonNodeId": "node_1",
            "taskGoal": "pending team thread",
        }
    )
    app.state.registry.register(
        {
            "sandboxId": "node_1",
            "employeeId": "alice",
            "token": "node_token",
            "protocolVersion": 1,
            "supportedAgents": ["claude", "codex"],
            "capabilities": ["workspace-read-shared", "thread-workspaces"],
            "status": "ready",
        }
    )
    app.state.agent_placement_store.create_placement(member, "node_1", {})

    async def listing(_ctx, _node, command):
        assert command["sessionId"] == session["id"]
        return {
            "type": "workspace.listing",
            "path": "",
            "exists": True,
            "entries": [],
        }

    monkeypatch.setattr("relay.api.agent_workspace_routes._dispatch", listing)
    response = client.get(
        f"/api/v1/agents/{member['id']}/workspace/files"
        f"?scope=shared&threadId={session['id']}&teamId={team['id']}"
    )

    assert response.status_code == 200, response.text
    assert response.json()["source"] == "live"

    node = client.app.state.registry.register(
        {
            "sandboxId": "offline_node_alice",
            "employeeId": "alice",
            "workspaceId": "machine-alice",
            "token": "node_token",
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["codex", "claude", "pi"],
            "capabilities": ["thread-workspaces"],
            "status": "stopped",
        }
    )
    outsider_response = client.post(
        "/api/v1/admin/agents",
        json={
            "supervisorEmployeeId": "alice",
            "displayName": "Outsider",
            "executorKind": "pi",
            "defaultRole": "implementer",
            "computerId": computer_id(node),
        },
    )
    outsider = outsider_response.json()["agent"]
    denied = client.get(
        f"/api/v1/agents/{outsider['id']}/workspace/files"
        f"?scope=shared&threadId={session['id']}&teamId={team['id']}"
    )
    assert denied.status_code == 404


def test_project_member_reads_shared_project_workspace_before_first_run(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    app = create_app(tmp_path)
    client = TestClient(app)
    _bootstrap(client)
    lead = _agent(client)
    # node_1 isn't registered until later in this test, so these can't go
    # through the HTTP route (it requires a live node for the computerId) —
    # go through the store directly, same as the project below.
    member = app.state.agent_store.create_agent(
        "alice",
        {
            "displayName": "Project reviewer",
            "executorKind": "claude",
            "defaultRole": "reviewer",
            "computerId": "node:node_1",
        },
    )
    outsider = app.state.agent_store.create_agent(
        "alice",
        {
            "displayName": "Project outsider",
            "executorKind": "pi",
            "defaultRole": "implementer",
            "computerId": "node:node_1",
        },
    )
    project = app.state.project_store.create_project(
        "alice",
        {
            "name": "Project room",
            "computerId": "node:node_1",
            "leadAgentId": lead["id"],
            "members": [
                {
                    "agentId": lead["id"],
                    "role": "implementer",
                    "functionTitle": "Lead",
                    "responsibilities": "Own delivery",
                    "enabled": True,
                },
                {
                    "agentId": member["id"],
                    "role": "reviewer",
                    "functionTitle": "Reviewer",
                    "responsibilities": "Review changes",
                    "enabled": True,
                },
            ],
        },
    )
    session = app.state.session_store.create_session(
        {
            "workspacePath": "/workspace",
            "workspaceLayout": "project",
            "workspaceSubpath": project["workspaceSubpath"],
            "projectId": project["id"],
            "computerId": project["computerId"],
            "ownerEmployeeId": "alice",
            # A stale/legacy owner must not grant a non-roster agent access to
            # a project workspace.
            "ownerAgentId": outsider["id"],
            "daemonNodeId": "node_1",
            "taskGoal": "shared project files",
        }
    )
    app.state.registry.register(
        {
            "sandboxId": "node_1",
            "employeeId": "alice",
            "token": "node_token",
            "protocolVersion": 1,
            "supportedAgents": ["claude", "codex"],
            "capabilities": ["workspace-read-shared", "project-workspaces"],
            "status": "ready",
        }
    )

    async def listing(_ctx, node, command):
        assert node["id"] == "node_1"
        assert command["workspaceLayout"] == "project"
        assert command["workspaceSubpath"] == project["workspaceSubpath"]
        assert command["scope"] == "shared"
        return {
            "type": "workspace.listing",
            "path": "",
            "exists": True,
            "entries": [],
        }

    monkeypatch.setattr("relay.api.agent_workspace_routes._dispatch", listing)
    response = client.get(
        f"/api/v1/agents/{member['id']}/workspace/files"
        f"?scope=shared&threadId={session['id']}"
    )

    assert response.status_code == 200, response.text
    assert response.json()["source"] == "live"

    denied = client.get(
        f"/api/v1/agents/{outsider['id']}/workspace/files"
        f"?scope=shared&threadId={session['id']}"
    )
    assert denied.status_code == 404

    app.state.project_store.archive_project(project["id"], expected_version=1)
    historical = client.get(
        f"/api/v1/agents/{member['id']}/workspace/files"
        f"?scope=shared&threadId={session['id']}"
    )
    assert historical.status_code == 200, historical.text


def test_thread_workspace_read_rejects_legacy_daemon(monkeypatch, tmp_path):
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    app = create_app(tmp_path)
    client = TestClient(app)
    _bootstrap(client)
    agent = _agent(client)
    session = app.state.session_store.create_session(
        {
            "workspacePath": "/workspace",
            "ownerEmployeeId": "alice",
            "ownerAgentId": agent["id"],
            "daemonNodeId": "node_legacy",
            "taskGoal": "do not expose the legacy root",
        }
    )
    app.state.registry.register(
        {
            "sandboxId": "node_legacy",
            "employeeId": "alice",
            "token": "node_token",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "capabilities": ["workspace-read", "workspace-read-shared"],
            "status": "ready",
        }
    )
    app.state.agent_placement_store.create_placement(agent, "node_legacy", {})

    async def unexpected_dispatch(*_args, **_kwargs):
        raise AssertionError("legacy daemon must not receive a thread workspace read")

    monkeypatch.setattr(
        "relay.api.agent_workspace_routes._dispatch", unexpected_dispatch
    )
    response = client.get(
        f"/api/v1/agents/{agent['id']}/workspace/files"
        f"?scope=shared&threadId={session['id']}"
    )

    assert response.status_code == 503
    assert response.json()["detail"] == {"reason": "placement-unavailable"}


def test_shared_scope_has_no_snapshot_fallback(monkeypatch, tmp_path):
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    app = create_app(tmp_path)
    client = TestClient(app)
    _bootstrap(client)
    agent = _agent(client)
    session = app.state.session_store.create_session(
        {
            "workspacePath": "/workspace",
            "ownerEmployeeId": "alice",
            "ownerAgentId": agent["id"],
            "taskGoal": "shared files",
        }
    )
    shared_query = f"scope=shared&threadId={session['id']}"

    # No live node at all: shared scope must not fall back to snapshots.
    response = client.get(
        f"/api/v1/agents/{agent['id']}/workspace/files?{shared_query}"
    )
    assert response.status_code == 503
    assert response.json()["detail"] == {"reason": "placement-unavailable"}

    # A live node without the shared-read capability is equally unavailable.
    app.state.registry.register(
        {
            "sandboxId": "node_1",
            "employeeId": "alice",
            "token": "node_token",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "capabilities": ["workspace-read"],
            "status": "ready",
        }
    )
    app.state.agent_placement_store.create_placement(agent, "node_1", {})
    response = client.get(
        f"/api/v1/agents/{agent['id']}/workspace/files?{shared_query}"
    )
    assert response.status_code == 503
    assert response.json()["detail"] == {"reason": "placement-unavailable"}


def test_agent_workspace_requires_supervisor_or_admin(monkeypatch, tmp_path):
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    app = create_app(tmp_path)
    admin = TestClient(app)
    _bootstrap(admin)
    agent = _agent(admin)
    assert (
        admin.post(
            "/api/v1/admin/users",
            json={"username": "bob", "password": "userpass", "employeeId": "bob"},
        ).status_code
        == 201
    )
    bob = TestClient(app)
    assert (
        bob.post(
            "/api/v1/auth/login", json={"username": "bob", "password": "userpass"}
        ).status_code
        == 200
    )
    assert bob.get(f"/api/v1/agents/{agent['id']}/workspace/files").status_code == 403
    assert admin.get("/api/v1/agents/missing/workspace/files").status_code == 404


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
        lambda agent_id: (
            legacy_agent if agent_id == agent["id"] else get_agent(agent_id)
        ),
    )

    response = client.get(f"/api/v1/workspace/brief?agentId={agent['id']}")

    assert response.status_code == 200, response.text
    assert response.json()["employeeId"] == "alice"


def test_agent_workspace_brief_includes_owned_session_before_first_run(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    app = create_app(tmp_path)
    client = TestClient(app)
    _bootstrap(client)
    agent = _agent(client)
    session = app.state.session_store.create_session(
        {
            "workspacePath": "/workspace",
            "ownerEmployeeId": "alice",
            "ownerAgentId": agent["id"],
            "taskGoal": "queued work",
        }
    )

    response = client.get(f"/api/v1/workspace/brief?agentId={agent['id']}")

    assert response.status_code == 200, response.text
    sessions = response.json()["sessions"]
    assert len(sessions) == 1
    assert sessions[0]["id"] == session["id"]
    assert sessions[0]["ownerEmployeeId"] == "alice"
    assert sessions[0]["ownerAgentId"] == agent["id"]
    assert sessions[0]["runCount"] == 0


def test_agent_workspace_brief_lists_every_thread_for_workspace_selection(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    app = create_app(tmp_path)
    client = TestClient(app)
    _bootstrap(client)
    agent = _agent(client)
    created_ids = {
        app.state.session_store.create_session(
            {
                "workspacePath": "/workspace",
                "ownerEmployeeId": "alice",
                "ownerAgentId": agent["id"],
                "taskGoal": f"thread {index}",
            }
        )["id"]
        for index in range(10)
    }

    response = client.get(f"/api/v1/workspace/brief?agentId={agent['id']}")

    assert response.status_code == 200, response.text
    sessions = response.json()["sessions"]
    assert len(sessions) == 10
    assert {session["id"] for session in sessions} == created_ids


def test_agent_workspace_brief_uses_authorized_placements_for_employee(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    app = create_app(tmp_path)
    admin = TestClient(app)
    _bootstrap(admin)
    agent = _agent(admin)
    assert (
        admin.post(
            "/api/v1/admin/users",
            json={"username": "bob", "password": "userpass", "employeeId": "bob"},
        ).status_code
        == 201
    )
    app.state.registry.register(
        {
            "sandboxId": "node_placed",
            "employeeId": "bob",
            "token": "placed_token",
            "nodeLocation": "employee-device",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "status": "ready",
        }
    )
    app.state.registry.register(
        {
            "sandboxId": "node_same_employee_unplaced",
            "employeeId": "alice",
            "token": "unplaced_token",
            "nodeLocation": "employee-device",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "status": "ready",
        }
    )
    app.state.agent_placement_store.create_placement(agent, "node_placed", {})

    alice = TestClient(app)
    assert (
        alice.post(
            "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
        ).status_code
        == 200
    )
    response = alice.get(f"/api/v1/workspace/brief?agentId={agent['id']}")

    assert response.status_code == 200, response.text
    assert [node["id"] for node in response.json()["nodes"]] == ["node_placed"]

    bob = TestClient(app)
    assert (
        bob.post(
            "/api/v1/auth/login", json={"username": "bob", "password": "userpass"}
        ).status_code
        == 200
    )
    assert bob.get(f"/api/v1/workspace/brief?agentId={agent['id']}").status_code == 403


def test_agent_workspace_brief_follows_current_runtime_for_computer(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    app = create_app(tmp_path)
    client = TestClient(app)
    _bootstrap(client)
    agent = _agent(client)
    app.state.registry.register(
        {
            "sandboxId": "runtime_old",
            "employeeId": "alice",
            "workspaceId": "machine-1",
            "token": "old_token",
            "nodeLocation": "employee-device",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "status": "ready",
        }
    )
    placed = client.post(
        f"/api/v1/admin/agents/{agent['id']}/placements",
        json={"daemonNodeId": "runtime_old"},
    )
    assert placed.status_code == 201, placed.text
    app.state.registry.delete("runtime_old")
    app.state.registry.register(
        {
            "sandboxId": "runtime_new",
            "employeeId": "alice",
            "workspaceId": "machine-1",
            "token": "new_token",
            "nodeLocation": "employee-device",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "status": "ready",
        }
    )

    response = client.get(f"/api/v1/workspace/brief?agentId={agent['id']}")

    assert response.status_code == 200, response.text
    assert [node["id"] for node in response.json()["nodes"]] == ["runtime_new"]
