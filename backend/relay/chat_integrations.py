from __future__ import annotations

import json
from pathlib import Path
from threading import RLock
from typing import Any, Literal

from .ids import new_relay_id, now_iso
from .store_common import _append_jsonl, _read_json, _write_json

ChatProvider = Literal["discord", "telegram", "lark"]
ChatIntegrationStatus = Literal["draft", "active", "degraded", "disabled"]

CHAT_PROVIDERS = {"discord", "telegram", "lark"}
CHAT_STATUSES = {"draft", "active", "degraded", "disabled"}

SECRET_FIELDS = {
    "botToken",
    "clientSecret",
    "signingSecret",
    "webhookSecret",
    "appSecret",
    "verificationToken",
    "encryptKey",
}


class LocalChatIntegrationStore:
    """Local chat integration configuration store.

    Provider credentials live in a separate 0600 JSON file and are never
    returned through the public admin API. Production deployments can keep the
    same shape while swapping this implementation for database + KMS storage.
    """

    def __init__(self, root_dir: str | Path):
        root = Path(root_dir) / "chat"
        self._lock = RLock()
        self.integrations_path = root / "integrations.json"
        self.secrets_path = root / "secrets.json"
        self.audit_path = root / "audit.jsonl"
        # Persistent conversation -> session bindings so a chat thread resumes
        # the right Relay session across bot restarts, and so one user can run
        # several conversations in parallel from different threads.
        self.conversations_path = root / "conversations.json"

    def list_integrations(self) -> list[dict[str, Any]]:
        with self._lock:
            integrations = self._read_integrations()
            return [self._public_integration(integration) for integration in integrations]

    def get_integration(self, integration_id: str) -> dict[str, Any]:
        with self._lock:
            integration = self._find_integration(integration_id)
            return self._public_integration(integration)

    def create_integration(self, payload: dict[str, Any], actor: str | None = None) -> dict[str, Any]:
        with self._lock:
            provider = _provider(payload.get("provider"))
            now = now_iso()
            integration = {
                "id": new_relay_id("chat"),
                "provider": provider,
                "displayName": _string(payload.get("displayName")) or provider.title(),
                "tenantId": _string(payload.get("tenantId")),
                "status": "draft",
                "config": _public_config(payload.get("config")),
                "health": {
                    "ok": False,
                    "message": "Not checked yet.",
                    "lastCheckedAt": None,
                },
                "identityLinks": [],
                "allowedConversations": [],
                "createdAt": now,
                "updatedAt": now,
            }
            integrations = self._read_integrations()
            integrations.append(integration)
            self._write_integrations(integrations)
            self._write_secret_patch(integration["id"], payload.get("secrets"))
            self._audit("chat.integration.created", integration["id"], actor, {"provider": provider})
            return self._public_integration(integration)

    def update_integration(self, integration_id: str, payload: dict[str, Any], actor: str | None = None) -> dict[str, Any]:
        with self._lock:
            integrations = self._read_integrations()
            for index, integration in enumerate(integrations):
                if integration.get("id") != integration_id:
                    continue
                updated = dict(integration)
                if "displayName" in payload:
                    display_name = _string(payload.get("displayName"))
                    if not display_name:
                        raise ValueError("displayName is required.")
                    updated["displayName"] = display_name
                if "tenantId" in payload:
                    updated["tenantId"] = _string(payload.get("tenantId"))
                if "status" in payload:
                    updated["status"] = _status(payload.get("status"))
                if "config" in payload:
                    updated["config"] = _public_config(payload.get("config"))
                updated["updatedAt"] = now_iso()
                integrations[index] = updated
                self._write_integrations(integrations)
                self._write_secret_patch(integration_id, payload.get("secrets"))
                self._audit("chat.integration.updated", integration_id, actor, {"fields": sorted(payload.keys())})
                return self._public_integration(updated)
            raise KeyError(integration_id)

    def activate_integration(self, integration_id: str, actor: str | None = None) -> dict[str, Any]:
        with self._lock:
            integrations = self._read_integrations()
            for index, integration in enumerate(integrations):
                if integration.get("id") != integration_id:
                    continue
                public = self._public_integration(integration)
                if public["identityLinkCount"] == 0:
                    raise ValueError("Add at least one identity link before activation.")
                if public["allowedConversationCount"] == 0:
                    raise ValueError("Add at least one allowed conversation before activation.")
                if not public["secretConfigured"]:
                    raise ValueError("Configure provider secrets before activation.")
                updated = {**integration, "status": "active", "updatedAt": now_iso()}
                integrations[index] = updated
                self._write_integrations(integrations)
                self._audit("chat.integration.activated", integration_id, actor, {})
                return self._public_integration(updated)
            raise KeyError(integration_id)

    def check_integration(self, integration_id: str, actor: str | None = None) -> dict[str, Any]:
        with self._lock:
            integrations = self._read_integrations()
            for index, integration in enumerate(integrations):
                if integration.get("id") != integration_id:
                    continue
                public = self._public_integration(integration)
                checks = []
                if public["secretConfigured"]:
                    checks.append("secrets")
                if public["identityLinkCount"] > 0:
                    checks.append("identity links")
                if public["allowedConversationCount"] > 0:
                    checks.append("allowed conversations")
                ok = len(checks) == 3
                missing = [label for label in ("secrets", "identity links", "allowed conversations") if label not in checks]
                updated = {
                    **integration,
                    "status": integration.get("status") if ok else "degraded",
                    "health": {
                        "ok": ok,
                        "message": "Ready for provider traffic." if ok else f"Missing {', '.join(missing)}.",
                        "lastCheckedAt": now_iso(),
                    },
                    "updatedAt": now_iso(),
                }
                integrations[index] = updated
                self._write_integrations(integrations)
                self._audit("chat.integration.checked", integration_id, actor, {"ok": ok})
                return self._public_integration(updated)
            raise KeyError(integration_id)

    def add_identity_link(self, integration_id: str, payload: dict[str, Any], actor: str | None = None) -> dict[str, Any]:
        with self._lock:
            external_user_id = _required_string(payload.get("externalUserId"), "externalUserId")
            employee_id = _required_string(payload.get("employeeId"), "employeeId")
            link = {
                "id": new_relay_id("cil"),
                "externalUserId": external_user_id,
                "employeeId": employee_id,
                "displayName": _string(payload.get("displayName")),
                "defaultSandboxId": _string(payload.get("defaultSandboxId")),
                "createdAt": now_iso(),
                "updatedAt": now_iso(),
            }
            integration = self._mutate_collection(integration_id, "identityLinks", link)
            self._audit("chat.identity_link.created", integration_id, actor, {"employeeId": employee_id})
            return self._public_integration(integration)

    def delete_identity_link(self, integration_id: str, link_id: str, actor: str | None = None) -> dict[str, Any]:
        with self._lock:
            integration = self._delete_collection_item(integration_id, "identityLinks", link_id)
            self._audit("chat.identity_link.deleted", integration_id, actor, {"linkId": link_id})
            return self._public_integration(integration)

    def add_allowed_conversation(self, integration_id: str, payload: dict[str, Any], actor: str | None = None) -> dict[str, Any]:
        with self._lock:
            conversation_id = _required_string(payload.get("conversationId"), "conversationId")
            conversation = {
                "id": new_relay_id("cac"),
                "conversationId": conversation_id,
                "threadId": _string(payload.get("threadId")),
                "label": _string(payload.get("label")) or conversation_id,
                "createdAt": now_iso(),
                "updatedAt": now_iso(),
            }
            integration = self._mutate_collection(integration_id, "allowedConversations", conversation)
            self._audit("chat.allowed_conversation.created", integration_id, actor, {"conversationId": conversation_id})
            return self._public_integration(integration)

    def delete_allowed_conversation(self, integration_id: str, conversation_record_id: str, actor: str | None = None) -> dict[str, Any]:
        with self._lock:
            integration = self._delete_collection_item(integration_id, "allowedConversations", conversation_record_id)
            self._audit("chat.allowed_conversation.deleted", integration_id, actor, {"conversationRecordId": conversation_record_id})
            return self._public_integration(integration)

    def audit_events(self, integration_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            if not self.audit_path.exists():
                return []
            events = [
                json.loads(line)
                for line in self.audit_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            if integration_id:
                events = [event for event in events if event.get("integrationId") == integration_id]
            return events[-max(1, min(limit, 200)):]

    def resolve_identity(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        with self._lock:
            provider = _provider(payload.get("provider"))
            tenant_id = _string(payload.get("tenantId"))
            external_user_id = _required_string(payload.get("externalUserId"), "externalUserId")
            conversation_id = _required_string(payload.get("conversationId"), "conversationId")
            thread_id = _string(payload.get("threadId"))

            for integration in self._read_integrations():
                if integration.get("provider") != provider or integration.get("status") != "active":
                    continue
                if integration.get("tenantId") and integration.get("tenantId") != tenant_id:
                    continue
                allowed = _conversation_allowed(integration, conversation_id, thread_id)
                if not allowed:
                    continue
                link = _identity_link(integration, external_user_id)
                if not link:
                    continue
                return {
                    "integrationId": integration["id"],
                    "provider": provider,
                    "tenantId": integration.get("tenantId"),
                    "employeeId": link["employeeId"],
                    "displayName": link.get("displayName"),
                    "defaultSandboxId": link.get("defaultSandboxId"),
                }
            return None

    def get_conversation_session(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        """Return the session binding for a conversation thread, if any."""
        with self._lock:
            key = _conversation_key(payload)
            for record in self._read_conversations():
                if record.get("key") == key:
                    return record
            return None

    def set_conversation_session(self, payload: dict[str, Any], session_id: str, owner_employee_id: str) -> dict[str, Any]:
        """Bind a conversation thread to a Relay session (upsert by thread key)."""
        with self._lock:
            key = _conversation_key(payload)
            now = now_iso()
            records = self._read_conversations()
            for index, record in enumerate(records):
                if record.get("key") == key:
                    updated = {**record, "sessionId": session_id, "ownerEmployeeId": owner_employee_id, "updatedAt": now}
                    records[index] = updated
                    self._write_conversations(records)
                    return updated
            record = {
                "key": key,
                "provider": _provider(payload.get("provider")),
                "tenantId": _string(payload.get("tenantId")),
                "conversationId": _required_string(payload.get("conversationId"), "conversationId"),
                "threadId": _string(payload.get("threadId")),
                "sessionId": session_id,
                "ownerEmployeeId": owner_employee_id,
                "createdAt": now,
                "updatedAt": now,
            }
            records.append(record)
            self._write_conversations(records)
            return record

    def _read_conversations(self) -> list[dict[str, Any]]:
        if not self.conversations_path.exists():
            return []
        value = _read_json(self.conversations_path)
        return value if isinstance(value, list) else []

    def _write_conversations(self, records: list[dict[str, Any]]) -> None:
        _write_json(self.conversations_path, records)

    def _read_integrations(self) -> list[dict[str, Any]]:
        if not self.integrations_path.exists():
            return []
        value = _read_json(self.integrations_path)
        return value if isinstance(value, list) else []

    def _write_integrations(self, integrations: list[dict[str, Any]]) -> None:
        _write_json(self.integrations_path, integrations)

    def _read_secrets(self) -> dict[str, dict[str, str]]:
        if not self.secrets_path.exists():
            return {}
        value = _read_json(self.secrets_path)
        return value if isinstance(value, dict) else {}

    def _write_secret_patch(self, integration_id: str, raw: Any) -> None:
        if not isinstance(raw, dict):
            return
        patch = {
            str(key): str(value)
            for key, value in raw.items()
            if key in SECRET_FIELDS and value is not None and str(value).strip()
        }
        if not patch:
            return
        secrets = self._read_secrets()
        current = secrets.get(integration_id, {})
        secrets[integration_id] = {**current, **patch}
        _write_json(self.secrets_path, secrets, mode=0o600)

    def _find_integration(self, integration_id: str) -> dict[str, Any]:
        for integration in self._read_integrations():
            if integration.get("id") == integration_id:
                return integration
        raise KeyError(integration_id)

    def _public_integration(self, integration: dict[str, Any]) -> dict[str, Any]:
        secrets = self._read_secrets().get(str(integration.get("id")), {})
        identity_links = integration.get("identityLinks") if isinstance(integration.get("identityLinks"), list) else []
        allowed_conversations = integration.get("allowedConversations") if isinstance(integration.get("allowedConversations"), list) else []
        return {
            **integration,
            "secretConfigured": bool(secrets),
            "secretKeys": sorted(secrets.keys()),
            "identityLinkCount": len(identity_links),
            "allowedConversationCount": len(allowed_conversations),
        }

    def _mutate_collection(self, integration_id: str, collection: str, record: dict[str, Any]) -> dict[str, Any]:
        integrations = self._read_integrations()
        for index, integration in enumerate(integrations):
            if integration.get("id") != integration_id:
                continue
            existing = integration.get(collection) if isinstance(integration.get(collection), list) else []
            updated = {**integration, collection: [record, *existing], "updatedAt": now_iso()}
            integrations[index] = updated
            self._write_integrations(integrations)
            return updated
        raise KeyError(integration_id)

    def _delete_collection_item(self, integration_id: str, collection: str, record_id: str) -> dict[str, Any]:
        integrations = self._read_integrations()
        for index, integration in enumerate(integrations):
            if integration.get("id") != integration_id:
                continue
            existing = integration.get(collection) if isinstance(integration.get(collection), list) else []
            updated_items = [item for item in existing if item.get("id") != record_id]
            if len(updated_items) == len(existing):
                raise KeyError(record_id)
            updated = {**integration, collection: updated_items, "updatedAt": now_iso()}
            integrations[index] = updated
            self._write_integrations(integrations)
            return updated
        raise KeyError(integration_id)

    def _audit(self, event_type: str, integration_id: str, actor: str | None, payload: dict[str, Any]) -> None:
        _append_jsonl(self.audit_path, {
            "id": new_relay_id("cae"),
            "type": event_type,
            "integrationId": integration_id,
            "actor": actor,
            "timestamp": now_iso(),
            **payload,
        })


def _provider(value: Any) -> ChatProvider:
    if value not in CHAT_PROVIDERS:
        raise ValueError("provider must be discord, telegram, or lark.")
    return value


def _status(value: Any) -> ChatIntegrationStatus:
    if value not in CHAT_STATUSES:
        raise ValueError("status must be draft, active, degraded, or disabled.")
    return value


def _string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _required_string(value: Any, field: str) -> str:
    text = _string(value)
    if not text:
        raise ValueError(f"{field} is required.")
    return text


def _public_config(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return {
        str(key): item
        for key, item in value.items()
        if key not in SECRET_FIELDS and item is not None and not isinstance(item, (dict, list))
    }


def _conversation_key(payload: dict[str, Any]) -> str:
    provider = _provider(payload.get("provider"))
    tenant_id = _string(payload.get("tenantId")) or ""
    conversation_id = _required_string(payload.get("conversationId"), "conversationId")
    thread_id = _string(payload.get("threadId")) or ""
    return "::".join([provider, tenant_id, conversation_id, thread_id])


def _conversation_allowed(integration: dict[str, Any], conversation_id: str, thread_id: str | None) -> bool:
    allowed = integration.get("allowedConversations") if isinstance(integration.get("allowedConversations"), list) else []
    for record in allowed:
        if record.get("conversationId") != conversation_id:
            continue
        required_thread = record.get("threadId")
        if required_thread and required_thread != thread_id:
            continue
        return True
    return False


def _identity_link(integration: dict[str, Any], external_user_id: str) -> dict[str, Any] | None:
    links = integration.get("identityLinks") if isinstance(integration.get("identityLinks"), list) else []
    return next((link for link in links if link.get("externalUserId") == external_user_id), None)
