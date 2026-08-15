"""Turn auto-generated compatibility agents into declared plain agents, in place.

One-time, idempotent. Goes through the store's own update path so events and
snapshots stay in lockstep — do not switch this to raw Alembic SQL; agent
reads come from the snapshot column, and a direct rewrite would bypass the
write path entirely.
"""

from __future__ import annotations

from typing import Any

from loguru import logger

from ..core.computer_identity import computer_id

DEFAULT_ROLE = "implementer"


def migrate_agent_computer_ids(
    agent_store: Any, placement_store: Any, registry: Any | None = None
) -> int:
    """Return how many agents this run migrated. Already-migrated ones don't count.

    registry is optional; it's the fallback for legacy placements created
    before spec ① (and so lacking a computerId) — it lets us derive an
    identity from the placement's daemonNodeId via the registry instead.
    """
    migrated = 0
    for agent in agent_store.list_agents():
        if agent.get("deletedAt") or not agent.get("compatibilityKey"):
            continue
        agent_computer_id = _computer_id_from_placements(
            placement_store, agent["id"], registry
        )
        if not agent_computer_id:
            logger.warning(
                "Skipping agent migration: no placement to read a computer id from",
                agent_id=agent["id"],
            )
            continue
        agent_store.set_birth_certificate(
            agent["id"],
            computer_id=agent_computer_id,
            default_role=agent.get("defaultRole") or DEFAULT_ROLE,
        )
        migrated += 1
    return migrated


def _computer_id_from_placements(
    placement_store: Any, agent_id: str, registry: Any | None
) -> str | None:
    """Read computerId off the agent's placements.

    Does not parse compatibilityKey: after spec ①, the middle segment of the
    key is a prefixed identity (e.g. alice:device:alice:machine-a:claude),
    and splitting on colons can't recover it unambiguously.

    Trusts active placements only: `list_placements` excludes removed
    records by default, and both stores sort by (priority, id), where id is
    a random uuid — an agent that ever changed computers will have one
    active placement and at least one removed (stale) one. Taking "the first
    sorted record with a computerId" without distinguishing active from
    removed would, about half the time, write a since-retired computer into
    the agent's immutable birth certificate.

    Only falls back to include_removed=True when there isn't a single active
    placement, and even then picks the newest by createdAt (never an
    arbitrary one) — to avoid the same sort-order randomness.

    spec ① only wrote computerId onto **newly created** placements, so most
    legacy placements in production lack the field — reading it alone would
    make this migration a near-total no-op on real data. So for placements
    missing it, derive an identity from the placement's daemonNodeId via the
    registry instead.
    """
    active_placements = placement_store.list_placements(agent_id=agent_id)
    computer_id_value = _first_computer_id(active_placements)
    if computer_id_value:
        return computer_id_value

    all_placements = placement_store.list_placements(
        agent_id=agent_id, include_removed=True
    )
    newest_first = sorted(
        all_placements, key=lambda item: item.get("createdAt") or "", reverse=True
    )
    computer_id_value = _first_computer_id(newest_first)
    if computer_id_value:
        return computer_id_value

    if registry is None:
        return None
    nodes = {node["id"]: node for node in registry.monitor_nodes()}
    for placement in newest_first:
        node = nodes.get(placement.get("daemonNodeId"))
        if node:
            return computer_id(node)
    return None


def _first_computer_id(placements: list[dict[str, Any]]) -> str | None:
    for placement in placements:
        computer_id_value = placement.get("computerId")
        if computer_id_value:
            return computer_id_value
    return None
