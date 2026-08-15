from __future__ import annotations

import base64
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from relay.app import create_app
from relay.core.computer_identity import computer_id

PNG_BYTES = b"\x89PNG\r\n\x1a\nrelay-profile"
PNG_DATA_URL = "data:image/png;base64," + base64.b64encode(PNG_BYTES).decode("ascii")


def bootstrap(client: TestClient) -> None:
    assert (
        client.post(
            "/api/v1/auth/bootstrap",
            json={"token": "admin_token", "username": "admin", "password": "secret123"},
        ).status_code
        == 200
    )


def employee(client: TestClient, employee_id: str) -> None:
    assert (
        client.post(
            "/api/v1/admin/employees",
            json={
                "employeeId": employee_id,
                "username": employee_id,
                "password": "userpass",
                "displayName": employee_id.title(),
            },
        ).status_code
        == 201
    )


def _agent(client: TestClient, employee_id: str) -> dict:
    # An offline birth-certificate computer: enough to mint a computerId
    # without auto-placing the agent, so callers that manually place it
    # afterward don't hit a duplicate-placement conflict.
    node = client.app.state.registry.register(
        {
            "sandboxId": f"test_node_{employee_id}",
            "employeeId": employee_id,
            "workspaceId": f"machine-{employee_id}",
            "token": "node_token",
            "workspacePath": f"/workspace/{employee_id}",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "capabilities": ["thread-workspaces"],
            "status": "stopped",
        }
    )
    response = client.post(
        "/api/v1/admin/agents",
        json={
            "supervisorEmployeeId": employee_id,
            "displayName": "Builder",
            "executorKind": "codex",
            "defaultRole": "implementer",
            "computerId": computer_id(node),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["agent"]


def test_employee_updates_and_removes_agent_and_team_profile_images(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        bootstrap(client)
        employee(client, "alice")
        agent = _agent(client, "alice")
        client.app.state.agent_placement_store.create_placement(
            agent, "test_node_alice"
        )
        team = client.post(
            "/api/v1/admin/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": agent["id"],
                "memberAgentIds": [agent["id"]],
            },
        ).json()["team"]
        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )

        agent_update = client.put(
            f"/profile-images/agents/{agent['id']}", json={"dataUrl": PNG_DATA_URL}
        )
        team_update = client.put(
            f"/profile-images/teams/{team['id']}", json={"dataUrl": PNG_DATA_URL}
        )

        assert agent_update.status_code == 200
        assert team_update.status_code == 200
        agent_url = agent_update.json()["agent"]["profileImageUrl"]
        team_url = team_update.json()["team"]["profileImageUrl"]
        assert agent_url.startswith(f"/profile-images/agents/{agent['id']}?v=")
        assert team_url.startswith(f"/profile-images/teams/{team['id']}?v=")
        assert client.get(agent_url).content == PNG_BYTES
        assert client.get(team_url).headers["content-type"] == "image/png"
        assert (
            client.get("/api/v1/agents").json()["agents"][0]["profileImageUrl"]
            == agent_url
        )
        assert (
            client.get("/api/v1/teams").json()["teams"][0]["profileImageUrl"]
            == team_url
        )

        removed = client.delete(f"/profile-images/agents/{agent['id']}")
        assert removed.status_code == 200
        assert removed.json()["agent"]["profileImageUrl"] is None
        assert client.get(agent_url).status_code == 404


def test_employee_cannot_update_another_employees_profile_image(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        bootstrap(client)
        employee(client, "alice")
        employee(client, "bob")
        agent = _agent(client, "bob")
        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )

        response = client.put(
            f"/profile-images/agents/{agent['id']}", json={"dataUrl": PNG_DATA_URL}
        )

        assert response.status_code == 403


def test_profile_image_endpoint_rejects_unsupported_data(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        bootstrap(client)
        employee(client, "alice")
        agent = _agent(client, "alice")

        response = client.put(
            f"/profile-images/agents/{agent['id']}",
            json={"dataUrl": "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA=="},
        )

        assert response.status_code == 400
        assert response.json()["detail"] == "profile_image_type"
