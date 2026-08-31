"""Routine rollups: a routine never runs itself, so its runs live in occurrences."""

from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from fastapi.testclient import TestClient

from relay.app import create_app
from relay.persistence.stores import relay_event
from relay.sessions import SessionController

PPTX_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


def _bootstrap(client: TestClient) -> None:
    assert client.post("/api/v1/auth/bootstrap", json={
        "token": "admin_token",
        "username": "admin",
        "password": "kestrel-vault-7719",
    }).status_code == 200
    assert client.post("/api/v1/auth/login", json={"username": "admin", "password": "kestrel-vault-7719"}).status_code == 200


def _create_agent(app: Any) -> dict[str, Any]:
    return app.state.agent_store.create_agent(
        "admin",
        {"displayName": "Routine Runner", "executorKind": "claude", "defaultRole": "implementer"},
    )


def _create_routine(client: TestClient, agent_id: str) -> dict[str, Any]:
    response = client.post("/api/v1/tasks", json={
        "title": "Weekly status deck",
        "assignedAgentId": agent_id,
        "isRoutine": True,
        "routineType": "job",
        "routineCadence": "weekly",
        "routineNextRunDate": "2026-06-25",
        "routineEnabled": True,
    })
    assert response.status_code == 201, response.text
    return response.json()


def _promote(app: Any, routine_id: str) -> dict[str, Any]:
    occurrence = app.state.task_store.promote_due_routine(
        routine_id, "2026-06-25", "2026-07-02", agent_override="claude"
    )
    assert occurrence is not None
    return occurrence


def _session_for(app: Any, task_id: str, workspace: str, agent_id: str) -> str:
    controller = SessionController(
        app.state.session_store,
        task_store=app.state.task_store,
        task_id=task_id,
        workspace_path=workspace,
        owner_employee_id="admin",
        owner_agent_id=agent_id,
    )
    return controller.create_session("Weekly status deck", ["human", "claude"])["id"]


def _workspace_artifact(workspace: str, name: str, *, artifact_id: str, created_at: str) -> dict[str, Any]:
    return {
        "id": artifact_id,
        "kind": "workspace_file",
        "title": name,
        "path": str(Path(workspace) / name),
        "createdAt": created_at,
        "bytes": 8,
        "contentType": PPTX_TYPE,
        "workspaceRelativePath": name,
    }


def test_routine_artifacts_roll_up_from_occurrences(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root, TemporaryDirectory() as ws:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        agent = _create_agent(app)
        routine = _create_routine(client, agent["id"])
        occurrence = _promote(app, routine["id"])
        session_id = _session_for(app, occurrence["id"], ws, agent["id"])
        deck = _workspace_artifact(ws, "deck.pptx", artifact_id="30000000-0000-4000-8000-000000000001", created_at="2026-06-25T09:00:00.000Z")
        app.state.session_store.append_event(
            session_id, relay_event("artifact.created", session_id, {"artifact": deck})
        )

        response = client.get(f"/api/v1/tasks/{routine['id']}/artifacts")
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["taskId"] == routine["id"]
        assert [item["id"] for item in body["artifacts"]] == [deck["id"]]
        # Attribution stays with the occurrence that actually produced the file.
        assert body["artifacts"][0]["taskId"] == occurrence["id"]
        assert body["artifacts"][0]["sessionId"] == session_id


def test_routine_artifacts_dedupe_regenerated_file_across_occurrences(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root, TemporaryDirectory() as ws:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        agent = _create_agent(app)
        routine = _create_routine(client, agent["id"])
        first = _promote(app, routine["id"])
        first_session = _session_for(app, first["id"], ws, agent["id"])
        second = app.state.task_store.promote_due_routine(
            routine["id"], "2026-07-02", "2026-07-09", agent_override="claude"
        )
        assert second is not None
        second_session = _session_for(app, second["id"], ws, agent["id"])

        stale = _workspace_artifact(ws, "deck.pptx", artifact_id="30000000-0000-4000-8000-000000000002", created_at="2026-06-25T09:00:00.000Z")
        fresh = _workspace_artifact(ws, "deck.pptx", artifact_id="30000000-0000-4000-8000-000000000003", created_at="2026-07-02T09:00:00.000Z")
        store = app.state.session_store
        store.append_event(first_session, relay_event("artifact.created", first_session, {"artifact": stale}))
        store.append_event(second_session, relay_event("artifact.created", second_session, {"artifact": fresh}))

        artifacts = client.get(f"/api/v1/tasks/{routine['id']}/artifacts").json()["artifacts"]
        assert [item["id"] for item in artifacts] == [fresh["id"]]
        assert artifacts[0]["taskId"] == second["id"]


def test_task_events_default_excludes_occurrence_events(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        agent = _create_agent(app)
        routine = _create_routine(client, agent["id"])
        occurrence = _promote(app, routine["id"])

        events = client.get(f"/api/v1/tasks/{routine['id']}/events").json()["events"]
        assert {event["taskId"] for event in events} == {routine["id"]}
        assert any(event["type"] == "task.occurrence_created" for event in events)
        assert all(event["taskId"] != occurrence["id"] for event in events)


def test_task_events_include_occurrences_merges_by_timestamp(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        agent = _create_agent(app)
        routine = _create_routine(client, agent["id"])
        occurrence = _promote(app, routine["id"])
        app.state.task_store.record_activity(occurrence["id"], "Run started")

        response = client.get(
            f"/api/v1/tasks/{routine['id']}/events", params={"include": "occurrences"}
        )
        assert response.status_code == 200, response.text
        events = response.json()["events"]
        assert {event["taskId"] for event in events} == {routine["id"], occurrence["id"]}
        timestamps = [event["timestamp"] for event in events]
        assert timestamps == sorted(timestamps)
        assert any(
            event["taskId"] == occurrence["id"] and event["type"] == "task.activity"
            for event in events
        )
