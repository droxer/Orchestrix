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

    intervening = [r for r in runs[last_own_index + 1:] if r.get("agent") != agent]
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
