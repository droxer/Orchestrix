"""Assemble the prior-conversation transcript for a continued session.

When the user sends a follow-up turn into an existing session, the next agent
run gets a prepended block summarizing the conversation so far — every earlier
user turn plus each completed agent run's last assistant text. This is what
gives the agent memory across runs; without it each run is a stateless CLI
invocation that only sees the latest message.

The latest user turn (the message currently being dispatched) is excluded: the
prompt builder re-appends it as the final ``[User]`` block, so including it here
would duplicate it.
"""

from __future__ import annotations

from typing import Any

from .bridge import ArtifactReader, agent_log_for_run, extract_last_assistant_text, latest_user_turn_marker, run_marker


def _created_marker(session: dict[str, Any]) -> tuple[str, int]:
    for index, event in enumerate(session.get("events", [])):
        if event.get("type") == "session.created":
            return (event.get("timestamp") or session.get("createdAt", ""), index)
    return (session.get("createdAt", ""), -1)


def _user_turns(session: dict[str, Any]) -> list[tuple[tuple[str, int], str]]:
    """Return ``((timestamp, event_index), text)`` for each user turn."""
    turns: list[tuple[tuple[str, int], str]] = [(_created_marker(session), session.get("taskGoal", ""))]
    for index, event in enumerate(session.get("events", [])):
        if event.get("type") == "user.message":
            turns.append(((event.get("timestamp", ""), index), event.get("text", "")))
    return turns


def _agent_turns(session: dict[str, Any], store: ArtifactReader) -> list[tuple[tuple[str, int], str, str | None]]:
    """Return ``((timestamp, event_index), agent, last_assistant_text)`` for completed runs."""
    turns: list[tuple[tuple[str, int], str, str | None]] = []
    for run in session.get("agentRuns", []):
        if run.get("status") != "completed":
            continue
        body = agent_log_for_run(session, run, store)
        text = extract_last_assistant_text(body) if body else None
        turns.append((run_marker(session, run), run.get("agent", "agent"), text))
    return turns


def compute_conversation_history(session: dict[str, Any], store: ArtifactReader) -> str | None:
    """Build the conversation-so-far block for the next run on ``session``.

    Returns ``None`` when there is nothing prior to show (e.g. the very first
    turn of a new session, where the only user turn is the current message).
    """
    latest_user = latest_user_turn_marker(session)
    items: list[tuple[tuple[str, int], str, str]] = []
    for marker, text in _user_turns(session):
        if latest_user and marker >= latest_user:
            continue
        items.append((marker, "user", f"[User]\n{text}"))
    for marker, agent, text in _agent_turns(session, store):
        if latest_user and marker >= latest_user:
            continue
        items.append((marker, "agent", f"[Assistant @{agent}]\n{text or '<no output>'}"))

    items.sort(key=lambda item: item[0])

    if not items:
        return None

    blocks = [block for _, _, block in items]
    return "[Conversation so far]\n\n" + "\n\n".join(blocks)
