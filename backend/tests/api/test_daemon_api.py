from __future__ import annotations

import json
from tempfile import TemporaryDirectory
import time

from fastapi.testclient import TestClient

from relay.app import create_app


def _bootstrap_admin(client: TestClient) -> None:
    response = client.post("/auth/bootstrap", json={
        "token": "admin_token",
        "username": "admin",
        "password": "secret123",
    })
    assert response.status_code == 200


def _login_admin(client: TestClient) -> None:
    response = client.post("/auth/login", json={
        "username": "admin",
        "password": "secret123",
    })
    assert response.status_code == 200


def _login(client: TestClient, username: str, password: str) -> None:
    response = client.post("/auth/login", json={
        "username": username,
        "password": password,
    })
    assert response.status_code == 200


def _create_user(client: TestClient, username: str, *, employee_id: str) -> None:
    response = client.post("/cp/users", json={
        "username": username,
        "password": "userpass",
        "role": "user",
        "employeeId": employee_id,
    })
    assert response.status_code == 201


def test_workspace_event_is_authorized_and_resolves_query_broker(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        app.state.registry.register({"sandboxId": "sbx_workspace", "employeeId": "alice", "token": "node_token", "protocolVersion": 1, "supportedAgents": ["codex"], "status": "ready"})
        received: list[tuple[str, str, dict]] = []

        class Broker:
            def resolve(self, command_id, sandbox_id, payload):
                received.append((command_id, sandbox_id, payload))
                return True

        app.state.workspace_query_broker = Broker()
        event = {"type": "workspace.listing", "commandId": "cmd_1", "agentId": "agent_1", "path": "", "exists": True, "entries": []}
        response = client.post("/daemon-nodes/sbx_workspace/events", json=event, headers={"Authorization": "Bearer node_token"})
        assert response.status_code == 202
        assert received == [("cmd_1", "sbx_workspace", event)]
        assert client.post("/daemon-nodes/sbx_workspace/events", json=event, headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_managed_node_provisioning_enrolls_runtime_with_single_use_grant(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _login_admin(client)

        rejected_local = client.post("/cp/managed-nodes", json={
            "employeeId": "alice",
            "provider": "local-process",
            "sandboxMode": "none",
        })
        assert rejected_local.status_code == 409
        assert "require sandboxMode boxlite" in rejected_local.json()["detail"]

        created = client.post("/cp/managed-nodes", json={
            "employeeId": "alice",
            "provider": "local-process",
            "sandboxMode": "boxlite",
        })
        assert created.status_code == 202
        managed_node = created.json()["node"]

        [placeholder] = client.get("/cp/daemon-nodes").json()["nodes"]
        assert placeholder["id"] == managed_node["id"]
        assert placeholder["managedNodeId"] == managed_node["id"]
        assert placeholder["provisioningPlaceholder"] is True
        assert placeholder["status"] == "provisioning"

        attempt_response = client.post(f"/cp/managed-nodes/{managed_node['id']}/attempts")
        assert attempt_response.status_code == 201
        credential = attempt_response.json()["enrollmentCredential"]

        enrollment = client.post(
            "/daemon-enroll",
            json={"workspacePath": "/workspace/alice"},
            headers={"Authorization": f"Enrollment {credential}"},
        )
        assert enrollment.status_code == 201
        runtime = enrollment.json()
        assert runtime["sandboxMode"] == "boxlite"

        duplicate = client.post(
            "/daemon-enroll",
            json={"workspacePath": "/workspace/alice"},
            headers={"Authorization": f"Enrollment {credential}"},
        )
        assert duplicate.status_code == 401

        registered = client.post("/daemon-nodes/register", json={
            "sandboxId": runtime["sandboxId"],
            "token": runtime["token"],
            "workspacePath": "/workspace/alice",
            "sandboxMode": "boxlite",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "status": "ready",
        })
        assert registered.status_code == 200
        assert registered.json()["managedNodeId"] == managed_node["id"]

        managed = client.get(f"/cp/managed-nodes/{managed_node['id']}")
        assert managed.status_code == 200
        assert managed.json()["node"]["phase"] == "ready"
        control_panel_node = client.get("/cp/daemon-nodes").json()["nodes"][0]
        assert control_panel_node["managedNodeId"] == managed_node["id"]
        assert control_panel_node["displayName"] == managed_node["displayName"]
        assert "nodeToken" not in control_panel_node

        deleted = client.delete(f"/cp/managed-nodes/{managed_node['id']}")
        assert deleted.status_code == 202
        assert deleted.json()["node"]["desiredState"] == "deleted"
        fenced = client.app.state.registry.get(runtime["sandboxId"])
        assert fenced["status"] == "stopped"
        assert fenced["retiredAt"]
        heartbeat = client.post("/daemon-nodes/register", json={
            "sandboxId": runtime["sandboxId"],
            "token": runtime["token"],
            "workspacePath": "/workspace/alice",
            "sandboxMode": "boxlite",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "status": "ready",
        })
        assert heartbeat.status_code == 200
        assert heartbeat.json()["status"] == "stopped"
        assert client.get("/cp/daemon-nodes").json()["nodes"] == []


def test_legacy_managed_node_with_retired_policy_can_be_deleted(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _login_admin(client)

        node = app.state.managed_node_store.create_node({"employeeId": "alice"})
        app.state.managed_node_store._write_node({
            **node,
            "displayName": "Managed node for pool",
            "assignmentMode": "pooled",
            "sandboxMode": "none",
            "workspacePolicy": {"kind": "managed-pool"},
        })

        deleted = client.delete(f"/cp/managed-nodes/{node['id']}")

        assert deleted.status_code == 202
        assert deleted.json()["node"]["desiredState"] == "deleted"


def test_admin_can_permanently_delete_terminal_managed_node_record(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _login_admin(client)

        created = client.post(
            "/cp/managed-nodes",
            json={"employeeId": "alice", "sandboxMode": "boxlite"},
        ).json()["node"]

        premature = client.delete(
            f"/cp/managed-nodes/{created['id']}/permanent"
        )
        assert premature.status_code == 409
        assert "finish deletion" in premature.json()["detail"]

        app.state.managed_node_store.update_node(
            created["id"], {"desiredState": "deleted"}
        )
        app.state.managed_node_store.update_node(created["id"], {"phase": "deleted"})

        purged = client.delete(f"/cp/managed-nodes/{created['id']}/permanent")

        assert purged.status_code == 204
        assert client.get(f"/cp/managed-nodes/{created['id']}").status_code == 404


def test_managed_node_runtime_cannot_be_drained_or_retired_during_active_run(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _login_admin(client)

        managed = app.state.managed_node_store.create_node({"employeeId": "alice"})
        runtime_id = "sbx_busy_managed"
        app.state.managed_node_store._write_node(
            {
                **managed,
                "activeDaemonNodeId": runtime_id,
                "phase": "ready",
            }
        )
        app.state.registry.register(
            {
                "sandboxId": runtime_id,
                "employeeId": "alice",
                "token": "node_token",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            }
        )
        app.state.registry.daemon_store.create_run_request(
            {
                "nodeId": runtime_id,
                "sessionId": "session_busy_managed",
                "taskGoal": "Keep this runtime busy",
                "assignments": [],
                "state": {},
            }
        )

        drained = client.post(f"/cp/managed-nodes/{managed['id']}/drain")
        retired = client.delete(f"/cp/managed-nodes/{managed['id']}/runtime")

        assert drained.status_code == 409
        assert retired.status_code == 409
        assert app.state.registry.get(runtime_id) is not None
        assert app.state.managed_node_store.get_node(managed["id"])["desiredState"] == "running"


def test_failed_managed_node_is_visible_as_failed(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login_admin(client)
        managed = client.post(
            "/cp/managed-nodes",
            json={"employeeId": "alice", "sandboxMode": "boxlite"},
        ).json()["node"]
        attempt = client.post(
            f"/cp/managed-nodes/{managed['id']}/attempts"
        ).json()["attempt"]

        failed = client.patch(
            f"/cp/managed-nodes/{managed['id']}/attempts/{attempt['id']}",
            json={"status": "failed", "errorMessage": "provider unavailable"},
        )

        assert failed.status_code == 200
        [placeholder] = client.get("/cp/daemon-nodes").json()["nodes"]
        assert placeholder["status"] == "failed"
        assert placeholder["lastError"] == "provider unavailable"


def test_fastapi_daemon_routes_register_and_poll(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _login_admin(client)
        response = client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_alice",
            "employeeId": "alice",
            "token": "node_token",
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["claude", "codex"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})

        assert response.status_code == 200
        assert response.json()["agents"]["codex"] == "ready"
        response = client.get("/daemon-nodes/sbx_alice/commands", headers={"Authorization": "Bearer node_token"})
        assert response.status_code == 200
        assert response.json() == {"commands": []}

        run = client.post("/sandboxes/sbx_alice/runs", json={
            "taskGoal": "review auth",
            "assignments": [{"agent": "codex", "mode": "review"}],
        }, headers={"Authorization": "Bearer ui_token"})
        assert run.status_code == 202
        response = client.get(
            "/daemon-nodes/sbx_alice/commands?limit=1&leaseSeconds=5",
            headers={"Authorization": "Bearer node_token"},
        )
        assert response.status_code == 200
        [command] = response.json()["commands"]
        assert command["type"] == "run.start"
        assert command["attempt"] == 1
        assert command["leaseId"].startswith("lease_")
        assert command["leaseExpiresAt"]

        response = client.get("/daemon-nodes/sbx_alice/commands?limit=0", headers={"Authorization": "Bearer node_token"})
        assert response.status_code == 400
        response = client.get("/daemon-nodes/sbx_alice/commands?waitSeconds=NaN", headers={"Authorization": "Bearer node_token"})
        assert response.status_code == 400
        response = client.get("/cp/daemon-nodes")
        assert response.status_code == 200
        assert response.json()["nodes"][0].get("nodeToken") == "node_token"


def test_explicit_command_leases_redeliver_work_missing_from_daemon_heartbeat(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _login_admin(client)
        response = client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_alice",
            "employeeId": "alice",
            "token": "node_token",
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})
        assert response.status_code == 200

        run = client.post("/sandboxes/sbx_alice/runs", json={
            "taskGoal": "recover this run",
            "assignments": [{"agent": "codex", "mode": "action"}],
        }, headers={"Authorization": "Bearer ui_token"})
        assert run.status_code == 202

        first = client.get(
            "/daemon-nodes/sbx_alice/commands?leaseMode=explicit&leaseSeconds=1",
            headers={"Authorization": "Bearer node_token"},
        )
        assert first.status_code == 200
        [first_command] = first.json()["commands"]
        assert first_command["attempt"] == 1

        time.sleep(1.05)

        second = client.get(
            "/daemon-nodes/sbx_alice/commands?leaseMode=explicit&leaseSeconds=1",
            headers={"Authorization": "Bearer node_token"},
        )
        assert second.status_code == 200
        [second_command] = second.json()["commands"]
        assert second_command["id"] == first_command["id"]
        assert second_command["attempt"] == 2
        assert second_command["leaseId"] != first_command["leaseId"]

        stale_output = client.post("/daemon-nodes/sbx_alice/events", json={
            "type": "run.output",
            "commandId": first_command["id"],
            "leaseId": first_command["leaseId"],
            "sessionId": first_command["sessionId"],
            "runId": first_command["runId"],
            "agent": first_command["agent"],
            "stream": "stdout",
            "text": "superseded delivery",
            "sequence": 0,
        }, headers={"Authorization": "Bearer node_token"})
        assert stale_output.status_code == 401

        current_output = client.post("/daemon-nodes/sbx_alice/events", json={
            "type": "run.output",
            "commandId": second_command["id"],
            "leaseId": second_command["leaseId"],
            "sessionId": second_command["sessionId"],
            "runId": second_command["runId"],
            "agent": second_command["agent"],
            "stream": "stdout",
            "text": "current delivery",
            "sequence": 0,
        }, headers={"Authorization": "Bearer node_token"})
        assert current_output.status_code == 202


def test_output_event_does_not_replace_explicit_lease_heartbeat(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _login_admin(client)
        response = client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_alice",
            "employeeId": "alice",
            "token": "node_token",
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})
        assert response.status_code == 200

        run = client.post("/sandboxes/sbx_alice/runs", json={
            "taskGoal": "recover after output",
            "assignments": [{"agent": "codex", "mode": "action"}],
        }, headers={"Authorization": "Bearer ui_token"})
        assert run.status_code == 202
        [first] = client.get(
            "/daemon-nodes/sbx_alice/commands?leaseMode=explicit&leaseSeconds=1",
            headers={"Authorization": "Bearer node_token"},
        ).json()["commands"]

        output = client.post("/daemon-nodes/sbx_alice/events", json={
            "type": "run.output",
            "commandId": first["id"],
            "leaseId": first["leaseId"],
            "sessionId": first["sessionId"],
            "runId": first["runId"],
            "agent": first["agent"],
            "stream": "stdout",
            "text": "still working\n",
            "sequence": 0,
        }, headers={"Authorization": "Bearer node_token"})
        assert output.status_code == 202

        time.sleep(1.05)

        [redelivered] = client.get(
            "/daemon-nodes/sbx_alice/commands?leaseMode=explicit&leaseSeconds=1",
            headers={"Authorization": "Bearer node_token"},
        ).json()["commands"]
        assert redelivered["id"] == first["id"]
        assert redelivered["attempt"] == 2


def test_run_completed_finalizes_even_when_token_usage_is_unusable(monkeypatch) -> None:
    """A malformed usage report must not strand the run.

    The daemon posts its terminal event once and drops it on rejection. If the
    backend 400s the whole event over telemetry, the session stays "running"
    and — runs being exclusive per node — every later dispatch is refused until
    the run timeout reaps it. The counts are dropped; the run completes.
    """
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _login_admin(client)
        assert client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_alice",
            "employeeId": "alice",
            "token": "node_token",
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"}).status_code == 200
        run = client.post("/sandboxes/sbx_alice/runs", json={
            "taskGoal": "report broken usage",
            "assignments": [{"agent": "codex", "mode": "action"}],
        }, headers={"Authorization": "Bearer ui_token"})
        assert run.status_code == 202
        session_id = run.json()["id"]
        [command] = client.get(
            "/daemon-nodes/sbx_alice/commands?leaseMode=explicit&leaseSeconds=90",
            headers={"Authorization": "Bearer node_token"},
        ).json()["commands"]

        completed = client.post("/daemon-nodes/sbx_alice/events", json={
            "type": "run.completed",
            "commandId": command["id"],
            "leaseId": command["leaseId"],
            "sessionId": command["sessionId"],
            "runId": command["runId"],
            "agent": command["agent"],
            "mode": command["mode"],
            "exitCode": 0,
            "agentLog": "[Codex Action Exit 0]",
            "tokenUsage": {"input": 1, "output": 1, "cache": 0, "total": 9},
        }, headers={"Authorization": "Bearer node_token"})
        assert completed.status_code == 202

        session = client.get(f"/sessions/{session_id}").json()
        assert session["status"] == "completed"
        assert session.get("tokenUsage") is None
        node = next(
            item for item in client.get("/daemon-nodes").json()["nodes"] if item["id"] == "sbx_alice"
        )
        assert node["activeRuns"] == []


def test_daemon_delivery_output_reaches_the_canonical_session_stream(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _login_admin(client)
        registered = client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_alice",
            "employeeId": "alice",
            "token": "node_token",
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})
        assert registered.status_code == 200
        run = client.post("/sandboxes/sbx_alice/runs", json={
            "taskGoal": "stream this answer",
            "assignments": [{"agent": "codex", "mode": "action"}],
        }, headers={"Authorization": "Bearer ui_token"})
        assert run.status_code == 202
        session_id = run.json()["id"]
        [command] = client.get(
            "/daemon-nodes/sbx_alice/commands?leaseMode=explicit&leaseSeconds=90",
            headers={"Authorization": "Bearer node_token"},
        ).json()["commands"]

        output = client.post("/daemon-nodes/sbx_alice/events", json={
            "type": "run.output",
            "commandId": command["id"],
            "leaseId": command["leaseId"],
            "sessionId": command["sessionId"],
            "runId": command["runId"],
            "agent": command["agent"],
            "stream": "stdout",
            "text": "hello from the daemon",
            "sequence": 0,
        }, headers={"Authorization": "Bearer node_token"})
        assert output.status_code == 202
        collaboration_payload = {
            "id": "collab-1",
            "tool": "spawnAgent",
            "status": "completed",
            "senderThreadId": "root-thread",
            "receiverThreadIds": ["child-thread"],
            "prompt": "Review the change",
            "model": None,
            "reasoningEffort": None,
            "agentsStates": {
                "child-thread": {"status": "running", "message": "Reviewing"}
            },
        }
        collaboration = client.post("/daemon-nodes/sbx_alice/events", json={
            "type": "run.collaboration",
            "commandId": command["id"],
            "leaseId": command["leaseId"],
            "sessionId": command["sessionId"],
            "runId": command["runId"],
            "agent": command["agent"],
            "mode": command["mode"],
            "collaboration": collaboration_payload,
            "sequence": 1,
        }, headers={"Authorization": "Bearer node_token"})
        assert collaboration.status_code == 202
        completed = client.post("/daemon-nodes/sbx_alice/events", json={
            "type": "run.completed",
            "commandId": command["id"],
            "leaseId": command["leaseId"],
            "sessionId": command["sessionId"],
            "runId": command["runId"],
            "agent": command["agent"],
            "mode": command["mode"],
            "exitCode": 0,
        }, headers={"Authorization": "Bearer node_token"})
        assert completed.status_code == 202

        stream = client.get(f"/sessions/{session_id}/events")
        payloads = [
            json.loads(line.removeprefix("data: "))
            for line in stream.text.splitlines()
            if line.startswith("data: {")
        ]
        assert [event["text"] for event in payloads if event.get("type") == "agent.output"] == [
            "hello from the daemon"
        ]
        assert [event["collaboration"] for event in payloads if event.get("type") == "agent.collaboration"] == [
            collaboration_payload
        ]
        assert any(event.get("type") == "session.completed" for event in payloads)


def test_cancel_command_is_redelivered_until_run_termination_confirms_it(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _login_admin(client)
        response = client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_alice",
            "employeeId": "alice",
            "token": "node_token",
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})
        assert response.status_code == 200

        run = client.post("/sandboxes/sbx_alice/runs", json={
            "taskGoal": "cancel this run reliably",
            "assignments": [{"agent": "codex", "mode": "action"}],
        }, headers={"Authorization": "Bearer ui_token"})
        assert run.status_code == 202
        session_id = run.json()["id"]
        [start] = client.get(
            "/daemon-nodes/sbx_alice/commands?leaseMode=explicit&leaseSeconds=1",
            headers={"Authorization": "Bearer node_token"},
        ).json()["commands"]

        cancel = client.post(
            f"/sandboxes/sbx_alice/runs/{session_id}/cancel",
            json={"reason": "no longer needed"},
            headers={"Authorization": "Bearer ui_token"},
        )
        assert cancel.status_code == 202
        poll_url = (
            "/daemon-nodes/sbx_alice/commands"
            f"?leaseMode=explicit&leaseSeconds=1&activeCommandLease={start['id']}:{start['leaseId']}"
        )
        [first_cancel] = client.get(
            poll_url,
            headers={"Authorization": "Bearer node_token"},
        ).json()["commands"]
        assert first_cancel["type"] == "run.cancel"
        assert first_cancel["attempt"] == 1

        time.sleep(1.05)

        [second_cancel] = client.get(
            poll_url,
            headers={"Authorization": "Bearer node_token"},
        ).json()["commands"]
        assert second_cancel["id"] == first_cancel["id"]
        assert second_cancel["attempt"] == 2

        terminal = client.post("/daemon-nodes/sbx_alice/events", json={
            "type": "run.cancelled",
            "commandId": start["id"],
            "leaseId": start["leaseId"],
            "sessionId": start["sessionId"],
            "runId": start["runId"],
            "agent": start["agent"],
            "mode": start["mode"],
            "reason": "no longer needed",
        }, headers={"Authorization": "Bearer node_token"})
        assert terminal.status_code == 202

        after_terminal = client.get(
            "/daemon-nodes/sbx_alice/commands?leaseMode=explicit&leaseSeconds=1",
            headers={"Authorization": "Bearer node_token"},
        )
        assert after_terminal.status_code == 200
        assert after_terminal.json() == {"commands": []}


def test_session_cancel_uses_durable_run_when_node_monitor_is_stale(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _login_admin(client)
        response = client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_alice",
            "employeeId": "alice",
            "token": "node_token",
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})
        assert response.status_code == 200

        run = client.post("/sandboxes/sbx_alice/runs", json={
            "taskGoal": "stop while the monitor snapshot is stale",
            "assignments": [{"agent": "codex", "mode": "action"}],
        }, headers={"Authorization": "Bearer ui_token"})
        assert run.status_code == 202
        session_id = run.json()["id"]
        [start] = client.get(
            "/daemon-nodes/sbx_alice/commands?leaseMode=explicit&leaseSeconds=10",
            headers={"Authorization": "Bearer node_token"},
        ).json()["commands"]

        monitored = app.state.registry.monitor_nodes
        monkeypatch.setattr(
            app.state.registry,
            "monitor_nodes",
            lambda: [{**node, "activeRuns": []} for node in monitored()],
        )

        cancel = client.post(
            f"/sessions/{session_id}/cancel",
            json={"reason": "stop clicked"},
        )

        assert cancel.status_code == 200
        [command] = client.get(
            "/daemon-nodes/sbx_alice/commands"
            f"?leaseMode=explicit&leaseSeconds=10&activeCommandLease={start['id']}:{start['leaseId']}",
            headers={"Authorization": "Bearer node_token"},
        ).json()["commands"]
        assert command["type"] == "run.cancel"
        assert command["sessionId"] == session_id


def test_cancel_returns_terminal_session_when_run_finishes_before_request(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _login_admin(client)
        response = client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_alice",
            "employeeId": "alice",
            "token": "node_token",
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})
        assert response.status_code == 200

        run = client.post("/sandboxes/sbx_alice/runs", json={
            "taskGoal": "finish before stop click",
            "assignments": [{"agent": "codex", "mode": "action"}],
        }, headers={"Authorization": "Bearer ui_token"})
        assert run.status_code == 202
        session_id = run.json()["id"]
        [command] = client.get(
            "/daemon-nodes/sbx_alice/commands?leaseMode=explicit&leaseSeconds=10",
            headers={"Authorization": "Bearer node_token"},
        ).json()["commands"]
        completed = client.post("/daemon-nodes/sbx_alice/events", json={
            "type": "run.completed",
            "commandId": command["id"],
            "leaseId": command["leaseId"],
            "sessionId": session_id,
            "runId": command["runId"],
            "agent": command["agent"],
            "mode": command["mode"],
            "exitCode": 0,
            "agentLog": "done",
        }, headers={"Authorization": "Bearer node_token"})
        assert completed.status_code == 202

        cancel = client.post(
            f"/sandboxes/sbx_alice/runs/{session_id}/cancel",
            json={"reason": "stop clicked"},
            headers={"Authorization": "Bearer ui_token"},
        )

        assert cancel.status_code == 202
        assert cancel.json()["status"] == "completed"


def test_daemon_registration_stores_agent_health_and_rejects_unready_runs(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _login_admin(client)

        response = client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_alice",
            "employeeId": "alice",
            "token": "node_token",
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "agentHealth": {
                "codex": {"status": "ready", "detail": "Codex preflight passed.", "adapter": "cli"},
                "kimi": {"status": "failed", "detail": "Kimi is not logged in.", "adapter": "cli"},
            },
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})

        assert response.status_code == 200
        body = response.json()
        assert body["agents"]["codex"] == "ready"
        assert body["agents"]["kimi"] == "failed"
        assert body["agentDetails"]["kimi"]["detail"] == "Kimi is not logged in."

        public = client.get("/daemon-nodes", headers={"Authorization": "Bearer ui_token"})
        assert public.status_code == 200
        public_node = public.json()["nodes"][0]
        assert public_node["agentDetails"]["kimi"]["adapter"] == "cli"
        assert "nodeToken" not in public_node

        admin = client.get("/cp/daemon-nodes")
        assert admin.status_code == 200
        assert admin.json()["nodes"][0]["nodeToken"] == "node_token"

        run = client.post("/sandboxes/sbx_alice/runs", json={
            "taskGoal": "try kimi",
            "assignments": [{"agent": "kimi", "mode": "action"}],
        }, headers={"Authorization": "Bearer ui_token"})
        assert run.status_code == 409
        assert "does not have ready agent" in run.json()["detail"]


def test_admin_creates_employee_login_and_assigns_unassigned_node(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _login_admin(client)

        response = client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_unassigned",
            "token": "node_token",
            "workspacePath": "/workspace/unassigned",
            "protocolVersion": 1,
            "supportedAgents": ["claude", "codex"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})
        assert response.status_code == 200
        assert "employeeId" not in response.json()

        response = client.get("/cp/daemon-nodes")
        assert response.status_code == 200
        assert "employeeId" not in response.json()["nodes"][0]

        response = client.post("/cp/employees", json={
            "employeeId": "alice",
            "username": "alice",
            "password": "userpass",
            "email": "alice@example.com",
            "displayName": "Alice",
            "nodeId": "sbx_unassigned",
        })
        assert response.status_code == 201
        body = response.json()
        assert body["user"]["username"] == "alice"
        assert body["user"]["role"] == "user"
        assert body["user"]["employeeId"] == "alice"
        assert body["employee"]["id"] == "alice"
        assert body["employee"]["displayName"] == "Alice"
        assert body["node"]["id"] == "sbx_unassigned"
        assert body["node"]["employeeId"] == "alice"

        poll = client.get("/daemon-nodes/sbx_unassigned/commands", headers={"Authorization": "Bearer node_token"})
        assert poll.status_code == 200
        assert poll.json() == {"commands": []}

        alice_client = TestClient(app)
        login = alice_client.post("/auth/login", json={"username": "alice", "password": "userpass"})
        assert login.status_code == 200
        assert login.json()["user"]["employeeId"] == "alice"


def test_admin_assigns_unassigned_node_to_existing_employee(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _login_admin(client)

        created = client.post("/cp/users", json={
            "username": "alice",
            "password": "userpass",
            "role": "user",
            "employeeId": "alice",
        })
        assert created.status_code == 201

        registered = client.post("/daemon-nodes/register", json={
            "sandboxId": "node_unassigned",
            "token": "node_token",
            "workspacePath": "/workspace/unassigned",
            "protocolVersion": 1,
            "supportedAgents": ["claude", "codex"],
            "status": "ready",
        })
        assert registered.status_code == 200
        assert "employeeId" not in registered.json()

        assigned = client.post("/cp/daemon-nodes/node_unassigned/assign", json={"employeeId": "alice"})
        assert assigned.status_code == 200
        body = assigned.json()
        assert body["employee"]["id"] == "alice"
        assert body["node"]["id"] == "node_unassigned"
        assert body["node"]["employeeId"] == "alice"
        assert body["node"]["nodeLocation"] == "employee-device"

        listing = client.get("/cp/daemon-nodes")
        assert listing.status_code == 200
        listed = next(
            node
            for node in listing.json()["nodes"]
            if node["id"] == "node_unassigned"
        )
        assert listed["nodeLocation"] == "employee-device"

        restarted = TestClient(create_app(root))
        _login_admin(restarted)
        restarted_listing = restarted.get("/cp/daemon-nodes")
        assert restarted_listing.status_code == 200
        restarted_node = next(
            node
            for node in restarted_listing.json()["nodes"]
            if node["id"] == "node_unassigned"
        )
        assert restarted_node["nodeLocation"] == "employee-device"

        second = client.post("/cp/daemon-nodes/node_unassigned/assign", json={"employeeId": "alice"})
        assert second.status_code == 409


def test_create_employee_rejects_invalid_node_assignment(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login_admin(client)

        # Node assignment is optional: onboarding without a nodeId creates only
        # the employee/user record. Nodes are managed separately.
        without_node = client.post("/cp/employees", json={
            "employeeId": "nodeless",
            "username": "nodeless",
            "password": "userpass",
        })
        assert without_node.status_code == 201
        without_node_body = without_node.json()
        assert without_node_body["employee"]["id"] == "nodeless"
        assert "node" not in without_node_body

        missing_node = client.post("/cp/employees", json={
            "employeeId": "alice",
            "username": "alice",
            "password": "userpass",
            "nodeId": "sbx_missing",
        })
        assert missing_node.status_code == 404

        client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_unassigned",
            "token": "node_token",
            "protocolVersion": 1,
            "supportedAgents": ["claude"],
            "status": "ready",
        })
        first = client.post("/cp/employees", json={
            "employeeId": "alice",
            "username": "alice",
            "password": "userpass",
            "nodeId": "sbx_unassigned",
        })
        assert first.status_code == 201

        client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_second",
            "token": "node_token_2",
            "protocolVersion": 1,
            "supportedAgents": ["claude"],
            "status": "ready",
        })
        duplicate_user = client.post("/cp/employees", json={
            "employeeId": "bob",
            "username": "alice",
            "password": "userpass",
            "nodeId": "sbx_second",
        })
        assert duplicate_user.status_code == 409

        already_assigned = client.post("/cp/employees", json={
            "employeeId": "carol",
            "username": "carol",
            "password": "userpass",
            "nodeId": "sbx_unassigned",
        })
        assert already_assigned.status_code == 409


def test_control_panel_requires_admin_session(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))

        response = client.get("/cp/daemon-nodes")
        assert response.status_code == 401
        assert response.json()["detail"] == "Authentication required."

        _bootstrap_admin(client)
        # Bootstrap also signs the admin in, so the admin console is now accessible.
        response = client.get("/cp/daemon-nodes")
        assert response.status_code == 200

        # After logout the admin console requires authentication again.
        response = client.post("/auth/logout")
        assert response.status_code == 200

        response = client.get("/cp/daemon-nodes")
        assert response.status_code == 401

        _login_admin(client)
        response = client.get("/cp/daemon-nodes")
        assert response.status_code == 200


def test_control_panel_accepts_admin_bearer_token_for_supervisor(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        response = client.get("/cp/employees", headers={"Authorization": "Bearer admin_token"})
        assert response.status_code == 200

        created = client.post("/cp/users", json={
            "username": "alice",
            "password": "userpass",
            "role": "user",
            "employeeId": "alice",
        }, headers={"Authorization": "Bearer admin_token"})
        assert created.status_code == 201
        body = created.json()
        assert body["user"]["employeeId"] == "alice"
        assert "node" not in body


def test_control_panel_creates_pending_daemon_node_and_reuses_duplicate(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login_admin(client)

        response = client.post("/cp/daemon-nodes", json={
            "employeeId": "alice",
            "workspacePath": "/workspace/alice",
        })

        assert response.status_code == 201
        body = response.json()
        node = body["node"]
        assert node["employeeId"] == "alice"
        assert node["workspacePath"] == "/workspace/alice"
        assert node["sandboxMode"] == "boxlite"
        assert node["status"] == "provisioning"
        assert body["sandboxToken"].startswith("tok_")
        assert body["nodeToken"].startswith("tok_")
        assert body["nodeToken"] not in body["daemonCommand"]
        # Managed (boxlite) is the default sandbox mode for generated commands.
        assert "--sandbox boxlite" in body["daemonCommand"]
        assert "--use-local-agent-home" not in body["daemonCommand"]
        assert "--workspace /workspace/alice" in body["daemonCommand"]
        assert body["daemonEnv"]["RELAY_SANDBOX_ID"] == node["id"]
        assert body["daemonEnv"]["RELAY_EMPLOYEE_ID"] == "alice"
        assert body["daemonEnv"]["RELAY_DAEMON_NODE_TOKEN"] == body["nodeToken"]
        assert body["daemonEnv"]["RELAY_SANDBOX_MODE"] == "boxlite"
        assert body["daemonEnv"]["RELAY_WORKSPACE"] == "/workspace/alice"
        assert "RELAY_USE_LOCAL_AGENT_HOME" not in body["daemonEnv"]

        listing = client.get("/cp/daemon-nodes")
        assert listing.status_code == 200
        listed = next(item for item in listing.json()["nodes"] if item["id"] == node["id"])
        assert listed["sandboxMode"] == "boxlite"
        assert listed["displayName"] == node["id"]

        sandboxes = client.get("/sandboxes", headers={"Authorization": f"Bearer {body['sandboxToken']}"})
        assert sandboxes.status_code == 200
        assert sandboxes.json()["sandboxes"][0]["id"] == node["id"]

        wrong_poll = client.get(f"/daemon-nodes/{node['id']}/commands", headers={"Authorization": "Bearer wrong"})
        assert wrong_poll.status_code == 401

        register = client.post("/daemon-nodes/register", json={
            "sandboxId": node["id"],
            "token": body["nodeToken"],
            "workspacePath": "/workspace/alice",
            "sandboxMode": "boxlite",
            "protocolVersion": 1,
            "supportedAgents": ["claude", "codex"],
            "status": "ready",
        })
        assert register.status_code == 200
        assert register.json()["employeeId"] == "alice"
        assert register.json()["sandboxMode"] == "boxlite"
        assert register.json()["agents"]["codex"] == "ready"

        mismatched_register = client.post("/daemon-nodes/register", json={
            "sandboxId": node["id"],
            "employeeId": "Alice",
            "token": body["nodeToken"],
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["claude", "codex"],
            "status": "ready",
        })
        assert mismatched_register.status_code == 200
        assert mismatched_register.json()["employeeId"] == "alice"

        poll = client.get(f"/daemon-nodes/{node['id']}/commands", headers={"Authorization": f"Bearer {body['nodeToken']}"})
        assert poll.status_code == 200
        assert poll.json() == {"commands": []}

        duplicate = client.post("/cp/daemon-nodes", json={
            "employeeId": "alice",
            "workspacePath": "/workspace/alice",
        })
        assert duplicate.status_code == 201
        duplicate_body = duplicate.json()
        assert duplicate_body["node"]["id"] == node["id"]
        assert duplicate_body["node"]["sandboxMode"] == "boxlite"
        assert "sandboxToken" not in duplicate_body
        assert duplicate_body["nodeToken"] == body["nodeToken"]
        assert "daemonCommand" in duplicate_body

        unassign = client.post(f"/cp/daemon-nodes/{node['id']}/unassign")
        assert unassign.status_code == 200
        assert "employeeId" not in unassign.json()["node"]

        delete = client.delete(f"/cp/daemon-nodes/{node['id']}")
        assert delete.status_code == 204

        listing = client.get("/cp/daemon-nodes")
        assert listing.status_code == 200
        assert all(item["id"] != node["id"] for item in listing.json()["nodes"])


def test_control_panel_creates_local_mode_daemon_node(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login_admin(client)

        response = client.post("/cp/daemon-nodes", json={
            "employeeId": "alice",
            "displayName": "Alice's MacBook",
            "workspacePath": "/workspace/alice",
            "sandboxMode": "none",
            "nodeLocation": "employee-device",
        })

        assert response.status_code == 201
        body = response.json()
        assert body["node"]["sandboxMode"] == "none"
        assert body["node"]["nodeLocation"] == "employee-device"
        assert body["node"]["displayName"] == "Alice's MacBook"
        assert "--sandbox none" in body["daemonCommand"]
        assert "--use-local-agent-home" in body["daemonCommand"]
        assert body["nodeToken"] not in body["daemonCommand"]
        assert body["daemonEnv"]["RELAY_SANDBOX_MODE"] == "none"
        assert body["daemonEnv"]["RELAY_USE_LOCAL_AGENT_HOME"] == "1"

        listing = client.get("/cp/daemon-nodes")
        assert listing.status_code == 200
        listed = next(item for item in listing.json()["nodes"] if item["id"] == body["node"]["id"])
        assert listed["sandboxMode"] == "none"

        duplicate = client.post("/cp/daemon-nodes", json={
            "employeeId": "alice",
            "workspacePath": "/workspace/alice",
            "sandboxMode": "boxlite",
        })
        assert duplicate.status_code == 201
        duplicate_body = duplicate.json()
        assert duplicate_body["node"]["id"] == body["node"]["id"]
        assert duplicate_body["node"]["sandboxMode"] == "none"
        assert "--sandbox none" in duplicate_body["daemonCommand"]
        assert "--use-local-agent-home" in duplicate_body["daemonCommand"]
        assert duplicate_body["daemonEnv"]["RELAY_SANDBOX_MODE"] == "none"


def test_control_panel_rejects_unknown_sandbox_mode(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login_admin(client)

        response = client.post("/cp/daemon-nodes", json={
            "employeeId": "alice",
            "sandboxMode": "firecracker",
        })

        assert response.status_code == 400


def test_employee_device_node_requires_an_absolute_workspace(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login_admin(client)

        response = client.post(
            "/cp/daemon-nodes",
            json={
                "employeeId": "alice",
                "workspacePath": "relative/project",
                "sandboxMode": "boxlite",
                "nodeLocation": "employee-device",
            },
        )

        assert response.status_code == 400
        assert "absolute workspacePath" in response.json()["detail"]


def test_employee_can_create_own_device_enrollment(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login_admin(client)
        assert client.post(
            "/cp/employees",
            json={"employeeId": "alice", "username": "alice", "password": "userpass"},
        ).status_code == 201
        assert client.post("/auth/logout").status_code == 200
        assert client.post(
            "/auth/login", json={"username": "alice", "password": "userpass"}
        ).status_code == 200

        response = client.post(
            "/daemon-nodes/local-enrollment",
            json={
                "displayName": "Travel Laptop",
                "workspacePath": "/Users/alice/project",
                "sandboxMode": "boxlite",
            },
        )

        assert response.status_code == 201
        body = response.json()
        assert body["node"]["employeeId"] == "alice"
        assert body["node"]["nodeLocation"] == "employee-device"
        assert body["node"]["displayName"] == "Travel Laptop"
        assert body["node"]["workspacePath"] == "/Users/alice/project"
        assert body["nodeToken"] not in body["daemonCommand"]


def test_control_panel_creates_unassigned_pending_daemon_node(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login_admin(client)

        response = client.post("/cp/daemon-nodes", json={
            "workspacePath": "/workspace/shared",
        })

        assert response.status_code == 201
        body = response.json()
        node = body["node"]
        assert node["id"].startswith("sbx_node_")
        assert "employeeId" not in node
        assert node["workspacePath"] == "/workspace/shared"
        assert node["status"] == "provisioning"
        assert "nodeLocation" not in node
        assert body["sandboxToken"].startswith("tok_")
        assert body["nodeToken"].startswith("tok_")
        assert "--employee-id" not in body["daemonCommand"]
        assert "RELAY_EMPLOYEE_ID" not in body["daemonEnv"]

        register = client.post("/daemon-nodes/register", json={
            "sandboxId": node["id"],
            "token": body["nodeToken"],
            "workspacePath": "/workspace/shared",
            "protocolVersion": 1,
            "supportedAgents": ["claude"],
            "status": "ready",
        })
        assert register.status_code == 200
        assert "employeeId" not in register.json()

        register_with_employee = client.post("/daemon-nodes/register", json={
            "sandboxId": node["id"],
            "employeeId": "clark",
            "token": body["nodeToken"],
            "workspacePath": "/workspace/shared",
            "protocolVersion": 1,
            "supportedAgents": ["claude"],
            "status": "ready",
        })
        assert register_with_employee.status_code == 200
        assert "employeeId" not in register_with_employee.json()


def test_sandbox_ui_token_can_manage_owned_sessions(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        admin_client = TestClient(app)
        _bootstrap_admin(admin_client)
        _login_admin(admin_client)

        register = admin_client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_alice",
            "employeeId": "alice",
            "token": "node_token",
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["claude", "codex"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})
        assert register.status_code == 200

        token_client = TestClient(app)
        headers = {"Authorization": "Bearer ui_token"}
        created = token_client.post("/sessions", json={
            "taskGoal": "ship daemon task",
            "assignments": [{"agent": "claude"}],
            "workspacePath": "/workspace/alice",
        }, headers=headers)
        assert created.status_code == 201
        session = created.json()
        session_id = session["id"]
        assert session["ownerEmployeeId"] == "alice"

        listed = token_client.get("/sessions", headers=headers)
        assert listed.status_code == 200
        assert [item["id"] for item in listed.json()["sessions"]] == [session_id]

        opened = token_client.get(f"/sessions/{session_id}", headers=headers)
        assert opened.status_code == 200
        assert opened.json()["id"] == session_id

        approved = token_client.post(f"/sessions/{session_id}/decisions", json={
            "kind": "approve",
        }, headers=headers)
        assert approved.status_code == 200
        assert approved.json()["status"] == "running"

        handed_off = token_client.post(f"/sessions/{session_id}/handoffs", json={
            "targetAgent": "codex",
            "mode": "review",
            "note": "check it",
        }, headers=headers)
        assert handed_off.status_code == 200
        assert handed_off.json()["status"] == "running"
        assert "pendingDecision" not in handed_off.json()
        assert any(decision["kind"] == "handoff" and decision["targetAgent"] == "codex" for decision in handed_off.json()["decisions"])

        bob_session = admin_client.post("/sessions", json={
            "taskGoal": "bob task",
            "ownerEmployeeId": "bob",
        })
        assert bob_session.status_code == 201
        assert token_client.get(f"/sessions/{bob_session.json()['id']}", headers=headers).status_code == 403
        node_token_headers = {"Authorization": "Bearer node_token"}
        node_token_session = token_client.post("/sessions", json={
            "taskGoal": "node token task",
            "assignments": [{"agent": "codex"}],
            "workspacePath": "/workspace/alice",
        }, headers=node_token_headers)
        assert node_token_session.status_code == 201
        assert node_token_session.json()["ownerEmployeeId"] == "alice"
        assert token_client.get(f"/sessions/{node_token_session.json()['id']}", headers=node_token_headers).status_code == 200

        bad_token = token_client.get("/sessions", headers={"Authorization": "Bearer wrong"})
        assert bad_token.status_code == 401
        assert bad_token.json()["detail"] == "Invalid sandbox token."


def test_employee_can_ask_assigned_daemon_node_without_daemon_node_token(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        admin_client = TestClient(app)
        _bootstrap_admin(admin_client)
        _login_admin(admin_client)
        _create_user(admin_client, "alice", employee_id="alice")
        _create_user(admin_client, "bob", employee_id="bob")

        pending = admin_client.post("/cp/daemon-nodes", json={
            "employeeId": "alice",
            "workspacePath": "/workspace/stale",
        })
        assert pending.status_code == 201
        pending_id = pending.json()["node"]["id"]

        register = admin_client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_alice",
            "employeeId": "alice",
            "token": "node_token",
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})
        assert register.status_code == 200

        alice_client = TestClient(app)
        _login(alice_client, "alice", "userpass")
        listed = alice_client.get("/sandboxes")
        assert listed.status_code == 200
        assert listed.json()["sandboxes"][0]["id"] == "sbx_alice"
        assert any(sandbox["id"] == pending_id for sandbox in listed.json()["sandboxes"])

        bob_client = TestClient(app)
        _login(bob_client, "bob", "userpass")

        provision = alice_client.post("/sandboxes", json={"employeeId": "alice"})
        assert provision.status_code == 201
        assert provision.json()["id"] == "sbx_alice"
        assert "nodeToken" not in provision.json()

        bob_provision = bob_client.post("/sandboxes", json={"employeeId": "alice"})
        assert bob_provision.status_code == 403

        run = alice_client.post("/sandboxes/sbx_alice/runs", json={
            "taskGoal": "answer this",
            "assignments": [{"agent": "codex", "mode": "action"}],
        })
        assert run.status_code == 202
        session_id = run.json()["id"]
        assert run.json()["ownerEmployeeId"] == "alice"
        assert run.json()["status"] == "running"

        cancel = alice_client.post(f"/sandboxes/sbx_alice/runs/{session_id}/cancel", json={
            "reason": "test cleanup",
        })
        assert cancel.status_code == 202
        ready_again = admin_client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_alice",
            "employeeId": "alice",
            "token": "node_token",
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})
        assert ready_again.status_code == 200

        bob_session = bob_client.post("/sessions", json={
            "taskGoal": "bob asks alice node",
            "assignments": [{"agent": "codex", "mode": "action"}],
            "workspacePath": "/workspace/alice",
        })
        assert bob_session.status_code == 201
        bob_run = bob_client.post("/sandboxes/sbx_alice/runs", json={
            "taskGoal": "bob asks alice node",
            "assignments": [{"agent": "codex", "mode": "action"}],
            "sessionId": bob_session.json()["id"],
        })
        assert bob_run.status_code == 403

        alice_cancel_bob = alice_client.post(f"/sandboxes/sbx_alice/runs/{bob_session.json()['id']}/cancel", json={
            "reason": "not alice's session",
        })
        assert alice_cancel_bob.status_code == 400


def test_employee_can_name_owned_computer_and_name_survives_heartbeat(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        admin_client = TestClient(app)
        _bootstrap_admin(admin_client)
        _login_admin(admin_client)
        _create_user(admin_client, "alice", employee_id="alice")

        registered = admin_client.post(
            "/daemon-nodes/register",
            json={
                "sandboxId": "sbx_alice",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "workspaceId": "mch_alice",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            },
            headers={"Authorization": "Bearer ui_token"},
        )
        assert registered.status_code == 200

        alice_client = TestClient(app)
        _login(alice_client, "alice", "userpass")
        renamed = alice_client.patch(
            "/daemon-nodes/sbx_alice",
            json={"displayName": "  Office Mac Studio  "},
        )

        assert renamed.status_code == 200
        renamed_node = renamed.json()["node"]
        assert renamed_node["displayName"] == "Office Mac Studio"
        assert renamed_node["online"] is True
        assert renamed_node["activeRuns"] == []
        assert renamed_node["queuedCommandCount"] == 0
        for secret_field in (
            "token",
            "tokenHash",
            "uiTokenHash",
            "nodeToken",
            "nodeTokenHash",
        ):
            assert secret_field not in renamed_node
        assert alice_client.get("/daemon-nodes").json()["nodes"][0]["displayName"] == "Office Mac Studio"
        assert "displayName" not in TestClient(app).get("/daemon-nodes").json()["nodes"][0]
        assert "displayName" not in TestClient(app).get("/sandboxes").json()["sandboxes"][0]

        heartbeat = admin_client.post(
            "/daemon-nodes/register",
            json={
                "sandboxId": "sbx_alice",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "workspaceId": "mch_alice",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            },
            headers={"Authorization": "Bearer ui_token"},
        )
        assert heartbeat.status_code == 200
        assert heartbeat.json()["displayName"] == "Office Mac Studio"

        replacement = admin_client.post(
            "/daemon-nodes/register",
            json={
                "sandboxId": "sbx_alice_replacement",
                "employeeId": "alice",
                "token": "replacement_node_token",
                "workspacePath": "/workspace/another-project",
                "workspaceId": "mch_alice",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            },
            headers={"Authorization": "Bearer replacement_ui_token"},
        )
        assert replacement.status_code == 200
        assert replacement.json()["displayName"] == "Office Mac Studio"

        restarted = TestClient(create_app(root))
        _login(restarted, "alice", "userpass")
        assert restarted.get("/daemon-nodes").json()["nodes"][0]["displayName"] == "Office Mac Studio"


def test_computer_naming_enforces_ownership_and_validates_names(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        admin_client = TestClient(app)
        _bootstrap_admin(admin_client)
        _login_admin(admin_client)
        _create_user(admin_client, "alice", employee_id="alice")
        _create_user(admin_client, "bob", employee_id="bob")
        for employee_id in ("alice", "bob"):
            response = admin_client.post(
                "/daemon-nodes/register",
                json={
                    "sandboxId": f"sbx_{employee_id}",
                    "employeeId": employee_id,
                    "token": f"{employee_id}_node_token",
                    "protocolVersion": 1,
                    "supportedAgents": ["codex"],
                    "status": "ready",
                },
                headers={"Authorization": f"Bearer {employee_id}_ui_token"},
            )
            assert response.status_code == 200

        alice_client = TestClient(app)
        _login(alice_client, "alice", "userpass")
        assert alice_client.patch(
            "/daemon-nodes/sbx_bob", json={"displayName": "Not mine"}
        ).status_code == 403
        assert {
            node["id"] for node in alice_client.get("/sandboxes").json()["sandboxes"]
        } == {"sbx_alice"}
        assert alice_client.patch(
            "/daemon-nodes/sbx_alice", json={"displayName": "   "}
        ).status_code == 400
        assert alice_client.patch(
            "/daemon-nodes/sbx_alice", json={"displayName": "Line\nbreak"}
        ).status_code == 400
        assert alice_client.patch(
            "/daemon-nodes/sbx_alice", json={"displayName": "x" * 65}
        ).status_code == 400
        assert alice_client.patch(
            "/daemon-nodes/sbx_alice",
            json={"displayName": "Laptop", "employeeId": "bob"},
        ).status_code == 400

        daemon_client = TestClient(app)
        assert daemon_client.patch(
            "/daemon-nodes/sbx_alice",
            json={"displayName": "Daemon controlled"},
            headers={"Authorization": "Bearer alice_node_token"},
        ).status_code == 401

        renamed_by_admin = admin_client.patch(
            "/daemon-nodes/sbx_bob", json={"displayName": "Bob's laptop"}
        )
        assert renamed_by_admin.status_code == 200
        assert renamed_by_admin.json()["node"]["displayName"] == "Bob's laptop"

        assert alice_client.patch(
            "/daemon-nodes/sbx_alice", json={"displayName": "Alice's laptop"}
        ).status_code == 200
        reset = alice_client.patch(
            "/daemon-nodes/sbx_alice", json={"displayName": None}
        )
        assert reset.status_code == 200
        assert reset.json()["node"]["displayName"] == "sbx_alice"
        heartbeat_after_reset = admin_client.post(
            "/daemon-nodes/register",
            json={
                "sandboxId": "sbx_alice",
                "employeeId": "alice",
                "token": "alice_node_token",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            },
            headers={"Authorization": "Bearer alice_ui_token"},
        )
        assert heartbeat_after_reset.status_code == 200
        assert "displayName" not in heartbeat_after_reset.json()


def test_employee_renames_managed_computer_through_runtime_identity(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        admin_client = TestClient(app)
        _bootstrap_admin(admin_client)
        _login_admin(admin_client)
        _create_user(admin_client, "alice", employee_id="alice")
        managed = admin_client.post(
            "/cp/managed-nodes",
            json={"employeeId": "alice", "sandboxMode": "boxlite"},
        ).json()["node"]
        assert admin_client.patch(
            f"/cp/managed-nodes/{managed['id']}",
            json={"displayName": "   "},
        ).status_code == 400
        attempt = admin_client.post(
            f"/cp/managed-nodes/{managed['id']}/attempts"
        ).json()
        enrolled = admin_client.post(
            "/daemon-enroll",
            json={"workspacePath": "/workspace/alice"},
            headers={
                "Authorization": f"Enrollment {attempt['enrollmentCredential']}"
            },
        ).json()
        registered = admin_client.post(
            "/daemon-nodes/register",
            json={
                "sandboxId": enrolled["sandboxId"],
                "token": enrolled["token"],
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["codex"],
                "status": "ready",
            },
        )
        assert registered.status_code == 200

        alice_client = TestClient(app)
        _login(alice_client, "alice", "userpass")
        renamed = alice_client.patch(
            f"/daemon-nodes/{enrolled['sandboxId']}",
            json={"displayName": "Relay Cloud"},
        )

        assert renamed.status_code == 200
        assert renamed.json()["node"]["displayName"] == "Relay Cloud"
        assert app.state.managed_node_store.get_node(managed["id"])["displayName"] == "Relay Cloud"
        assert alice_client.get("/daemon-nodes").json()["nodes"][0]["displayName"] == "Relay Cloud"
        assert admin_client.get("/cp/daemon-nodes").json()["nodes"][0]["displayName"] == "Relay Cloud"

        reset = alice_client.patch(
            f"/daemon-nodes/{enrolled['sandboxId']}",
            json={"displayName": None},
        )
        assert reset.status_code == 200
        assert reset.json()["node"]["displayName"] == managed["id"]
        assert app.state.managed_node_store.get_node(managed["id"])["displayName"] == managed["id"]

        renamed_again = admin_client.patch(
            f"/cp/managed-nodes/{managed['id']}",
            json={"displayName": "Cloud workstation"},
        )
        assert renamed_again.status_code == 200
        direct_reset = admin_client.patch(
            f"/cp/managed-nodes/{managed['id']}",
            json={"displayName": None},
        )
        assert direct_reset.status_code == 200
        assert direct_reset.json()["node"]["displayName"] == managed["id"]


def test_sandbox_run_accepts_decision_metadata(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        admin_client = TestClient(app)
        _bootstrap_admin(admin_client)
        _login_admin(admin_client)
        _create_user(admin_client, "alice", employee_id="alice")

        register = admin_client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_alice",
            "employeeId": "alice",
            "token": "node_token",
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})
        assert register.status_code == 200

        alice_client = TestClient(app)
        _login(alice_client, "alice", "userpass")
        created = alice_client.post("/sessions", json={
            "taskGoal": "fix auth",
            "workspacePath": "/workspace/alice",
        })
        assert created.status_code == 201

        run = alice_client.post("/sandboxes/sbx_alice/runs", json={
            "taskGoal": "fix auth",
            "assignments": [{"agent": "codex", "mode": "action"}],
            "sessionId": created.json()["id"],
            "decision": {"kind": "rerun", "targetAgent": "codex"},
        })

        assert run.status_code == 202
        assert run.json()["decisions"][0]["kind"] == "rerun"
        assert run.json()["decisions"][0]["targetAgent"] == "codex"


def test_sandbox_run_accepts_fresh_new_conversation_payload(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        admin_client = TestClient(app)
        _bootstrap_admin(admin_client)
        _login_admin(admin_client)
        _create_user(admin_client, "alice", employee_id="alice")

        register = admin_client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_alice",
            "employeeId": "alice",
            "token": "node_token",
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["claude"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})
        assert register.status_code == 200

        alice_client = TestClient(app)
        _login(alice_client, "alice", "userpass")
        run = alice_client.post("/sandboxes/sbx_alice/runs", json={
            "taskGoal": "start a fresh thread",
            "assignments": [{"agent": "claude", "mode": "action"}],
        })

        assert run.status_code == 202
        assert run.json()["taskGoal"] == "start a fresh thread"
        assert run.json()["ownerEmployeeId"] == "alice"


def test_admin_can_start_existing_employee_session_on_employee_daemon_node(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        admin_client = TestClient(app)
        _bootstrap_admin(admin_client)
        _login_admin(admin_client)
        _create_user(admin_client, "alice", employee_id="alice")
        _create_user(admin_client, "bob", employee_id="bob")

        register = admin_client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_alice",
            "employeeId": "alice",
            "token": "node_token",
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})
        assert register.status_code == 200
        register_bob = admin_client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_bob",
            "employeeId": "bob",
            "token": "bob_node_token",
            "workspacePath": "/workspace/bob",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "status": "ready",
        }, headers={"Authorization": "Bearer bob_ui_token"})
        assert register_bob.status_code == 200

        created = admin_client.post("/sessions", json={
            "taskGoal": "alice asks through admin",
            "ownerEmployeeId": "alice",
            "assignments": [{"agent": "codex", "mode": "action"}],
            "workspacePath": "/workspace/alice",
        })
        assert created.status_code == 201
        session_id = created.json()["id"]
        assert created.json()["ownerEmployeeId"] == "alice"

        bob_client = TestClient(app)
        _login(bob_client, "bob", "userpass")
        denied = bob_client.post("/sandboxes/sbx_alice/runs", json={
            "taskGoal": "alice asks through admin",
            "assignments": [{"agent": "codex", "mode": "action"}],
            "sessionId": session_id,
        })
        assert denied.status_code == 403

        run = admin_client.post("/sandboxes/sbx_bob/runs", json={
            "taskGoal": "alice asks through admin",
            "assignments": [{"agent": "codex", "mode": "action"}],
            "sessionId": session_id,
        })
        assert run.status_code == 202
        assert run.json()["id"] == session_id
        assert run.json()["ownerEmployeeId"] == "alice"
        assert run.json()["status"] == "running"


def test_admin_can_soft_delete_employee_and_unassign_nodes(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _login_admin(client)

        register_user = client.post("/cp/users", json={
            "username": "alice",
            "password": "AlicePass123!",
            "employeeId": "alice",
            "displayName": "Alice",
        })
        assert register_user.status_code == 201
        provision = client.post("/cp/daemon-nodes", json={
            "employeeId": "alice",
            "workspacePath": "/workspace/alice",
        })
        assert provision.status_code == 201
        node_id = provision.json()["node"]["id"]
        agent = client.post(
            "/cp/employees/alice/agents",
            json={"displayName": "Builder", "executorKind": "codex"},
        ).json()["agent"]
        placement = client.post(
            f"/cp/agents/{agent['id']}/placements",
            json={"daemonNodeId": node_id},
        ).json()["placement"]
        team = client.post(
            "/cp/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": agent["id"],
                "memberAgentIds": [agent["id"]],
            },
        ).json()["team"]
        managed_node = client.post(
            "/cp/managed-nodes",
            json={
                "employeeId": "alice",
                "assignmentMode": "dedicated",
                "sandboxMode": "boxlite",
            },
        ).json()["node"]
        employee_client = TestClient(app)
        assert employee_client.post(
            "/auth/login", json={"username": "alice", "password": "AlicePass123!"}
        ).status_code == 200

        listing = client.get("/cp/employees")
        assert listing.status_code == 200
        assert any(item["id"] == "alice" for item in listing.json()["employees"])

        delete = client.delete("/cp/employees/alice")
        assert delete.status_code == 200
        body = delete.json()
        assert body["employee"]["id"] == "alice"
        assert node_id in body["unassignedNodes"]
        assert body["deletedAgents"] == [agent["id"]]
        assert body["removedPlacements"] == [placement["id"]]
        assert body["deletedManagedNodes"] == [managed_node["id"]]
        assert app.state.employee_agent_store.get_agent(agent["id"])["enabled"] is False
        cleaned_team = app.state.team_store.get_team(team["id"])
        assert cleaned_team["memberAgentIds"] == []
        assert cleaned_team["leadAgentId"] is None
        assert app.state.agent_placement_store.get_placement(placement["id"])["desiredState"] == "removed"
        assert app.state.managed_node_store.get_node(managed_node["id"])["desiredState"] == "deleted"
        assert employee_client.get("/auth/me").status_code == 401
        assert employee_client.post(
            "/auth/login", json={"username": "alice", "password": "AlicePass123!"}
        ).status_code == 401
        assert client.post(
            "/cp/employees/alice/agents",
            json={"displayName": "Orphan", "executorKind": "codex"},
        ).status_code == 404

        post_delete_employees = client.get("/cp/employees")
        assert post_delete_employees.status_code == 200
        assert all(item["id"] != "alice" for item in post_delete_employees.json()["employees"])

        nodes = client.get("/cp/daemon-nodes")
        assert nodes.status_code == 200
        match = next(item for item in nodes.json()["nodes"] if item["id"] == node_id)
        assert "employeeId" not in match

        duplicate = client.delete("/cp/employees/alice")
        assert duplicate.status_code == 409


def test_admin_updates_disabled_agents_for_daemon_node(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login_admin(client)

        provision = client.post("/cp/daemon-nodes", json={
            "employeeId": "alice",
            "workspacePath": "/workspace/alice",
        })
        assert provision.status_code == 201
        body = provision.json()
        node_id = body["node"]["id"]

        register = client.post("/daemon-nodes/register", json={
            "sandboxId": node_id,
            "token": body["nodeToken"],
            "workspacePath": "/workspace/alice",
            "protocolVersion": 1,
            "supportedAgents": ["claude", "codex", "pi"],
            "status": "ready",
        })
        assert register.status_code == 200

        disable = client.patch(
            f"/cp/daemon-nodes/{node_id}/disabled-agents",
            json={"disabledAgents": ["codex", "pi"]},
        )
        assert disable.status_code == 200
        assert disable.json()["node"]["disabledAgents"] == ["codex", "pi"]

        defaults = client.patch(
            f"/cp/daemon-nodes/{node_id}/agent-role-defaults",
            json={"agentRoleDefaults": {"codex": "planner", "pi": "tester"}},
        )
        assert defaults.status_code == 200
        assert defaults.json()["node"]["agentRoleDefaults"] == {"codex": "planner", "pi": "tester"}

        listing = client.get("/cp/daemon-nodes")
        assert listing.status_code == 200
        match = next(item for item in listing.json()["nodes"] if item["id"] == node_id)
        assert match["disabledAgents"] == ["codex", "pi"]
        assert match["agentRoleDefaults"] == {"codex": "planner", "pi": "tester"}

        invalid_name = client.patch(
            f"/cp/daemon-nodes/{node_id}/disabled-agents",
            json={"disabledAgents": ["bogus"]},
        )
        assert invalid_name.status_code == 400

        invalid_shape = client.patch(
            f"/cp/daemon-nodes/{node_id}/disabled-agents",
            json={"disabledAgents": "codex"},
        )
        assert invalid_shape.status_code == 400

        invalid_role = client.patch(
            f"/cp/daemon-nodes/{node_id}/agent-role-defaults",
            json={"agentRoleDefaults": {"codex": "builder"}},
        )
        assert invalid_role.status_code == 400

        missing = client.patch(
            "/cp/daemon-nodes/node_missing/disabled-agents",
            json={"disabledAgents": []},
        )
        assert missing.status_code == 404

        clear = client.patch(
            f"/cp/daemon-nodes/{node_id}/disabled-agents",
            json={"disabledAgents": []},
        )
        assert clear.status_code == 200
        assert "disabledAgents" not in clear.json()["node"]
        clear_defaults = client.patch(
            f"/cp/daemon-nodes/{node_id}/agent-role-defaults",
            json={"agentRoleDefaults": {}},
        )
        assert clear_defaults.status_code == 200
        assert "agentRoleDefaults" not in clear_defaults.json()["node"]


def test_employee_updates_agent_role_overrides_for_own_daemon_node(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        admin_client = TestClient(app)
        alice_client = TestClient(app)
        bob_client = TestClient(app)
        anon_client = TestClient(app)
        _bootstrap_admin(admin_client)
        _login_admin(admin_client)
        _create_user(admin_client, "alice", employee_id="alice")
        _create_user(admin_client, "bob", employee_id="bob")
        created_node = admin_client.post("/cp/daemon-nodes", json={"employeeId": "alice"})
        assert created_node.status_code == 201
        nodes = admin_client.get("/cp/daemon-nodes").json()["nodes"]
        alice_node = next(node for node in nodes if node.get("employeeId") == "alice")

        _login(alice_client, "alice", "userpass")
        update = alice_client.patch(
            f"/daemon-nodes/{alice_node['id']}/agent-role-overrides",
            json={"agentRoleOverrides": {"codex": "fixer", "claude": "planner"}},
        )
        assert update.status_code == 200
        assert update.json()["node"]["agentRoleOverrides"] == {"claude": "planner", "codex": "fixer"}

        _login(bob_client, "bob", "userpass")
        forbidden = bob_client.patch(
            f"/daemon-nodes/{alice_node['id']}/agent-role-overrides",
            json={"agentRoleOverrides": {"codex": "tester"}},
        )
        assert forbidden.status_code == 403

        unauthenticated = anon_client.patch(
            f"/daemon-nodes/{alice_node['id']}/agent-role-overrides",
            json={"agentRoleOverrides": {"codex": "tester"}},
        )
        assert unauthenticated.status_code == 401

        invalid = alice_client.patch(
            f"/daemon-nodes/{alice_node['id']}/agent-role-overrides",
            json={"agentRoleOverrides": {"codex": "builder"}},
        )
        assert invalid.status_code == 400


def test_run_completed_generated_files_flow_over_http(monkeypatch) -> None:
    """The full wire path: daemon reports generated files in run.completed and
    the artifact becomes listable and downloadable, with no shared filesystem."""
    import base64

    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap_admin(client)
        _login_admin(client)
        response = client.post("/daemon-nodes/register", json={
            "sandboxId": "sbx_alice",
            "employeeId": "alice",
            "token": "node_token",
            "workspacePath": "/remote/daemon/workspace",
            "protocolVersion": 1,
            "supportedAgents": ["codex"],
            "capabilities": ["generated-files"],
            "status": "ready",
        }, headers={"Authorization": "Bearer ui_token"})
        assert response.status_code == 200
        assert response.json()["capabilities"] == ["generated-files"]

        run = client.post("/sandboxes/sbx_alice/runs", json={
            "taskGoal": "generate the quarterly report",
            "assignments": [{"agent": "codex", "mode": "action"}],
        }, headers={"Authorization": "Bearer ui_token"})
        assert run.status_code == 202
        session_id = run.json()["id"]
        [command] = client.get(
            "/daemon-nodes/sbx_alice/commands",
            headers={"Authorization": "Bearer node_token"},
        ).json()["commands"]

        response = client.post("/daemon-nodes/sbx_alice/events", json={
            "type": "run.completed",
            "commandId": command["id"],
            "leaseId": command.get("leaseId"),
            "sessionId": command["sessionId"],
            "runId": command["runId"],
            "agent": "codex",
            "mode": "action",
            "exitCode": 0,
            "agentLog": "created q2.pdf",
            "generatedFiles": [
                {
                    "relativePath": "reports/q2.pdf",
                    "title": "q2.pdf",
                    "bytes": 9,
                    "contentType": "application/pdf",
                    "contentBase64": base64.b64encode(b"pdf bytes").decode("ascii"),
                },
                {"relativePath": "../escape.pdf", "title": "escape.pdf", "bytes": 3},
            ],
        }, headers={"Authorization": "Bearer node_token"})
        assert response.status_code == 202

        listed = client.get("/artifacts").json()["artifacts"]
        assert [item["workspaceRelativePath"] for item in listed] == ["reports/q2.pdf"]
        assert listed[0]["sessionId"] == session_id

        download = client.get(f"/sessions/{session_id}/artifacts/{listed[0]['id']}")
        assert download.status_code == 200
        assert download.content == b"pdf bytes"
        assert download.headers["content-type"].startswith("application/pdf")
