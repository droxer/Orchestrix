from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from relay.app import create_app
from relay.chat_integrations import LocalChatIntegrationStore


def _bootstrap_admin(client: TestClient) -> None:
    response = client.post("/auth/bootstrap", json={
        "token": "admin_token",
        "username": "admin",
        "password": "secret123",
    })
    assert response.status_code == 200


def _login(client: TestClient, username: str, password: str) -> None:
    response = client.post("/auth/login", json={
        "username": username,
        "password": password,
    })
    assert response.status_code == 200


def test_chat_integration_setup_flow_redacts_secrets(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    monkeypatch.setenv("RELAY_CHAT_TOKEN", "chat_secret")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login(client, "admin", "secret123")

        create = client.post("/cp/chat-integrations", json={
            "provider": "discord",
            "displayName": "Engineering Discord",
            "tenantId": "guild_123",
            "config": {"commandName": "relay"},
            "secrets": {"botToken": "discord-secret-token"},
        })
        assert create.status_code == 201
        integration = create.json()["integration"]
        integration_id = integration["id"]
        assert integration["provider"] == "discord"
        assert integration["status"] == "draft"
        assert integration["secretConfigured"] is True
        assert integration["secretKeys"] == ["botToken"]
        assert "discord-secret-token" not in create.text

        check = client.post(f"/cp/chat-integrations/{integration_id}/check")
        assert check.status_code == 200
        assert check.json()["integration"]["status"] == "degraded"

        activate = client.post(f"/cp/chat-integrations/{integration_id}/activate")
        assert activate.status_code == 400
        assert "identity link" in activate.json()["detail"]

        link = client.post(f"/cp/chat-integrations/{integration_id}/identity-links", json={
            "externalUserId": "discord_user_1",
            "employeeId": "alice",
            "displayName": "Alice",
            "defaultSandboxId": "sbx_alice",
        })
        assert link.status_code == 201
        assert link.json()["integration"]["identityLinkCount"] == 1

        conversation = client.post(f"/cp/chat-integrations/{integration_id}/allowed-conversations", json={
            "conversationId": "channel_123",
            "label": "team-agents",
        })
        assert conversation.status_code == 201
        assert conversation.json()["integration"]["allowedConversationCount"] == 1

        check = client.post(f"/cp/chat-integrations/{integration_id}/check")
        assert check.status_code == 200
        assert check.json()["integration"]["health"]["ok"] is True

        activate = client.post(f"/cp/chat-integrations/{integration_id}/activate")
        assert activate.status_code == 200
        assert activate.json()["integration"]["status"] == "active"
        assert "discord-secret-token" not in activate.text

        resolved = client.post(
            "/chat/identity/resolve",
            headers={"Authorization": "Bearer chat_secret"},
            json={
                "provider": "discord",
                "tenantId": "guild_123",
                "externalUserId": "discord_user_1",
                "conversationId": "channel_123",
            },
        )
        assert resolved.status_code == 200
        assert resolved.json()["identity"]["employeeId"] == "alice"

        disallowed = client.post(
            "/chat/identity/resolve",
            headers={"Authorization": "Bearer chat_secret"},
            json={
                "provider": "discord",
                "tenantId": "guild_123",
                "externalUserId": "discord_user_1",
                "conversationId": "channel_elsewhere",
            },
        )
        assert disallowed.status_code == 404

        listing = client.get("/cp/chat-integrations")
        assert listing.status_code == 200
        assert listing.json()["integrations"][0]["id"] == integration_id
        assert "discord-secret-token" not in listing.text

        audit = client.get(f"/cp/chat-integrations/{integration_id}/audit")
        assert audit.status_code == 200
        assert [event["type"] for event in audit.json()["events"]][-1] == "chat.integration.activated"


def test_chat_integrations_require_admin(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        admin_client = TestClient(app)
        _bootstrap_admin(admin_client)
        _login(admin_client, "admin", "secret123")

        response = admin_client.post("/cp/users", json={
            "username": "alice",
            "password": "userpass",
            "role": "user",
        })
        assert response.status_code == 201

        user_client = TestClient(app)
        _login(user_client, "alice", "userpass")
        response = user_client.get("/cp/chat-integrations")
        assert response.status_code == 403


def test_chat_integration_store_serializes_concurrent_creates() -> None:
    with TemporaryDirectory() as root:
        store = LocalChatIntegrationStore(root)

        def create(index: int) -> str:
            integration = store.create_integration({
                "provider": "discord",
                "displayName": f"Discord {index}",
                "secrets": {"botToken": f"secret-{index}"},
            })
            return integration["id"]

        with ThreadPoolExecutor(max_workers=8) as pool:
            ids = list(pool.map(create, range(20)))

        integrations = store.list_integrations()
        assert len(integrations) == 20
        assert {item["id"] for item in integrations} == set(ids)
        assert all(item["secretConfigured"] for item in integrations)
