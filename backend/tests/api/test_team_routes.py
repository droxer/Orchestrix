from __future__ import annotations

import asyncio
import json
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from relay.api import task_routes
from relay.app import create_app


def _bootstrap(client: TestClient) -> None:
    assert client.post(
        "/auth/bootstrap",
        json={"token": "admin_token", "username": "admin", "password": "secret123"},
    ).status_code == 200


def _employee(client: TestClient, employee_id: str) -> None:
    assert client.post(
        "/cp/employees",
        json={
            "employeeId": employee_id,
            "username": employee_id,
            "password": "userpass",
            "displayName": employee_id.title(),
        },
    ).status_code == 201


def _agent(client: TestClient, employee_id: str, name: str, executor: str) -> dict:
    response = client.post(
        f"/cp/employees/{employee_id}/agents",
        json={"displayName": name, "executorKind": executor},
    )
    assert response.status_code == 201
    return response.json()["agent"]


def test_admin_and_employee_manage_teams(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)
        _employee(client, "alice")
        lead = _agent(client, "alice", "Lead", "codex")
        support = _agent(client, "alice", "Support", "claude")

        created = client.post(
            "/cp/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": lead["id"],
                "memberAgentIds": [lead["id"], support["id"]],
            },
        )
        assert created.status_code == 201
        team = created.json()["team"]
        assert team["ownerEmployeeId"] == "alice"
        assert "employeeId" not in team
        assert "supervisorEmployeeId" not in team
        assert team["lead"]["displayName"] == "Lead"
        assert [member["availability"] for member in team["members"]] == [
            "offline",
            "offline",
        ]
        admin_renamed = client.patch(
            f"/cp/teams/{team['id']}",
            json={
                "name": "Delivery admin",
                "leadAgentId": lead["id"],
                "memberAgentIds": [lead["id"], support["id"]],
                "enabled": True,
            },
        )
        assert admin_renamed.status_code == 200
        assert admin_renamed.json()["team"]["name"] == "Delivery admin"

        assert client.post("/auth/logout").status_code == 200
        assert client.post(
            "/auth/login", json={"username": "alice", "password": "userpass"}
        ).status_code == 200

        own = client.get("/teams")
        assert own.status_code == 200
        assert own.json()["teams"][0]["id"] == team["id"]
        renamed = client.patch(
            f"/teams/{team['id']}", json={"name": "Delivery crew"}
        )
        assert renamed.status_code == 200
        assert renamed.json()["team"]["name"] == "Delivery crew"


def test_legacy_supervisor_owned_team_can_be_assigned_to_task(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)
        _employee(client, "alice")
        lead = _agent(client, "alice", "Lead", "codex")
        team = client.post(
            "/cp/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Legacy delivery",
                "leadAgentId": lead["id"],
                "memberAgentIds": [lead["id"]],
            },
        ).json()["team"]

        snapshot_path = Path(root) / "teams" / team["id"] / "snapshot.json"
        legacy = json.loads(snapshot_path.read_text(encoding="utf-8"))
        legacy["supervisorEmployeeId"] = legacy.pop("ownerEmployeeId")
        snapshot_path.write_text(json.dumps(legacy), encoding="utf-8")

        created = client.post(
            "/tasks",
            json={
                "title": "Legacy team task",
                "assigneeEmployeeId": "alice",
                "assignedTeamId": team["id"],
            },
        )

        assert created.status_code == 201, created.json()
        assert created.json()["assignedTeamId"] == team["id"]


def test_employee_team_routes_cannot_access_another_employee_team(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)
        _employee(client, "alice")
        _employee(client, "bob")
        bob_lead = _agent(client, "bob", "Bob lead", "codex")
        team = client.post(
            "/cp/teams",
            json={
                "ownerEmployeeId": "bob",
                "name": "Bob delivery",
                "leadAgentId": bob_lead["id"],
                "memberAgentIds": [bob_lead["id"]],
            },
        ).json()["team"]
        assert client.get(f"/cp/teams/{team['id']}").status_code == 200

        assert client.post("/auth/logout").status_code == 200
        assert client.post(
            "/auth/login", json={"username": "alice", "password": "userpass"}
        ).status_code == 200

        assert client.get("/teams").json()["teams"] == []
        assert client.patch(
            f"/teams/{team['id']}", json={"name": "Stolen"}
        ).status_code == 403
        assert client.delete(f"/teams/{team['id']}").status_code == 403
        assert client.get(f"/teams/{team['id']}/artifacts").status_code == 403
        assert client.get(f"/workspace/brief?teamId={team['id']}").status_code == 403


def test_employee_reads_team_profile_artifacts_and_activity(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        _employee(client, "alice")
        lead = _agent(client, "alice", "Lead", "codex")
        team = client.post(
            "/cp/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": lead["id"],
                "memberAgentIds": [lead["id"]],
            },
        ).json()["team"]
        team_task = client.post(
            "/tasks",
            json={
                "title": "Team task",
                "assigneeEmployeeId": "alice",
                "assignedTeamId": team["id"],
                "status": "assigned",
            },
        ).json()
        individual_task = client.post(
            "/tasks",
            json={
                "title": "Individual task",
                "assigneeEmployeeId": "alice",
                "assignedAgentId": lead["id"],
            },
        ).json()
        session = app.state.session_store.create_session(
            {
                "workspacePath": "/workspace/alice",
                "ownerEmployeeId": "alice",
                "ownerAgentId": lead["id"],
                "teamId": team["id"],
                "taskGoal": "Ship together",
            }
        )
        unrelated_session = app.state.session_store.create_session(
            {
                "workspacePath": "/workspace/alice",
                "ownerEmployeeId": "alice",
                "ownerAgentId": lead["id"],
                "taskGoal": "Work alone",
            }
        )
        monkeypatch.setattr(
            app.state.registry,
            "monitor_nodes",
            lambda: [
                {
                    "id": "node_alice",
                    "employeeId": "alice",
                    "activeRuns": [
                        {
                            "runId": "run_team",
                            "sessionId": session["id"],
                            "logicalAgentId": lead["id"],
                            "taskGoal": "Ship together",
                            "agent": "codex",
                            "mode": "action",
                            "startedAt": "2026-07-23T00:00:00Z",
                        },
                        {
                            "runId": "run_individual",
                            "sessionId": unrelated_session["id"],
                            "logicalAgentId": lead["id"],
                            "taskGoal": "Work alone",
                            "agent": "codex",
                            "mode": "action",
                            "startedAt": "2026-07-23T00:00:01Z",
                        },
                    ],
                }
            ],
        )
        artifact, _ = app.state.session_store.create_artifact(
            session["id"],
            {
                "kind": "workspace_file",
                "title": "delivery.md",
                "body": "# Delivered",
                "agentId": lead["id"],
            },
        )

        assert client.post("/auth/logout").status_code == 200
        assert client.post(
            "/auth/login", json={"username": "alice", "password": "userpass"}
        ).status_code == 200

        brief = client.get(f"/workspace/brief?teamId={team['id']}")
        assert brief.status_code == 200
        payload = brief.json()
        assert payload["teamId"] == team["id"]
        assert [item["id"] for item in payload["sessions"]] == [session["id"]]
        assert [item["runId"] for item in payload["activeRuns"]] == ["run_team"]
        assert team_task["id"] in {item["id"] for item in payload["tasks"]}
        assert individual_task["id"] not in {item["id"] for item in payload["tasks"]}
        assert payload["metrics"]["artifactCount"] == 1

        artifacts = client.get(f"/teams/{team['id']}/artifacts")
        assert artifacts.status_code == 200
        artifact_payload = artifacts.json()
        assert artifact_payload["teamId"] == team["id"]
        assert len(artifact_payload["artifacts"]) == 1
        assert artifact_payload["artifacts"][0]["id"] == artifact["id"]
        assert artifact_payload["artifacts"][0]["sessionId"] == session["id"]


def test_team_rejects_cross_supervisor_members_and_assignment_conflicts(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)
        _employee(client, "alice")
        _employee(client, "bob")
        alice = _agent(client, "alice", "Lead", "codex")
        bob = _agent(client, "bob", "Outsider", "claude")

        rejected = client.post(
            "/cp/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Invalid",
                "leadAgentId": alice["id"],
                "memberAgentIds": [alice["id"], bob["id"]],
            },
        )
        assert rejected.status_code == 400
        assert rejected.json()["detail"] == "team_member_wrong_supervisor"

        team = client.post(
            "/cp/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": alice["id"],
                "memberAgentIds": [alice["id"]],
            },
        ).json()["team"]
        conflict = client.post(
            "/tasks",
            json={
                "title": "Conflicted",
                "ownerEmployeeId": "alice",
                "assigneeEmployeeId": "alice",
                "assignedAgentId": alice["id"],
                "assignedTeamId": team["id"],
            },
        )
        assert conflict.status_code == 400
        assert conflict.json()["detail"] == "task_agent_and_team_conflict"


def test_team_task_assignee_can_switch_to_one_of_their_agents(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)
        _employee(client, "requester")
        _employee(client, "alice")
        lead = _agent(client, "alice", "Lead", "codex")
        team = client.post(
            "/cp/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": lead["id"],
                "memberAgentIds": [lead["id"]],
            },
        ).json()["team"]
        task = client.post(
            "/tasks",
            json={
                "title": "Delegated delivery",
                "ownerEmployeeId": "requester",
                "assigneeEmployeeId": "alice",
                "assignedTeamId": team["id"],
            },
        ).json()

        assert client.post("/auth/logout").status_code == 200
        assert client.post(
            "/auth/login", json={"username": "alice", "password": "userpass"}
        ).status_code == 200

        switched = client.patch(
            f"/tasks/{task['id']}",
            json={"assignedAgentId": lead["id"], "assignedTeamId": None},
        )

        assert switched.status_code == 200
        updated = switched.json()
        assert updated["assignedAgentId"] == lead["id"]
        assert "assignedTeamId" not in updated
        assert updated["assigneeEmployeeId"] == "alice"

        reassigned_team = client.post(
            f"/tasks/{task['id']}/assign", json={"teamId": team["id"]}
        )
        assert reassigned_team.status_code == 200
        assert reassigned_team.json()["assignedTeamId"] == team["id"]

        reassigned_agent = client.post(
            f"/tasks/{task['id']}/assign", json={"agentId": lead["id"]}
        )
        assert reassigned_agent.status_code == 200
        assert reassigned_agent.json()["assignedAgentId"] == lead["id"]
        assert "assignedTeamId" not in reassigned_agent.json()


def test_admin_can_patch_owner_only_task_to_owners_team(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        _employee(client, "alice")
        lead = _agent(client, "alice", "Lead", "codex")
        team = client.post(
            "/cp/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": lead["id"],
                "memberAgentIds": [lead["id"]],
            },
        ).json()["team"]
        legacy = app.state.task_store.create_task(
            {"title": "Owner-only task", "ownerEmployeeId": "alice"}
        )

        assigned = client.patch(
            f"/tasks/{legacy['id']}", json={"assignedTeamId": team["id"]}
        )

        assert assigned.status_code == 200
        assert assigned.json()["assignedTeamId"] == team["id"]


def test_team_task_cannot_bypass_lead_routing_through_pickup(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)
        _employee(client, "alice")
        lead = _agent(client, "alice", "Lead", "codex")
        team = client.post(
            "/cp/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": lead["id"],
                "memberAgentIds": [lead["id"]],
            },
        ).json()["team"]
        task = client.post(
            "/tasks",
            json={
                "title": "Keep Team routing",
                "assigneeEmployeeId": "alice",
                "assignedTeamId": team["id"],
            },
        ).json()

        pickup = client.post(
            f"/tasks/{task['id']}/pickup", json={"agentId": lead["id"]}
        )

        assert pickup.status_code == 409
        assert pickup.json()["detail"] == "team_task_requires_team_start"
        unchanged = client.get(f"/tasks/{task['id']}").json()
        assert unchanged["assignedTeamId"] == team["id"]
        assert "assignedAgentId" not in unchanged


def test_agent_pickup_thread_is_owned_by_the_task_assignee(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        _employee(client, "alice")
        _employee(client, "requester")
        agent = _agent(client, "alice", "Builder", "codex")
        task = app.state.task_store.create_task(
            {
                "title": "Delegated pickup",
                "ownerEmployeeId": "requester",
                "assigneeEmployeeId": "alice",
            }
        )

        pickup = client.post(
            f"/tasks/{task['id']}/pickup", json={"agentId": agent["id"]}
        )

        assert pickup.status_code == 200
        payload = pickup.json()
        assert payload["task"]["assigneeEmployeeId"] == "alice"
        assert payload["session"]["ownerEmployeeId"] == "alice"
        assert payload["session"]["ownerAgentId"] == agent["id"]


def test_task_owner_can_edit_delegated_team_task_without_reassigning_it(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)
        _employee(client, "alice")
        _employee(client, "requester")
        lead = _agent(client, "alice", "Lead", "codex")
        team = client.post(
            "/cp/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": lead["id"],
                "memberAgentIds": [lead["id"]],
            },
        ).json()["team"]
        task = client.post(
            "/tasks",
            json={
                "title": "Delegated work",
                "ownerEmployeeId": "requester",
                "assigneeEmployeeId": "alice",
                "assignedTeamId": team["id"],
            },
        ).json()
        assert client.post("/auth/logout").status_code == 200
        assert client.post(
            "/auth/login", json={"username": "requester", "password": "userpass"}
        ).status_code == 200

        edited = client.patch(
            f"/tasks/{task['id']}",
            json={
                "title": "Delegated work clarified",
                "assignedAgentId": None,
                "assignedTeamId": team["id"],
            },
        )

        assert edited.status_code == 200
        assert edited.json()["title"] == "Delegated work clarified"
        assert edited.json()["assignedTeamId"] == team["id"]


def test_deleting_lead_agent_promotes_next_member(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        _employee(client, "alice")
        lead = _agent(client, "alice", "Lead", "codex")
        support = _agent(client, "alice", "Support", "claude")
        team = client.post(
            "/cp/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": lead["id"],
                "memberAgentIds": [lead["id"], support["id"]],
            },
        ).json()["team"]

        assert client.delete(f"/cp/agents/{lead['id']}").status_code == 202

        updated = app.state.team_store.get_team(team["id"])
        assert updated["leadAgentId"] == support["id"]
        assert updated["memberAgentIds"] == [support["id"]]


def test_startup_repairs_team_members_deleted_by_an_older_runtime(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        _employee(client, "alice")
        deleted_lead = _agent(client, "alice", "Deleted lead", "codex")
        support = _agent(client, "alice", "Support", "claude")
        team = client.post(
            "/cp/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Legacy delivery",
                "leadAgentId": deleted_lead["id"],
                "memberAgentIds": [deleted_lead["id"], support["id"]],
            },
        ).json()["team"]

        # Simulate historical data written by a runtime that deleted the agent
        # without removing its Team membership.
        app.state.agent_store.delete_agent(deleted_lead["id"])

        restarted = create_app(root)
        repaired = restarted.state.team_store.get_team(team["id"])

        assert repaired["leadAgentId"] == support["id"]
        assert repaired["memberAgentIds"] == [support["id"]]


def test_task_assigned_to_team_starts_all_members_lead_first_in_assignee_thread(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        _employee(client, "alice")
        _employee(client, "requester")
        app.state.registry.register(
            {
                "sandboxId": "node_alice",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["codex", "claude"],
                "status": "ready",
            }
        )
        lead = _agent(client, "alice", "Lead", "codex")
        support = _agent(client, "alice", "Support", "claude")
        for agent in (lead, support):
            assert client.post(
                f"/cp/agents/{agent['id']}/placements",
                json={"daemonNodeId": "node_alice"},
            ).status_code == 201
        team = client.post(
            "/cp/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": lead["id"],
                "memberAgentIds": [lead["id"], support["id"]],
            },
        ).json()["team"]
        task = client.post(
            "/tasks",
            json={
                "title": "Ship with the team",
                "ownerEmployeeId": "requester",
                "assigneeEmployeeId": "alice",
                "assignedTeamId": team["id"],
            },
        ).json()

        assert task["assignedTeamId"] == team["id"]
        assert "assignedAgentId" not in task
        started = client.post(
            f"/tasks/{task['id']}/start",
            json={"assignments": [{"agent": "pi", "mode": "ask"}]},
        )

        assert started.status_code == 202
        payload = started.json()
        assert payload["dispatch"]["state"] == "started"
        assert payload["session"]["teamId"] == team["id"]
        assert payload["session"]["ownerEmployeeId"] == "alice"
        assert payload["session"]["ownerAgentId"] == lead["id"]
        assert client.get(f"/sessions/{payload['session']['id']}").json()["teamId"] == team["id"]
        assert len(payload["session"]["agentRuns"]) == 1
        assert payload["session"]["agentRuns"][0]["logicalAgentId"] == lead["id"]
        [lead_command] = app.state.registry.take_commands("node_alice", "node_token")
        assert lead_command["logicalAgentId"] == lead["id"]
        app.state.registry.handle_event(
            "node_alice",
            {
                "type": "run.completed",
                "commandId": lead_command["id"],
                "sessionId": lead_command["sessionId"],
                "runId": lead_command["runId"],
                "agent": "codex",
                "mode": "action",
                "exitCode": 0,
                "agentLog": "lead result",
            },
            "node_token",
        )
        [support_command] = app.state.registry.take_commands("node_alice", "node_token")
        assert support_command["logicalAgentId"] == support["id"]
        assert support_command["agent"] == "claude"


def test_unroutable_team_start_requests_capacity_and_queues_scheduler_retry(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        _employee(client, "alice")
        lead = _agent(client, "alice", "Lead", "codex")
        team = client.post(
            "/cp/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": lead["id"],
                "memberAgentIds": [lead["id"]],
            },
        ).json()["team"]
        task = client.post(
            "/tasks",
            json={
                "title": "Wait for the lead",
                "assigneeEmployeeId": "alice",
                "assignedTeamId": team["id"],
            },
        ).json()
        assert task["status"] == "backlog"

        started = client.post(f"/tasks/{task['id']}/start", json={})

        assert started.status_code == 202
        payload = started.json()
        assert payload["session"] is None
        assert payload["dispatch"]["state"] == "queued"
        assert payload["task"]["status"] == "assigned"
        assert payload["task"]["activity"][-1]["message"] == (
            "Managed node provisioning requested for alice."
        )
        [managed] = app.state.managed_node_store.list_nodes()
        assert managed["employeeId"] == "alice"
        assert client.get(f"/tasks/{task['id']}").json()["status"] == "assigned"

        attempt = client.post(f"/cp/managed-nodes/{managed['id']}/attempts")
        assert attempt.status_code == 201
        enrolled = client.post(
            "/daemon-enroll",
            json={"workspacePath": "/workspace/alice"},
            headers={
                "Authorization": f"Enrollment {attempt.json()['enrollmentCredential']}"
            },
        )
        assert enrolled.status_code == 201
        runtime = enrolled.json()
        registered = client.post(
            "/daemon-nodes/register",
            json={
                "sandboxId": runtime["sandboxId"],
                "token": runtime["token"],
                "workspacePath": "/workspace/alice",
                "sandboxMode": "boxlite",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            },
        )
        assert registered.status_code == 200

        tick = asyncio.run(app.state.task_scheduler.tick())

        assert tick.dispatched == 1
        commands = client.get(
            f"/daemon-nodes/{runtime['sandboxId']}/commands",
            headers={"Authorization": f"Bearer {runtime['token']}"},
        ).json()["commands"]
        [command] = commands
        assert command["logicalAgentId"] == lead["id"]


def test_team_task_create_session_uses_assignee_lead_and_team_ownership(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)
        _employee(client, "alice")
        _employee(client, "requester")
        lead = _agent(client, "alice", "Lead", "codex")
        support = _agent(client, "alice", "Support", "claude")
        team = client.post(
            "/cp/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": lead["id"],
                "memberAgentIds": [lead["id"], support["id"]],
            },
        ).json()["team"]

        task = client.post(
            "/tasks",
            json={
                "title": "Create the Team thread",
                "ownerEmployeeId": "requester",
                "assigneeEmployeeId": "alice",
                "assignedTeamId": team["id"],
                "createSession": True,
            },
        ).json()

        [session_id] = task["linkedSessionIds"]
        session = client.get(f"/sessions/{session_id}").json()
        assert session["teamId"] == team["id"]
        assert session["ownerEmployeeId"] == "alice"
        assert session["ownerAgentId"] == lead["id"]
        assert session["participants"] == ["human", "codex", "claude"]


def test_linked_session_uses_team_task_assignee_lead_and_team_ownership(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)
        _employee(client, "alice")
        _employee(client, "requester")
        lead = _agent(client, "alice", "Lead", "codex")
        support = _agent(client, "alice", "Support", "claude")
        team = client.post(
            "/cp/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": lead["id"],
                "memberAgentIds": [lead["id"], support["id"]],
            },
        ).json()["team"]
        task = client.post(
            "/tasks",
            json={
                "title": "Link a Team thread",
                "ownerEmployeeId": "requester",
                "assigneeEmployeeId": "alice",
                "assignedTeamId": team["id"],
            },
        ).json()

        created = client.post(
            "/sessions",
            json={"taskGoal": "Link a Team thread", "taskId": task["id"]},
        )

        assert created.status_code == 201
        session = created.json()
        assert session["teamId"] == team["id"]
        assert session["ownerEmployeeId"] == "alice"
        assert session["ownerAgentId"] == lead["id"]
        assert session["participants"] == ["human", "codex", "claude"]


def test_manual_team_routine_start_creates_retryable_team_occurrence(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        _employee(client, "alice")
        lead = _agent(client, "alice", "Lead", "codex")
        team = client.post(
            "/cp/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": lead["id"],
                "memberAgentIds": [lead["id"]],
            },
        ).json()["team"]
        routine = client.post(
            "/tasks",
            json={
                "title": "Run the Team routine",
                "assigneeEmployeeId": "alice",
                "assignedTeamId": team["id"],
                "isRoutine": True,
                "routineCadence": "weekly",
                "routineNextRunDate": "2099-01-01",
                "routineEnabled": True,
            },
        ).json()

        started = client.post(f"/tasks/{routine['id']}/start", json={})

        assert started.status_code == 202
        payload = started.json()
        assert payload["session"] is None
        occurrence = payload["task"]
        assert occurrence["id"] != routine["id"]
        assert occurrence["sourceRoutineId"] == routine["id"]
        assert occurrence["assignedTeamId"] == team["id"]
        assert occurrence["status"] == "assigned"
        refreshed = client.get(f"/tasks/{routine['id']}").json()
        assert occurrence["id"] in refreshed["occurrenceIds"]
        [managed] = app.state.managed_node_store.list_nodes()
        assert managed["employeeId"] == "alice"


def test_manual_team_routine_start_reuses_occurrence_promoted_today(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")

    class FixedDate(date):
        @classmethod
        def today(cls) -> date:
            return cls(2026, 7, 23)

    monkeypatch.setattr(task_routes, "date", FixedDate)
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        _employee(client, "alice")
        app.state.registry.register(
            {
                "sandboxId": "node_alice",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            }
        )
        lead = _agent(client, "alice", "Lead", "codex")
        assert (
            client.post(
                f"/cp/agents/{lead['id']}/placements",
                json={"daemonNodeId": "node_alice"},
            ).status_code
            == 201
        )
        team = client.post(
            "/cp/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": lead["id"],
                "memberAgentIds": [lead["id"]],
            },
        ).json()["team"]
        routine = client.post(
            "/tasks",
            json={
                "title": "Run today's Team routine",
                "assigneeEmployeeId": "alice",
                "assignedTeamId": team["id"],
                "isRoutine": True,
                "routineCadence": "daily",
                "routineNextRunDate": "2026-07-23",
                "routineEnabled": True,
            },
        ).json()
        promoted = app.state.task_store.promote_due_routine(
            routine["id"], "2026-07-23", "2026-07-24"
        )
        assert promoted is not None
        first_start = client.post(f"/tasks/{promoted['id']}/start", json={})
        assert first_start.status_code == 202
        assert first_start.json()["session"] is not None

        started = client.post(f"/tasks/{routine['id']}/start", json={})

        assert started.status_code == 202
        assert started.json()["task"]["id"] == promoted["id"]
        assert started.json()["session"]["id"] == first_start.json()["session"]["id"]
        assert started.json()["dispatch"] == {
            "state": "started",
            "code": "already_started",
        }
        refreshed = client.get(f"/tasks/{routine['id']}").json()
        assert refreshed["occurrenceIds"] == [promoted["id"]]
        assert refreshed["linkedSessionIds"] == [first_start.json()["session"]["id"]]


def test_empty_team_cannot_create_a_task_thread_without_lead_ownership(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)
        _employee(client, "alice")
        lead = _agent(client, "alice", "Lead", "codex")
        team = client.post(
            "/cp/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": lead["id"],
                "memberAgentIds": [lead["id"]],
            },
        ).json()["team"]
        assert client.delete(f"/cp/agents/{lead['id']}").status_code == 202

        create_with_thread = client.post(
            "/tasks",
            json={
                "title": "No lead thread",
                "assigneeEmployeeId": "alice",
                "assignedTeamId": team["id"],
                "createSession": True,
            },
        )

        assert create_with_thread.status_code == 409
        assert create_with_thread.json()["detail"] == "team_unavailable"

        task = client.post(
            "/tasks",
            json={
                "title": "No lead task",
                "assigneeEmployeeId": "alice",
                "assignedTeamId": team["id"],
            },
        ).json()
        linked = client.post(
            "/sessions", json={"taskGoal": "No lead thread", "taskId": task["id"]}
        )
        assert linked.status_code == 409
        assert linked.json()["detail"] == "team_unavailable"


def test_assign_endpoint_rejects_unavailable_team(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap(client)
        _employee(client, "alice")
        lead = _agent(client, "alice", "Lead", "codex")
        team = client.post(
            "/cp/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": lead["id"],
                "memberAgentIds": [lead["id"]],
            },
        ).json()["team"]
        task = client.post(
            "/tasks",
            json={"title": "Assignable", "assigneeEmployeeId": "alice"},
        ).json()

        assigned = client.post(
            f"/tasks/{task['id']}/assign", json={"teamId": team["id"]}
        )
        assert assigned.status_code == 200
        assert assigned.json()["assignedTeamId"] == team["id"]
        assert assigned.json()["status"] == "assigned"

        assert client.patch(
            f"/cp/teams/{team['id']}", json={"enabled": False}
        ).status_code == 200
        rejected = client.post(
            f"/tasks/{task['id']}/assign", json={"teamId": team["id"]}
        )
        assert rejected.status_code == 409
        assert rejected.json()["detail"] == "team_unavailable"
