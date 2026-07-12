import base64

from relay.services.agent_workspace_snapshot import agent_home_relative, snapshot_file, snapshot_listing


def _prefix(agent_id: str) -> str:
    return f"agents/agent-{base64.urlsafe_b64encode(agent_id.encode()).decode().rstrip('=')}"


def _artifact(agent_id: str, path: str) -> dict:
    return {"id": "artifact_1", "sessionId": "session_1", "workspaceRelativePath": f"{_prefix(agent_id)}/{path}", "bytes": 5, "createdAt": "2026-07-11T00:00:00Z"}


class Store:
    def read_artifact_content(self, session_id: str, artifact_id: str) -> bytes:
        return b"hello"


def test_snapshot_is_confined_to_the_agent_home_and_lists_directories_first():
    artifacts = [_artifact("agent_1", "report.md"), _artifact("agent_1", "notes/today.md")]
    assert agent_home_relative("elsewhere/report.md", "agent_1") is None
    assert [(entry["name"], entry["kind"]) for entry in snapshot_listing(artifacts, "agent_1", "")] == [("notes", "directory"), ("report.md", "file")]
    assert snapshot_file(Store(), artifacts, "agent_1", "report.md")["content"] == "hello"
