from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

CollaborationPurpose = Literal["accomplish", "discuss", "review"]
RecoveryKind = Literal["rerun", "handoff"]
COLLABORATION_MANIFEST_STATE_KEY = "_relay_collaboration_manifest"


@dataclass(frozen=True)
class MessageIntent:
    thread_id: str
    text: str
    purpose: CollaborationPurpose = "accomplish"
    address_agent_id: str | None = None
    idempotency_key: str | None = None
    user_message_id: str | None = None


@dataclass(frozen=True)
class RecoveryIntent:
    thread_id: str
    kind: RecoveryKind
    target_agent_id: str
    mode: str = "action"
    note: str | None = None
    idempotency_key: str | None = None


@dataclass(frozen=True)
class RunIntent:
    """Compatibility input while legacy callers migrate off assignments."""

    task_goal: str
    session_id: str | None
    raw_assignments: list[dict[str, Any]] | None
    mode: str = "action"
    requested_node_id: str | None = None
    idempotency_key: str | None = None
    user_message_id: str | None = None
    decision: dict[str, Any] | None = None
    source: str = "legacy"
