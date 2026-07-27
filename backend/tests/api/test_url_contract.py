from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from relay.api.contract import API_PREFIX
from relay.app import create_app


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    web_dist = tmp_path / "web-out"
    web_dist.mkdir()
    (web_dist / "index.html").write_text("<html>relay-spa</html>")
    monkeypatch.setenv("RELAY_WEB_UI_DIST_DIR", str(web_dist))
    return TestClient(create_app(tmp_path / "state"))


def _bootstrap(client: TestClient) -> None:
    response = client.post(
        f"{API_PREFIX}/auth/bootstrap",
        json={
            "token": "admin_token",
            "username": "admin",
            "password": "secret123",
        },
    )
    assert response.status_code == 200


def test_openapi_publishes_only_the_canonical_json_contract(
    monkeypatch, tmp_path: Path
) -> None:
    client = _client(monkeypatch, tmp_path)
    schema = client.get("/api/openapi.json").json()
    paths = schema["paths"]

    assert "/api/v1/threads" in paths
    assert "/api/v1/admin/daemon-nodes" in paths
    assert "/api/v1/internal/chat/integrations/runtime" in paths
    assert "/profile-images/{kind}/{entity_id}" in paths
    assert "/sessions" not in paths
    assert "/cp/users" not in paths
    assert "/chat/identity/resolve" not in paths
    assert "/api/v1/tasks/claim-next" not in paths

    operations = [
        operation
        for path in paths.values()
        for method, operation in path.items()
        if method in {"get", "post", "put", "patch", "delete"}
    ]
    assert all(operation.get("tags") for operation in operations)
    operation_ids = [operation["operationId"] for operation in operations]
    assert len(operation_ids) == len(set(operation_ids))

    assert set(paths["/api/v1/threads/{session_id}"]) == {"get", "patch", "delete"}
    assert set(paths["/api/v1/tasks/{task_id}/assignment"]) == {"put"}
    assert set(paths["/api/v1/admin/daemon-nodes/{node_id}/assignment"]) == {
        "put",
        "delete",
    }


def test_api_discovery_is_generated_from_version_constants(
    monkeypatch, tmp_path: Path
) -> None:
    response = _client(monkeypatch, tmp_path).get("/api")

    assert response.status_code == 200
    assert response.json() == {
        "name": "Relay backend",
        "version": "v1",
        "basePath": "/api/v1",
        "docsPath": "/api/docs",
        "openapiPath": "/api/openapi.json",
        "uiPath": "/admin",
        "webUiPath": "/",
    }


def test_legacy_routes_are_hidden_deprecated_aliases(
    monkeypatch, tmp_path: Path
) -> None:
    client = _client(monkeypatch, tmp_path)

    response = client.get("/auth/status")

    assert response.status_code == 200
    assert response.headers["deprecation"] == "true"
    assert response.headers["link"] == '</api/v1/auth/status>; rel="successor-version"'

    redirect = client.get("/cp", follow_redirects=False)
    assert redirect.status_code == 308
    assert redirect.headers["location"] == "/admin"
    assert redirect.headers["deprecation"] == "true"


def test_thread_patch_replaces_title_and_archive_action_urls(
    monkeypatch, tmp_path: Path
) -> None:
    client = _client(monkeypatch, tmp_path)
    _bootstrap(client)
    created = client.post(f"{API_PREFIX}/threads", json={"taskGoal": "Ship it"})
    assert created.status_code == 201
    thread_id = created.json()["id"]

    renamed = client.patch(
        f"{API_PREFIX}/threads/{thread_id}", json={"title": "Canonical title"}
    )
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "Canonical title"

    archived = client.patch(
        f"{API_PREFIX}/threads/{thread_id}", json={"archived": True}
    )
    assert archived.status_code == 200
    assert archived.json()["archived"] is True

    legacy = client.get(f"/sessions/{thread_id}")
    assert legacy.status_code == 200
    assert legacy.headers["deprecation"] == "true"


def test_spa_fallback_is_allowlisted_and_never_masks_api_typos(
    monkeypatch, tmp_path: Path
) -> None:
    client = _client(monkeypatch, tmp_path)

    direct_web_route = client.get("/threads/ses_123")
    assert direct_web_route.status_code == 200
    assert direct_web_route.text == "<html>relay-spa</html>"

    for path in ("/api/v1/missing", "/typoed-api/path", "/missing.js"):
        response = client.get(path)
        assert response.status_code == 404
        assert response.headers["content-type"].startswith("application/json")
        assert response.json() == {"detail": "Not found."}
