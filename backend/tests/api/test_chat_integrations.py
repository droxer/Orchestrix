from __future__ import annotations

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx
from fastapi.testclient import TestClient

from relay.app import create_app
from relay.chat import DatabaseChatIntegrationStore, LocalChatIntegrationStore
from relay.chat.provider_health import probe_chat_integration


async def _healthy_provider(_settings):
    return True, "Provider credentials verified."


def test_provider_probe_uses_telegram_get_me() -> None:
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"ok": True}, request=request))

    async def run_probe():
        async with httpx.AsyncClient(transport=transport) as client:
            return await probe_chat_integration({
                "provider": "telegram",
                "secrets": {"botToken": "token", "webhookSecret": "webhook"},
            }, client)

    assert asyncio.run(run_probe()) == (True, "Provider credentials verified.")


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
        client.app.state.chat_probe = _healthy_provider
        _bootstrap_admin(client)
        _login(client, "admin", "secret123")
        assert client.post("/cp/users", json={
            "username": "alice",
            "password": "AlicePass123!",
            "employeeId": "alice",
            "displayName": "Alice",
        }).status_code == 201
        agent = client.post(
            "/cp/employees/alice/agents",
            json={"displayName": "Chat agent", "executorKind": "codex"},
        ).json()["agent"]

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
            "defaultAgentId": agent["id"],
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

        runtime = client.get(
            "/chat/integrations/runtime",
            headers={"Authorization": "Bearer chat_secret"},
        )
        assert runtime.status_code == 200
        assert runtime.json()["integrations"][0]["secrets"]["botToken"] == "discord-secret-token"

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
        assert resolved.json()["identity"]["defaultAgentId"] == agent["id"]

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


def test_chat_integration_check_rejects_invalid_provider_credentials(monkeypatch) -> None:
    async def invalid_provider(_settings):
        return False, "Provider rejected the configured credentials."

    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        client.app.state.chat_probe = invalid_provider
        _bootstrap_admin(client)
        _login(client, "admin", "secret123")
        assert client.post("/cp/users", json={
            "username": "alice",
            "password": "AlicePass123!",
            "employeeId": "alice",
        }).status_code == 201
        integration_id = client.post("/cp/chat-integrations", json={
            "provider": "telegram",
            "displayName": "Operations Telegram",
            "secrets": {"botToken": "invalid"},
        }).json()["integration"]["id"]
        client.post(f"/cp/chat-integrations/{integration_id}/identity-links", json={
            "externalUserId": "42", "employeeId": "alice",
        })
        client.post(f"/cp/chat-integrations/{integration_id}/allowed-conversations", json={
            "conversationId": "-100",
        })

        check = client.post(f"/cp/chat-integrations/{integration_id}/check")
        activate = client.post(f"/cp/chat-integrations/{integration_id}/activate")

        assert check.status_code == 200
        assert check.json()["integration"]["health"] == {
            "ok": False,
            "message": "Provider rejected the configured credentials.",
            "lastCheckedAt": check.json()["integration"]["health"]["lastCheckedAt"],
        }
        assert activate.status_code == 400


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


def test_database_chat_integration_store_encrypts_secrets(monkeypatch) -> None:
    from cryptography.fernet import Fernet

    monkeypatch.setenv("RELAY_CHAT_SECRET_KEY", Fernet.generate_key().decode())
    with TemporaryDirectory() as root:
        store = DatabaseChatIntegrationStore(f"sqlite:///{root}/chat.db", create_schema=True)
        integration = store.create_integration({
            "provider": "discord",
            "displayName": "Engineering Discord",
            "secrets": {"botToken": "secret-token"},
        }, actor="admin")
        store.add_identity_link(integration["id"], {"externalUserId": "u1", "employeeId": "alice"})
        store.add_allowed_conversation(integration["id"], {"conversationId": "c1"})
        store.check_integration(integration["id"], provider_health=(True, "Provider credentials verified."))
        activated = store.activate_integration(integration["id"], actor="admin")

        assert activated["status"] == "active"
        assert store.resolve_identity({
            "provider": "discord",
            "externalUserId": "u1",
            "conversationId": "c1",
        })["employeeId"] == "alice"
        assert store.audit_events(integration["id"])[-1]["type"] == "chat.integration.activated"
        assert not (Path(root) / "chat").exists()
        with store.engine.begin() as connection:
            encrypted = connection.execute(
                store.documents.select().where(store.documents.c.document_key == "secrets")
            ).mappings().one()["payload"]
        assert "secret-token" not in json.dumps(encrypted)
