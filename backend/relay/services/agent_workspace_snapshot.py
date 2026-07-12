"""Virtual agent-home views derived from durable workspace-file artifacts."""

from __future__ import annotations

import base64
from typing import Any


def _agent_home_prefix(agent_id: str) -> str:
    encoded = base64.urlsafe_b64encode(agent_id.encode("utf-8")).decode("ascii").rstrip("=")
    return f"agents/agent-{encoded}/"


def agent_home_relative(relative_path: str | None, agent_id: str) -> str | None:
    if not isinstance(relative_path, str):
        return None
    prefix = _agent_home_prefix(agent_id)
    return relative_path[len(prefix):] if relative_path.startswith(prefix) else None


def _home_paths(artifacts: list[dict[str, Any]], agent_id: str) -> list[tuple[str, dict[str, Any]]]:
    return [(path, artifact) for artifact in artifacts if (path := agent_home_relative(artifact.get("workspaceRelativePath"), agent_id))]


def snapshot_listing(artifacts: list[dict[str, Any]], agent_id: str, path: str) -> list[dict[str, Any]]:
    prefix = f"{path.strip('/')}/" if path.strip("/") else ""
    directories: dict[str, str] = {}
    files: list[dict[str, Any]] = []
    for home_path, artifact in _home_paths(artifacts, agent_id):
        if not home_path.startswith(prefix):
            continue
        remainder = home_path[len(prefix):]
        if not remainder:
            continue
        if "/" in remainder:
            name = remainder.split("/", 1)[0]
            directories[name] = max(directories.get(name, ""), artifact.get("createdAt") or "")
        else:
            files.append({"name": remainder, "path": home_path, "kind": "file", "bytes": artifact.get("bytes"), "updatedAt": artifact.get("createdAt")})
    directory_entries = [{"name": name, "path": f"{prefix}{name}", "kind": "directory", "bytes": None, "updatedAt": updated_at or None} for name, updated_at in directories.items()]
    return sorted(directory_entries, key=lambda item: item["name"].lower()) + sorted(files, key=lambda item: item["name"].lower())


def snapshot_file(session_store: Any, artifacts: list[dict[str, Any]], agent_id: str, path: str) -> dict[str, Any] | None:
    clean = path.strip("/")
    for home_path, artifact in _home_paths(artifacts, agent_id):
        if home_path != clean:
            continue
        content = session_store.read_artifact_content(artifact["sessionId"], artifact["id"])
        if content is None:
            return None
        is_binary = b"\x00" in content
        text: str | None = None
        if not is_binary:
            try:
                text = content.decode("utf-8")
            except UnicodeDecodeError:
                is_binary = True
        return {"path": clean, "bytes": artifact.get("bytes") or len(content), "isBinary": is_binary, "truncated": False, "content": text}
    return None
