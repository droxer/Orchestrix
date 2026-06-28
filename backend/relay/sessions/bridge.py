"""Compute the prior-agent bridge string for a multi-agent session.

When a session contains runs from multiple agents, the daemon prompt for the
next agent gets a short prepended block summarizing completed current-turn
agent runs' last assistant text. See
``docs/superpowers/specs/2026-06-17-shared-agent-thread-design.md``.
"""

from __future__ import annotations

import re
from typing import Any, Protocol


class ArtifactReader(Protocol):
    def read_artifact(self, session_id: str, artifact_id: str) -> str: ...


_NOISE_PREFIXES = ("○ ", "⏺ ")  # "○ ", "⏺ "
_ASSISTANT_SPLIT = re.compile(r"\n?● ")  # "● "


def extract_last_assistant_text(transcript: str) -> str | None:
    """Return the last ``●`` segment of an agent transcript, trimmed.

    Returns ``None`` when no segment exists or when every segment is empty
    after stripping ``○``/``⏺`` noise lines.
    """
    if not transcript or not transcript.strip():
        return None
    segments = _ASSISTANT_SPLIT.split(transcript)[1:]
    for segment in reversed(segments):
        cleaned = "\n".join(
            line
            for line in segment.split("\n")
            if not any(line.startswith(prefix) for prefix in _NOISE_PREFIXES)
        ).strip()
        if cleaned:
            return cleaned
    return None


def _bridge_artifact_for_run(session: dict[str, Any], run: dict[str, Any]) -> dict[str, Any] | None:
    """Pick the artifact that carries the run's rendered transcript."""
    artifact_ids = run.get("artifactIds") or []
    artifacts = {a["id"]: a for a in session.get("artifacts", [])}
    for artifact_id in reversed(artifact_ids):
        artifact = artifacts.get(artifact_id)
        if not artifact:
            continue
        if artifact.get("kind") in ("command_log", "review", "agent_output"):
            return artifact
    return None


def agent_log_for_run(session: dict[str, Any], run: dict[str, Any], store: ArtifactReader) -> str | None:
    """Return the run transcript without treating it as a user-visible artifact."""
    if isinstance(run.get("agentLog"), str):
        return run["agentLog"]
    run_id = run.get("id")
    for event in reversed(session.get("events", [])):
        if event.get("type") == "agent.completed" and event.get("runId") == run_id and isinstance(event.get("agentLog"), str):
            return event["agentLog"]
    artifact = _bridge_artifact_for_run(session, run)
    if not artifact:
        return None
    try:
        return store.read_artifact(session["id"], artifact["id"])
    except (KeyError, FileNotFoundError):
        return None


def latest_user_turn_timestamp(session: dict[str, Any]) -> str | None:
    """Return the timestamp for the latest user turn in ``session``.

    ``session.created`` carries the first user turn as ``taskGoal``; later
    follow-ups are persisted as ``user.message`` events.
    """
    timestamps: list[str] = []
    if session.get("createdAt"):
        timestamps.append(session["createdAt"])
    for event in session.get("events", []):
        if event.get("type") == "user.message" and event.get("timestamp"):
            timestamps.append(event["timestamp"])
    return max(timestamps) if timestamps else None


def latest_user_turn_marker(session: dict[str, Any]) -> tuple[str, int] | None:
    """Return ``(timestamp, event_index)`` for the latest user turn."""
    markers: list[tuple[str, int]] = []
    if session.get("createdAt"):
        markers.append((session["createdAt"], -1))
    for index, event in enumerate(session.get("events", [])):
        if event.get("type") == "session.created" and event.get("timestamp"):
            markers.append((event["timestamp"], index))
        elif event.get("type") == "user.message" and event.get("timestamp"):
            markers.append((event["timestamp"], index))
    return max(markers) if markers else None


def _run_timestamp(run: dict[str, Any]) -> str:
    return run.get("completedAt") or run.get("startedAt") or ""


def run_marker(session: dict[str, Any], run: dict[str, Any]) -> tuple[str, int]:
    timestamp = _run_timestamp(run)
    run_id = run.get("id")
    for index, event in enumerate(session.get("events", [])):
        if event.get("type") == "agent.completed" and event.get("runId") == run_id:
            return (event.get("timestamp") or timestamp, index)
    return (timestamp, -1)


def compute_prior_agent_bridge(
    session: dict[str, Any],
    agent: str,
    store: ArtifactReader,
) -> str | None:
    """Build the bridge string for the next run of ``agent`` on ``session``.

    Every completed run in the current user turn is shared with the next
    agent, even when the next run uses the same agent again. This keeps
    handoffs continuous inside one conversation while older turns remain in
    ``prior_conversation``.
    """
    runs = session.get("agentRuns") or []
    latest_user = latest_user_turn_marker(session)
    prior_runs = [
        r
        for r in runs
        if r.get("status") in (None, "completed") and (not latest_user or run_marker(session, r) > latest_user)
    ]
    if not prior_runs:
        return None

    blocks: list[str] = []
    for run in prior_runs:
        body = agent_log_for_run(session, run, store)
        text = extract_last_assistant_text(body) if body else None
        blocks.append(f"[Previous from @{run.get('agent')}]\n{text or '<no output>'}")

    return "\n\n".join(blocks)
