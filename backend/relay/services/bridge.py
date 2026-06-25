"""Compute the prior-agent bridge string for a multi-agent session.

When a session contains runs from multiple agents, the daemon prompt for the
next agent gets a short prepended block summarizing each intervening other-agent
run's last assistant text. See
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

    Walks ``session["agentRuns"]``, finds the index of this agent's last run
    (``-1`` if none), and for each subsequent run by a different agent
    reads the rendered transcript artifact and extracts the last assistant
    text block. Returns the joined bridge string, or ``None`` when no
    intervening runs produced usable text.
    """
    runs = session.get("agentRuns") or []
    last_own_index = -1
    for i in range(len(runs) - 1, -1, -1):
        if runs[i].get("agent") == agent:
            last_own_index = i
            break

    latest_user = latest_user_turn_marker(session)
    intervening = [
        r
        for r in runs[last_own_index + 1:]
        if r.get("agent") != agent and (not latest_user or run_marker(session, r) > latest_user)
    ]
    if not intervening:
        return None

    blocks: list[str] = []
    for run in intervening:
        artifact = _bridge_artifact_for_run(session, run)
        text: str | None = None
        if artifact:
            try:
                body = store.read_artifact(session["id"], artifact["id"])
                text = extract_last_assistant_text(body)
            except (KeyError, FileNotFoundError):
                text = None
        blocks.append(f"[Previous from @{run.get('agent')}]\n{text or '<no output>'}")

    return "\n\n".join(blocks)
