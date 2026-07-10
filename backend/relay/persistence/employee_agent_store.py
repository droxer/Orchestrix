from __future__ import annotations

from pathlib import Path
from threading import RLock
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    JSON,
    MetaData,
    Table,
    Text,
    UniqueConstraint,
    Uuid,
    create_engine,
    insert,
    select,
    update,
)
from sqlalchemy.exc import IntegrityError

from ..core.ids import new_database_id, new_relay_id, now_iso
from ..core.models import AGENT_NAMES, AGENT_ROLES
from .store_common import (
    DEFAULT_RELAY_DATA_DIR,
    _append_jsonl,
    _format_iso,
    _parse_iso,
    _read_json,
    _read_jsonl,
    _write_json,
    database_id_column,
    safe_name,
)


class LocalEmployeeAgentStore:
    """Event-sourced logical agents owned by employees."""

    def __init__(self, root_dir: str | Path = DEFAULT_RELAY_DATA_DIR):
        self.root = Path(root_dir) / "agents"
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()

    def create_agent(self, employee_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        agent = _new_agent(employee_id, payload)
        with self._lock:
            self._ensure_unique_name(agent["employeeId"], agent["displayName"])
            self._append(agent["id"], "agent.created", {"agent": agent})
            return agent

    def ensure_compatibility_agent(
        self, employee_id: str, executor_kind: str
    ) -> dict[str, Any]:
        if executor_kind not in AGENT_NAMES:
            raise ValueError(f"executorKind must be one of: {', '.join(AGENT_NAMES)}.")
        with self._lock:
            existing = next(
                (
                    agent
                    for agent in self.list_agents(employee_id=employee_id)
                    if (
                        agent["executorKind"] == executor_kind
                        and agent.get("compatibilityKey")
                        == f"{employee_id}:{executor_kind}"
                    )
                ),
                None,
            )
            if existing:
                return existing
            agent = self.create_agent(
                employee_id,
                {
                    "displayName": _compatibility_display_name(
                        self.list_agents(employee_id=employee_id), executor_kind
                    ),
                    "executorKind": executor_kind,
                },
            )
            return self.update_agent(
                agent["id"], {"compatibilityKey": f"{employee_id}:{executor_kind}"}
            )

    def get_agent(self, agent_id: str) -> dict[str, Any] | None:
        snapshot = self._snapshot_path(agent_id)
        return _read_json(snapshot) if snapshot.exists() else None

    def list_agents(
        self, *, employee_id: str | None = None, include_deleted: bool = False
    ) -> list[dict[str, Any]]:
        agents = [_read_json(path) for path in self.root.glob("*/snapshot.json")]
        if employee_id is not None:
            agents = [
                agent for agent in agents if agent.get("employeeId") == employee_id
            ]
        if not include_deleted:
            agents = [agent for agent in agents if not agent.get("deletedAt")]
        return sorted(
            agents,
            key=lambda agent: (
                agent.get("employeeId") or "",
                agent.get("displayName", "").casefold(),
                agent["id"],
            ),
        )

    def update_agent(self, agent_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        allowed = {
            "displayName",
            "defaultRole",
            "instructions",
            "skillPolicy",
            "toolPolicy",
            "modelPolicy",
            "enabled",
            "compatibilityKey",
        }
        unknown = set(patch) - allowed
        if unknown:
            raise ValueError(
                f"Unsupported agent field(s): {', '.join(sorted(unknown))}."
            )
        with self._lock:
            current = self.get_agent(agent_id)
            if not current or current.get("deletedAt"):
                raise KeyError(agent_id)
            normalized: dict[str, Any] = {}
            if "displayName" in patch:
                display_name = _required_string(patch, "displayName")
                self._ensure_unique_name(
                    current["employeeId"], display_name, exclude_id=agent_id
                )
                normalized["displayName"] = display_name
            if "defaultRole" in patch:
                role = _required_string(patch, "defaultRole")
                if role not in AGENT_ROLES:
                    raise ValueError(
                        f"defaultRole must be one of: {', '.join(AGENT_ROLES)}."
                    )
                normalized["defaultRole"] = role
            if "instructions" in patch:
                normalized["instructions"] = (
                    patch["instructions"].strip()
                    if isinstance(patch["instructions"], str)
                    else ""
                )
            for field in ("skillPolicy", "toolPolicy", "modelPolicy"):
                if field in patch:
                    normalized[field] = _policy(patch, field)
            if "enabled" in patch:
                if not isinstance(patch["enabled"], bool):
                    raise ValueError("enabled must be a boolean.")
                normalized["enabled"] = patch["enabled"]
            if "compatibilityKey" in patch:
                normalized["compatibilityKey"] = _required_string(
                    patch, "compatibilityKey"
                )
            placement_fields = {
                "instructions",
                "skillPolicy",
                "toolPolicy",
                "modelPolicy",
            }
            version = int(current.get("version") or 1) + (
                1 if placement_fields.intersection(normalized) else 0
            )
            updated = {
                **current,
                **normalized,
                "version": version,
                "updatedAt": now_iso(),
            }
            event_type = "agent.updated"
            if normalized.get("enabled") is False:
                event_type = "agent.disabled"
            elif normalized.get("enabled") is True and not current.get("enabled", True):
                event_type = "agent.enabled"
            self._append(agent_id, event_type, {"patch": normalized, "agent": updated})
            return updated

    def delete_agent(self, agent_id: str) -> dict[str, Any]:
        with self._lock:
            current = self.get_agent(agent_id)
            if not current or current.get("deletedAt"):
                raise KeyError(agent_id)
            updated = {
                **current,
                "enabled": False,
                "deletedAt": now_iso(),
                "updatedAt": now_iso(),
            }
            self._append(agent_id, "agent.deleted", {"agent": updated})
            return updated

    def events(self, agent_id: str) -> list[dict[str, Any]]:
        return _read_jsonl(self._events_path(agent_id))

    def _ensure_unique_name(
        self, employee_id: str, display_name: str, *, exclude_id: str | None = None
    ) -> None:
        duplicate = next(
            (
                agent
                for agent in self.list_agents(employee_id=employee_id)
                if (
                    agent["id"] != exclude_id
                    and agent.get("displayName", "").casefold()
                    == display_name.casefold()
                )
            ),
            None,
        )
        if duplicate:
            raise ValueError(
                f"Employee {employee_id} already has an agent named {display_name}."
            )

    def _append(self, agent_id: str, event_type: str, payload: dict[str, Any]) -> None:
        event = {
            "id": new_relay_id("evt"),
            "type": event_type,
            "agentId": agent_id,
            "timestamp": now_iso(),
            **payload,
        }
        _append_jsonl(self._events_path(agent_id), event)
        _write_json(self._snapshot_path(agent_id), payload["agent"])

    def _events_path(self, agent_id: str) -> Path:
        return self.root / safe_name(agent_id) / "events.jsonl"

    def _snapshot_path(self, agent_id: str) -> Path:
        return self.root / safe_name(agent_id) / "snapshot.json"


class DatabaseEmployeeAgentStore:
    metadata = MetaData()
    agents = Table(
        "employee_agents",
        metadata,
        database_id_column(),
        Column("public_id", Text, nullable=False, unique=True),
        Column("employee_public_id", Text, nullable=False, index=True),
        Column("display_name", Text, nullable=False),
        Column("display_name_key", Text, nullable=True),
        Column("executor_kind", Text, nullable=False),
        Column("compatibility_key", Text, nullable=True, unique=True),
        Column("enabled", Boolean, nullable=False),
        Column("agent_version", BigInteger, nullable=False),
        Column("snapshot", JSON, nullable=False),
        Column("event_version", BigInteger, nullable=False),
        Column("created_at", DateTime(timezone=True), nullable=False),
        Column("updated_at", DateTime(timezone=True), nullable=False),
        Column("deleted_at", DateTime(timezone=True), nullable=True),
        UniqueConstraint(
            "employee_public_id",
            "display_name_key",
            name="uq_employee_agents_employee_display_name_key",
        ),
    )
    events_table = Table(
        "employee_agent_events",
        metadata,
        database_id_column(),
        Column("public_id", Text, nullable=False, unique=True),
        Column(
            "agent_id",
            Uuid(as_uuid=False),
            ForeignKey("employee_agents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        Column("sequence", BigInteger, nullable=False),
        Column("type", Text, nullable=False),
        Column("timestamp", DateTime(timezone=True), nullable=False),
        Column("payload", JSON, nullable=False),
    )

    def __init__(self, database_url: str, *, create_schema: bool = False):
        self.engine = create_engine(database_url, future=True)
        if create_schema:
            self.metadata.create_all(self.engine)

    def create_agent(self, employee_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        agent = _new_agent(employee_id, payload)
        self._ensure_unique_name(agent["employeeId"], agent["displayName"])
        event = _agent_event(agent["id"], "agent.created", {"agent": agent})
        try:
            with self.engine.begin() as conn:
                row = _agent_row(agent, event_version=1)
                conn.execute(insert(self.agents).values(**row))
                conn.execute(
                    insert(self.events_table).values(
                        **_agent_event_row(row["id"], 0, event)
                    )
                )
        except IntegrityError as error:
            raise ValueError(
                f"Employee {agent['employeeId']} already has an agent named {agent['displayName']}."
            ) from error
        return agent

    def ensure_compatibility_agent(
        self, employee_id: str, executor_kind: str
    ) -> dict[str, Any]:
        if executor_kind not in AGENT_NAMES:
            raise ValueError(f"executorKind must be one of: {', '.join(AGENT_NAMES)}.")
        existing = next(
            (
                agent
                for agent in self.list_agents(employee_id=employee_id)
                if (
                    agent["executorKind"] == executor_kind
                    and agent.get("compatibilityKey")
                    == f"{employee_id}:{executor_kind}"
                )
            ),
            None,
        )
        if existing:
            return existing
        agent = self.create_agent(
            employee_id,
            {
                "displayName": _compatibility_display_name(
                    self.list_agents(employee_id=employee_id), executor_kind
                ),
                "executorKind": executor_kind,
            },
        )
        return self.update_agent(
            agent["id"], {"compatibilityKey": f"{employee_id}:{executor_kind}"}
        )

    def get_agent(self, agent_id: str) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            row = (
                conn.execute(
                    select(self.agents.c.snapshot).where(
                        self.agents.c.public_id == agent_id
                    )
                )
                .mappings()
                .first()
            )
        return row["snapshot"] if row else None

    def list_agents(
        self, *, employee_id: str | None = None, include_deleted: bool = False
    ) -> list[dict[str, Any]]:
        statement = select(self.agents.c.snapshot)
        if employee_id is not None:
            statement = statement.where(self.agents.c.employee_public_id == employee_id)
        if not include_deleted:
            statement = statement.where(self.agents.c.deleted_at.is_(None))
        with self.engine.begin() as conn:
            rows = conn.execute(statement).mappings().all()
        return sorted(
            (row["snapshot"] for row in rows),
            key=lambda agent: (
                agent.get("employeeId") or "",
                agent.get("displayName", "").casefold(),
                agent["id"],
            ),
        )

    def update_agent(self, agent_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        allowed = {
            "displayName",
            "defaultRole",
            "instructions",
            "skillPolicy",
            "toolPolicy",
            "modelPolicy",
            "enabled",
            "compatibilityKey",
        }
        unknown = set(patch) - allowed
        if unknown:
            raise ValueError(
                f"Unsupported agent field(s): {', '.join(sorted(unknown))}."
            )
        current = self.get_agent(agent_id)
        if not current or current.get("deletedAt"):
            raise KeyError(agent_id)
        normalized: dict[str, Any] = {}
        if "displayName" in patch:
            display_name = _required_string(patch, "displayName")
            self._ensure_unique_name(
                current["employeeId"], display_name, exclude_id=agent_id
            )
            normalized["displayName"] = display_name
        if "defaultRole" in patch:
            role = _required_string(patch, "defaultRole")
            if role not in AGENT_ROLES:
                raise ValueError(
                    f"defaultRole must be one of: {', '.join(AGENT_ROLES)}."
                )
            normalized["defaultRole"] = role
        if "instructions" in patch:
            normalized["instructions"] = (
                patch["instructions"].strip()
                if isinstance(patch["instructions"], str)
                else ""
            )
        for field in ("skillPolicy", "toolPolicy", "modelPolicy"):
            if field in patch:
                normalized[field] = _policy(patch, field)
        if "enabled" in patch:
            if not isinstance(patch["enabled"], bool):
                raise ValueError("enabled must be a boolean.")
            normalized["enabled"] = patch["enabled"]
        if "compatibilityKey" in patch:
            normalized["compatibilityKey"] = _required_string(patch, "compatibilityKey")
        placement_fields = {"instructions", "skillPolicy", "toolPolicy", "modelPolicy"}
        updated = {
            **current,
            **normalized,
            "version": int(current.get("version") or 1)
            + (1 if placement_fields.intersection(normalized) else 0),
            "updatedAt": now_iso(),
        }
        event_type = (
            "agent.disabled"
            if normalized.get("enabled") is False
            else "agent.enabled"
            if normalized.get("enabled") is True and not current.get("enabled", True)
            else "agent.updated"
        )
        return self._append(
            agent_id, event_type, updated, {"patch": normalized, "agent": updated}
        )

    def delete_agent(self, agent_id: str) -> dict[str, Any]:
        current = self.get_agent(agent_id)
        if not current or current.get("deletedAt"):
            raise KeyError(agent_id)
        timestamp = now_iso()
        updated = {
            **current,
            "enabled": False,
            "deletedAt": timestamp,
            "updatedAt": timestamp,
        }
        return self._append(agent_id, "agent.deleted", updated, {"agent": updated})

    def events(self, agent_id: str) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = (
                conn.execute(
                    select(
                        self.events_table.c.public_id,
                        self.events_table.c.type,
                        self.events_table.c.timestamp,
                        self.events_table.c.payload,
                    )
                    .join(self.agents, self.events_table.c.agent_id == self.agents.c.id)
                    .where(self.agents.c.public_id == agent_id)
                    .order_by(self.events_table.c.sequence)
                )
                .mappings()
                .all()
            )
        if not rows and not self.get_agent(agent_id):
            raise KeyError(agent_id)
        return [
            {
                "id": row["public_id"],
                "type": row["type"],
                "agentId": agent_id,
                "timestamp": _format_iso(row["timestamp"]),
                **row["payload"],
            }
            for row in rows
        ]

    def _append(
        self,
        agent_id: str,
        event_type: str,
        agent: dict[str, Any],
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        event = _agent_event(agent_id, event_type, payload)
        try:
            with self.engine.begin() as conn:
                row = (
                    conn.execute(
                        select(self.agents.c.id, self.agents.c.event_version)
                        .where(self.agents.c.public_id == agent_id)
                        .with_for_update()
                    )
                    .mappings()
                    .first()
                )
                if not row:
                    raise KeyError(agent_id)
                sequence = int(row["event_version"] or 0)
                conn.execute(
                    insert(self.events_table).values(
                        **_agent_event_row(row["id"], sequence, event)
                    )
                )
                conn.execute(
                    update(self.agents)
                    .where(self.agents.c.id == row["id"])
                    .values(
                        **_agent_row(
                            agent,
                            event_version=sequence + 1,
                            database_id=row["id"],
                        )
                    )
                )
        except IntegrityError as error:
            raise ValueError(
                f"Employee {agent['employeeId']} already has an agent named {agent['displayName']}."
            ) from error
        return agent

    def _ensure_unique_name(
        self, employee_id: str, display_name: str, *, exclude_id: str | None = None
    ) -> None:
        duplicate = next(
            (
                agent
                for agent in self.list_agents(employee_id=employee_id)
                if agent["id"] != exclude_id
                and agent.get("displayName", "").casefold() == display_name.casefold()
            ),
            None,
        )
        if duplicate:
            raise ValueError(
                f"Employee {employee_id} already has an agent named {display_name}."
            )


def _compatibility_display_name(
    agents: list[dict[str, Any]], executor_kind: str
) -> str:
    existing_names = {agent.get("displayName", "").casefold() for agent in agents}
    base = f"{executor_kind.capitalize()} (legacy)"
    if base.casefold() not in existing_names:
        return base
    suffix = 2
    while f"{base} {suffix}".casefold() in existing_names:
        suffix += 1
    return f"{base} {suffix}"


def _new_agent(employee_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    employee_id = employee_id.strip()
    display_name = _required_string(payload, "displayName")
    executor_kind = _required_string(payload, "executorKind")
    default_role = _optional_string(payload, "defaultRole") or "implementer"
    if not employee_id:
        raise ValueError("employeeId is required.")
    if executor_kind not in AGENT_NAMES:
        raise ValueError(f"executorKind must be one of: {', '.join(AGENT_NAMES)}.")
    if default_role not in AGENT_ROLES:
        raise ValueError(f"defaultRole must be one of: {', '.join(AGENT_ROLES)}.")
    timestamp = now_iso()
    return {
        "id": new_relay_id("agent"),
        "employeeId": employee_id,
        "displayName": display_name,
        "executorKind": executor_kind,
        "defaultRole": default_role,
        **(
            {"instructions": payload["instructions"].strip()}
            if isinstance(payload.get("instructions"), str)
            and payload["instructions"].strip()
            else {}
        ),
        "skillPolicy": _policy(payload, "skillPolicy"),
        "toolPolicy": _policy(payload, "toolPolicy"),
        "modelPolicy": _policy(payload, "modelPolicy"),
        "enabled": payload.get("enabled") is not False,
        "version": 1,
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }


def _agent_event(
    agent_id: str, event_type: str, payload: dict[str, Any]
) -> dict[str, Any]:
    return {
        "id": new_relay_id("evt"),
        "type": event_type,
        "agentId": agent_id,
        "timestamp": now_iso(),
        **payload,
    }


def _agent_row(
    agent: dict[str, Any], *, event_version: int, database_id: str | None = None
) -> dict[str, Any]:
    return {
        "id": database_id or new_database_id(),
        "public_id": agent["id"],
        "employee_public_id": agent["employeeId"],
        "display_name": agent["displayName"],
        "display_name_key": (
            None if agent.get("deletedAt") else agent["displayName"].strip().casefold()
        ),
        "executor_kind": agent["executorKind"],
        "compatibility_key": agent.get("compatibilityKey"),
        "enabled": agent.get("enabled", True),
        "agent_version": int(agent.get("version") or 1),
        "snapshot": agent,
        "event_version": event_version,
        "created_at": _parse_iso(agent["createdAt"]),
        "updated_at": _parse_iso(agent["updatedAt"]),
        "deleted_at": _parse_iso(agent.get("deletedAt")),
    }


def _agent_event_row(
    agent_database_id: str, sequence: int, event: dict[str, Any]
) -> dict[str, Any]:
    return {
        "public_id": event["id"],
        "agent_id": agent_database_id,
        "sequence": sequence,
        "type": event["type"],
        "timestamp": _parse_iso(event["timestamp"]),
        "payload": {
            key: value
            for key, value in event.items()
            if key not in {"id", "type", "agentId", "timestamp"}
        },
    }


def _required_string(payload: dict[str, Any], field: str) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} is required.")
    return value.strip()


def _optional_string(payload: dict[str, Any], field: str) -> str | None:
    value = payload.get(field)
    return value.strip() if isinstance(value, str) and value.strip() else None


def _policy(payload: dict[str, Any], field: str) -> dict[str, Any]:
    value = payload.get(field)
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object.")
    return value
