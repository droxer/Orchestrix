from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from relay.app import create_app


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
