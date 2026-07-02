from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory

import pytest
from fastapi.testclient import TestClient

from relay.app import create_app
from relay.persistence.stores import relay_event


def _bootstrap(client: TestClient) -> None:
    assert client.post("/auth/bootstrap", json={
        "token": "admin_token",
        "username": "admin",
        "password": "secret123",
    }).status_code == 200
    assert client.post("/auth/login", json={"username": "admin", "password": "secret123"}).status_code == 200


def _create_session(client: TestClient, workspace_path: str) -> str:
    response = client.post("/sessions", json={
        "taskGoal": "demo task",
        "assignments": [{"agent": "claude", "mode": "action"}],
        "workspacePath": workspace_path,
    })
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_workspace_file_reads_text(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root, TemporaryDirectory() as ws:
        (Path(ws) / "hello.txt").write_text("hi there\n", encoding="utf-8")
        client = TestClient(create_app(root))
        _bootstrap(client)
        _create_session(client, ws)

        response = client.get("/workspace/file", params={"path": "hello.txt"})
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["isBinary"] is False
        assert body["content"] == "hi there\n"
        assert body["truncated"] is False
        assert body["bytes"] == len("hi there\n")
        assert body["path"] == "hello.txt"


def test_workspace_file_detects_binary(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root, TemporaryDirectory() as ws:
        (Path(ws) / "data.bin").write_bytes(b"\x89PNG\x00\x01\x02binary")
        client = TestClient(create_app(root))
        _bootstrap(client)
        _create_session(client, ws)

        response = client.get("/workspace/file", params={"path": "data.bin"})
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["isBinary"] is True
        assert body["content"] is None


def test_workspace_file_artifact_downloads_raw_file(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root, TemporaryDirectory() as ws:
        deck = Path(ws) / "deck.pptx"
        deck.write_bytes(b"pptx bytes")
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        session_id = _create_session(client, ws)
        artifact = {
            "id": "art_deck",
            "kind": "workspace_file",
            "title": "deck.pptx",
            "path": str(deck),
            "createdAt": "2026-06-30T00:00:00.000Z",
            "bytes": deck.stat().st_size,
            "contentType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "workspaceRelativePath": "deck.pptx",
        }
        app.state.session_store.append_event(session_id, relay_event("artifact.created", session_id, {"artifact": artifact}))

        response = client.get(f"/sessions/{session_id}/artifacts/art_deck")
        assert response.status_code == 200, response.text
        assert response.content == b"pptx bytes"
        assert response.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.presentationml.presentation")


def test_workspace_file_artifact_serves_snapshot_when_live_file_is_gone(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root, TemporaryDirectory() as ws:
        deck = Path(ws) / "deck.pptx"
        deck.write_bytes(b"pptx bytes")
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        session_id = _create_session(client, ws)
        artifact = {
            "id": "art_deck",
            "kind": "workspace_file",
            "title": "deck.pptx",
            "path": str(deck),
            "createdAt": "2026-06-30T00:00:00.000Z",
            "bytes": deck.stat().st_size,
            "contentType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "workspaceRelativePath": "deck.pptx",
        }
        app.state.session_store.index_workspace_artifact(session_id, artifact, deck.read_bytes())
        deck.unlink()

        response = client.get(f"/sessions/{session_id}/artifacts/art_deck")
        assert response.status_code == 200, response.text
        assert response.content == b"pptx bytes"
        assert response.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.presentationml.presentation")


def test_workspace_file_artifact_without_snapshot_is_404_when_live_file_is_gone(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root, TemporaryDirectory() as ws:
        deck = Path(ws) / "deck.pptx"
        deck.write_bytes(b"pptx bytes")
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        session_id = _create_session(client, ws)
        artifact = {
            "id": "art_deck",
            "kind": "workspace_file",
            "title": "deck.pptx",
            "path": str(deck),
            "createdAt": "2026-06-30T00:00:00.000Z",
            "bytes": deck.stat().st_size,
            "contentType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "workspaceRelativePath": "deck.pptx",
        }
        app.state.session_store.append_event(session_id, relay_event("artifact.created", session_id, {"artifact": artifact}))
        deck.unlink()

        response = client.get(f"/sessions/{session_id}/artifacts/art_deck")
        assert response.status_code == 404


def test_workspace_file_artifact_rejects_paths_outside_workspace(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root, TemporaryDirectory() as ws:
        outside = Path(root) / "outside.pptx"
        outside.write_bytes(b"outside")
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        session_id = _create_session(client, ws)
        artifact = {
            "id": "art_outside",
            "kind": "workspace_file",
            "title": "outside.pptx",
            "path": str(outside),
            "createdAt": "2026-06-30T00:00:00.000Z",
            "bytes": outside.stat().st_size,
            "contentType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "workspaceRelativePath": "outside.pptx",
        }
        app.state.session_store.append_event(session_id, relay_event("artifact.created", session_id, {"artifact": artifact}))

        response = client.get(f"/sessions/{session_id}/artifacts/art_outside")
        assert response.status_code == 404


def test_workspace_file_artifact_rejects_symlinks(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root, TemporaryDirectory() as ws:
        outside = Path(root) / "outside.pptx"
        outside.write_bytes(b"outside")
        link = Path(ws) / "linked.pptx"
        try:
            link.symlink_to(outside)
        except OSError as exc:
            pytest.skip(f"symlinks unavailable: {exc}")
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        session_id = _create_session(client, ws)
        artifact = {
            "id": "art_link",
            "kind": "workspace_file",
            "title": "linked.pptx",
            "path": str(link),
            "createdAt": "2026-06-30T00:00:00.000Z",
            "bytes": outside.stat().st_size,
            "contentType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "workspaceRelativePath": "linked.pptx",
        }
        app.state.session_store.append_event(session_id, relay_event("artifact.created", session_id, {"artifact": artifact}))

        response = client.get(f"/sessions/{session_id}/artifacts/art_link")
        assert response.status_code == 404


def test_workspace_file_truncates_large_file(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root, TemporaryDirectory() as ws:
        big = "x" * (300 * 1024)
        (Path(ws) / "big.txt").write_text(big, encoding="utf-8")
        client = TestClient(create_app(root))
        _bootstrap(client)
        _create_session(client, ws)

        response = client.get("/workspace/file", params={"path": "big.txt"})
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["truncated"] is True
        assert body["bytes"] == 300 * 1024
        assert len(body["content"]) == body["limitBytes"]


def test_workspace_file_rejects_traversal(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root, TemporaryDirectory() as ws:
        client = TestClient(create_app(root))
        _bootstrap(client)
        _create_session(client, ws)

        response = client.get("/workspace/file", params={"path": "../secret.txt"})
        assert response.status_code == 403


def test_workspace_file_missing_returns_404(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root, TemporaryDirectory() as ws:
        client = TestClient(create_app(root))
        _bootstrap(client)
        _create_session(client, ws)

        response = client.get("/workspace/file", params={"path": "nope.txt"})
        assert response.status_code == 404


def test_workspace_file_directory_returns_400(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root, TemporaryDirectory() as ws:
        (Path(ws) / "subdir").mkdir()
        client = TestClient(create_app(root))
        _bootstrap(client)
        _create_session(client, ws)

        response = client.get("/workspace/file", params={"path": "subdir"})
        assert response.status_code == 400


def test_workspace_file_requires_path(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root, TemporaryDirectory() as ws:
        client = TestClient(create_app(root))
        _bootstrap(client)
        _create_session(client, ws)

        response = client.get("/workspace/file")
        assert response.status_code == 400
