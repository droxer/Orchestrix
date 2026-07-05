"""Compute prompt context from handoff decisions."""

from __future__ import annotations

from typing import Any

from .bridge import latest_user_turn_marker


def compute_prior_handoff_note(session: dict[str, Any], agent: str | None = None) -> str | None:
    """Return the latest handoff note after the current user turn, if any."""
    latest_user = latest_user_turn_marker(session)
    latest: tuple[tuple[str, int], dict[str, Any]] | None = None
    for index, event in enumerate(session.get("events", [])):
        if event.get("type") != "human.decision":
            continue
        marker = (event.get("timestamp") or "", index)
        if latest_user and marker <= latest_user:
            continue
        decision = event.get("decision") or {}
        if latest is None or marker > latest[0]:
            latest = (marker, decision)
    if latest is None:
        return None
    decision = latest[1]
    if decision.get("kind") != "handoff":
        return None
    target_agent = decision.get("targetAgent")
    if agent and target_agent and target_agent != agent:
        return None
    note = decision.get("note")
    if not isinstance(note, str) or not note.strip():
        return None
    return f"[Handoff note]\n{note.strip()}"
