"""remove the accumulated heartbeat daemon events

Revision ID: 20260730_0053
Revises: 20260730_0052

`daemon.node.*` events are excluded from `prune_terminal_records`, because once
`delete_node` hard-deletes a node row the event log is the only record that the
incarnation existed (`historical_managed_runtime_ids` reads it back). Two
heartbeat-rate event streams accumulated behind that exemption:

- `daemon.node.seen`, appended per heartbeat by a path that no longer emits it.
  Nothing has ever read it and it carries no node payload, so every row is dead
  weight. It is now in `PRUNABLE_DAEMON_EVENT_TYPES`; this clears the backlog.
- `daemon.node.registered`, appended per heartbeat even when the registration
  was identical to the stored one. `register_node` now appends only on a
  material change. The duplicates left behind are collapsed here, keeping the
  first and last event per node so both the original incarnation record and the
  current state survive.

Only exact duplicates are removed: an event whose payload differs from both its
neighbours is a real state change and is kept.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "20260730_0053"
down_revision = "20260730_0052"
branch_labels = None
depends_on = None

logger = logging.getLogger(__name__)


def upgrade() -> None:
    connection = op.get_bind()

    dead = connection.execute(
        sa.text("DELETE FROM daemon_events WHERE type = 'daemon.node.seen'")
    ).rowcount
    logger.info("0053: removed %s dead daemon.node.seen event(s)", dead)

    rows = (
        connection.execute(
            sa.text(
                "SELECT id, node_id, payload, timestamp FROM daemon_events "
                "WHERE type = 'daemon.node.registered' "
                "ORDER BY timestamp, id"
            )
        )
        .mappings()
        .all()
    )

    redundant: list[str] = []
    by_node: dict[Any, list[Any]] = {}
    for row in rows:
        # `daemon_event` never populates the node_id column for these -- the node
        # lives in the payload -- so grouping on the column would collapse every
        # node into one bucket and interleave their histories.
        by_node.setdefault(_node_id(row), []).append(row)

    for events in by_node.values():
        # Keep the first (the incarnation record) and the last (current state).
        for index in range(1, len(events) - 1):
            if _same_node_payload(events[index - 1], events[index]) and _same_node_payload(
                events[index], events[index + 1]
            ):
                redundant.append(events[index]["id"])

    for chunk in _chunks(redundant, 500):
        connection.execute(
            sa.text("DELETE FROM daemon_events WHERE id IN :ids").bindparams(
                sa.bindparam("ids", expanding=True)
            ),
            {"ids": chunk},
        )
    logger.info(
        "0053: collapsed %s duplicate daemon.node.registered event(s)", len(redundant)
    )


def downgrade() -> None:
    # Deleted heartbeat noise cannot be reconstructed, and nothing reads it.
    pass


def _same_node_payload(left: Any, right: Any) -> bool:
    identity = _node_identity(left)
    return identity is not None and identity == _node_identity(right)


def _node(row: Any) -> dict[str, Any] | None:
    payload = row["payload"]
    if isinstance(payload, (str, bytes)):
        try:
            payload = json.loads(payload)
        except (TypeError, ValueError):
            return None
    if not isinstance(payload, dict):
        return None
    node = payload.get("node")
    return node if isinstance(node, dict) else None


def _node_id(row: Any) -> Any:
    node = _node(row)
    node_id = node.get("id") if node else None
    return node_id if isinstance(node_id, str) else row["node_id"]


def _node_identity(row: Any) -> str | None:
    node = _node(row)
    if node is None:
        return None
    # updatedAt/lastSeenAt advance on every heartbeat by design.
    return json.dumps(
        {
            key: value
            for key, value in node.items()
            if key not in ("updatedAt", "lastSeenAt")
        },
        sort_keys=True,
    )


def _chunks(values: list[str], size: int) -> Any:
    for start in range(0, len(values), size):
        yield values[start : start + size]
