"""How many personal computers an employee may enroll.

Covers the global default, the per-employee override, and the two paths that
can bring a personal computer into existence.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from tempfile import TemporaryDirectory

import pytest
from fastapi.testclient import TestClient

from relay.app import create_app
from relay.security.auth import DatabaseUserAuthStore


def _bootstrap_admin(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/bootstrap",
        json={"token": "admin_token", "username": "admin", "password": "secret123"},
    )
    assert response.status_code == 200


def _login(client: TestClient, username: str, password: str = "userpass") -> None:
    response = client.post(
        "/api/v1/auth/login", json={"username": username, "password": password}
    )
    assert response.status_code == 200


def _login_admin(client: TestClient) -> None:
    _login(client, "admin", "secret123")


def _create_employee(client: TestClient, employee_id: str, **extra: object) -> dict:
    response = client.post(
        "/api/v1/admin/employees",
        json={
            "employeeId": employee_id,
            "username": employee_id,
            "password": "userpass",
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["employee"]


def _enroll(client: TestClient, workspace_path: str) -> object:
    return client.post(
        "/api/v1/daemon-node-enrollments/local",
        json={"workspacePath": workspace_path, "sandboxMode": "none"},
    )


def _set_global_limit(client: TestClient, limit: int) -> None:
    response = client.put(
        "/api/v1/admin/settings", json={"maxLocalComputersPerEmployee": limit}
    )
    assert response.status_code == 200, response.text


@contextmanager
def _client(monkeypatch: pytest.MonkeyPatch, *, database_auth: bool) -> Iterator[TestClient]:
    """A signed-out client, admin-bootstrapped.

    The per-employee override lives on the employees table, so tests that need
    one run against the database auth store; the rest exercise the file store
    that the backend defaults to.
    """
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        if database_auth:
            monkeypatch.setenv("RELAY_AUTH_STORE", "database")
            database_url = f"sqlite:///{root}/auth.db"
            monkeypatch.setenv("RELAY_DATABASE_URL", database_url)
            DatabaseUserAuthStore(database_url, create_schema=True)
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        yield client


def test_settings_default_and_update(monkeypatch: pytest.MonkeyPatch) -> None:
    with _client(monkeypatch, database_auth=False) as client:
        response = client.get("/api/v1/admin/settings")
        assert response.status_code == 200
        assert response.json()["settings"]["maxLocalComputersPerEmployee"] == 3

        _set_global_limit(client, 7)
        assert (
            client.get("/api/v1/admin/settings").json()["settings"][
                "maxLocalComputersPerEmployee"
            ]
            == 7
        )


def test_settings_report_whether_employee_edits_are_storable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with _client(monkeypatch, database_auth=False) as client:
        assert (
            client.get("/api/v1/admin/settings").json()["capabilities"]["employeeEdits"]
            is False
        )
    with _client(monkeypatch, database_auth=True) as client:
        assert (
            client.get("/api/v1/admin/settings").json()["capabilities"]["employeeEdits"]
            is True
        )


def test_settings_reject_out_of_range_and_non_numeric(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with _client(monkeypatch, database_auth=False) as client:
        for value in (-1, 51, "many", None):
            response = client.put(
                "/api/v1/admin/settings", json={"maxLocalComputersPerEmployee": value}
            )
            assert response.status_code == 400, value


def test_settings_require_admin_session(monkeypatch: pytest.MonkeyPatch) -> None:
    with _client(monkeypatch, database_auth=False) as client:
        _create_employee(client, "alice")
        assert client.post("/api/v1/auth/logout").status_code == 200
        assert client.get("/api/v1/admin/settings").status_code == 401

        _login(client, "alice")
        assert client.get("/api/v1/admin/settings").status_code == 403
        assert (
            client.put(
                "/api/v1/admin/settings", json={"maxLocalComputersPerEmployee": 9}
            ).status_code
            == 403
        )


def test_enrollment_stops_at_the_global_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    with _client(monkeypatch, database_auth=False) as client:
        _set_global_limit(client, 2)
        _create_employee(client, "alice")
        assert client.post("/api/v1/auth/logout").status_code == 200
        _login(client, "alice")

        assert _enroll(client, "/Users/alice/one").status_code == 201
        assert _enroll(client, "/Users/alice/two").status_code == 201

        response = _enroll(client, "/Users/alice/three")
        assert response.status_code == 409
        assert "2 of 2" in response.json()["detail"]


def test_re_enrolling_an_adopted_computer_is_allowed_at_the_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with _client(monkeypatch, database_auth=False) as client:
        _set_global_limit(client, 1)
        _create_employee(client, "alice")
        assert client.post("/api/v1/auth/logout").status_code == 200
        _login(client, "alice")

        assert _enroll(client, "/Users/alice/only").status_code == 201
        response = _enroll(client, "/Users/alice/only")
        assert response.status_code == 201
        assert response.json()["reused"] is True


def test_zero_limit_blocks_every_enrollment(monkeypatch: pytest.MonkeyPatch) -> None:
    with _client(monkeypatch, database_auth=False) as client:
        _set_global_limit(client, 0)
        _create_employee(client, "alice")
        assert client.post("/api/v1/auth/logout").status_code == 200
        _login(client, "alice")

        assert _enroll(client, "/Users/alice/one").status_code == 409


def test_lowering_the_limit_grandfathers_existing_computers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with _client(monkeypatch, database_auth=False) as client:
        _set_global_limit(client, 3)
        _create_employee(client, "alice")
        assert client.post("/api/v1/auth/logout").status_code == 200
        _login(client, "alice")
        assert _enroll(client, "/Users/alice/one").status_code == 201
        assert _enroll(client, "/Users/alice/two").status_code == 201

        assert client.post("/api/v1/auth/logout").status_code == 200
        _login_admin(client)
        _set_global_limit(client, 1)

        nodes = client.get("/api/v1/admin/daemon-nodes").json()["nodes"]
        assert len([node for node in nodes if node.get("employeeId") == "alice"]) == 2

        assert client.post("/api/v1/auth/logout").status_code == 200
        _login(client, "alice")
        assert _enroll(client, "/Users/alice/three").status_code == 409
        # The computers they already had keep answering.
        assert _enroll(client, "/Users/alice/one").json()["reused"] is True


def test_admin_node_creation_respects_the_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with _client(monkeypatch, database_auth=False) as client:
        _set_global_limit(client, 1)
        _create_employee(client, "alice")

        first = client.post(
            "/api/v1/admin/daemon-nodes",
            json={
                "employeeId": "alice",
                "sandboxMode": "none",
                "nodeLocation": "employee-device",
                "workspacePath": "/Users/alice/one",
            },
        )
        assert first.status_code == 201

        second = client.post(
            "/api/v1/admin/daemon-nodes",
            json={
                "employeeId": "alice",
                "sandboxMode": "none",
                "nodeLocation": "employee-device",
                "workspacePath": "/Users/alice/two",
            },
        )
        assert second.status_code == 409


def test_managed_node_creation_ignores_the_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with _client(monkeypatch, database_auth=False) as client:
        _set_global_limit(client, 0)
        _create_employee(client, "alice")

        response = client.post(
            "/api/v1/admin/daemon-nodes",
            json={"employeeId": "alice", "sandboxMode": "boxlite"},
        )
        assert response.status_code == 201


def test_employee_override_beats_the_global(monkeypatch: pytest.MonkeyPatch) -> None:
    with _client(monkeypatch, database_auth=True) as client:
        _set_global_limit(client, 1)
        employee = _create_employee(client, "alice", maxLocalComputers=2)
        assert employee["maxLocalComputers"] == 2
        assert employee["effectiveMaxLocalComputers"] == 2

        assert client.post("/api/v1/auth/logout").status_code == 200
        _login(client, "alice")
        assert _enroll(client, "/Users/alice/one").status_code == 201
        assert _enroll(client, "/Users/alice/two").status_code == 201
        assert _enroll(client, "/Users/alice/three").status_code == 409


def test_employees_without_an_override_follow_the_global(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with _client(monkeypatch, database_auth=True) as client:
        # The database auth store mints its own employee id, so read it back
        # rather than assuming the requested one.
        alice_id = _create_employee(client, "alice")["id"]
        _set_global_limit(client, 8)

        employees = {
            employee["id"]: employee
            for employee in client.get("/api/v1/admin/employees").json()["employees"]
        }
        alice = employees[alice_id]
        assert alice["maxLocalComputers"] is None
        assert alice["effectiveMaxLocalComputers"] == 8
        assert alice["localComputerCount"] == 0


def test_patch_sets_and_clears_the_override(monkeypatch: pytest.MonkeyPatch) -> None:
    with _client(monkeypatch, database_auth=True) as client:
        _set_global_limit(client, 4)
        alice_id = _create_employee(client, "alice")["id"]

        response = client.patch(
            f"/api/v1/admin/employees/{alice_id}",
            json={"displayName": "Alice A", "email": "alice@example.com",
                  "maxLocalComputers": 1},
        )
        assert response.status_code == 200, response.text
        employee = response.json()["employee"]
        assert employee["displayName"] == "Alice A"
        assert employee["email"] == "alice@example.com"
        assert employee["maxLocalComputers"] == 1
        assert employee["effectiveMaxLocalComputers"] == 1

        cleared = client.patch(
            f"/api/v1/admin/employees/{alice_id}", json={"maxLocalComputers": None}
        )
        assert cleared.status_code == 200
        assert cleared.json()["employee"]["maxLocalComputers"] is None
        # Back to inheriting, so a later global change moves them again.
        assert cleared.json()["employee"]["effectiveMaxLocalComputers"] == 4
        # An unrelated edit leaves the cleared override alone.
        assert (
            client.patch(
                f"/api/v1/admin/employees/{alice_id}", json={"displayName": "Alice B"}
            ).json()["employee"]["maxLocalComputers"]
            is None
        )


def test_patch_rejects_unknown_employee_and_bad_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with _client(monkeypatch, database_auth=True) as client:
        alice_id = _create_employee(client, "alice")["id"]
        assert (
            client.patch(
                "/api/v1/admin/employees/nobody", json={"displayName": "Ghost"}
            ).status_code
            == 404
        )
        assert (
            client.patch(
                f"/api/v1/admin/employees/{alice_id}", json={"maxLocalComputers": 99}
            ).status_code
            == 400
        )
        assert (
            client.patch(
                f"/api/v1/admin/employees/{alice_id}", json={"displayName": "  "}
            ).status_code
            == 400
        )


def test_override_at_creation_needs_the_database_auth_store(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with _client(monkeypatch, database_auth=False) as client:
        response = client.post(
            "/api/v1/admin/employees",
            json={
                "employeeId": "alice",
                "username": "alice",
                "password": "userpass",
                "maxLocalComputers": 2,
            },
        )
        assert response.status_code == 400
        assert "database auth store" in response.json()["detail"]


def test_disconnecting_a_computer_frees_a_slot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with _client(monkeypatch, database_auth=False) as client:
        _set_global_limit(client, 1)
        _create_employee(client, "alice")
        assert client.post("/api/v1/auth/logout").status_code == 200
        _login(client, "alice")

        enrolled = _enroll(client, "/Users/alice/one")
        assert enrolled.status_code == 201
        node_id = enrolled.json()["node"]["id"]
        assert _enroll(client, "/Users/alice/two").status_code == 409

        assert client.delete(f"/api/v1/daemon-nodes/{node_id}").status_code == 204
        assert _enroll(client, "/Users/alice/two").status_code == 201


def test_settings_default_and_update_task_rounds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with _client(monkeypatch, database_auth=False) as client:
        assert client.get("/api/v1/admin/settings").json()["settings"][
            "maxTaskRounds"
        ] == 5

        assert (
            client.put(
                "/api/v1/admin/settings", json={"maxTaskRounds": 9}
            ).status_code
            == 200
        )
        assert client.get("/api/v1/admin/settings").json()["settings"][
            "maxTaskRounds"
        ] == 9

        assert (
            client.put("/api/v1/admin/settings", json={"maxTaskRounds": 0}).status_code
            == 400
        )


def test_saving_one_setting_leaves_the_other_alone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Each card sends only its own field, so one save cannot revert the other."""
    with _client(monkeypatch, database_auth=False) as client:
        _set_global_limit(client, 7)
        assert (
            client.put(
                "/api/v1/admin/settings", json={"maxTaskRounds": 2}
            ).status_code
            == 200
        )

        settings = client.get("/api/v1/admin/settings").json()["settings"]
        assert settings["maxLocalComputersPerEmployee"] == 7
        assert settings["maxTaskRounds"] == 2

        assert (
            client.put("/api/v1/admin/settings", json={}).status_code == 400
        )


def test_auth_me_carries_the_caller_limit_and_usage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Self-service surfaces gate their connect action on /auth/me, so the
    session payload must carry the resolved limit and live usage — an
    admin-only endpoint cannot serve the employee's own page."""
    with _client(monkeypatch, database_auth=False) as client:
        _set_global_limit(client, 2)
        _create_employee(client, "alice")
        assert client.post("/api/v1/auth/logout").status_code == 200
        _login(client, "alice")

        me = client.get("/api/v1/auth/me").json()["user"]
        assert me["effectiveMaxLocalComputers"] == 2
        assert me["localComputerCount"] == 0

        assert _enroll(client, "/Users/alice/one").status_code == 201
        me = client.get("/api/v1/auth/me").json()["user"]
        assert me["localComputerCount"] == 1


def test_auth_me_reflects_the_employee_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with _client(monkeypatch, database_auth=True) as client:
        _set_global_limit(client, 5)
        _create_employee(client, "alice", maxLocalComputers=1)
        assert client.post("/api/v1/auth/logout").status_code == 200
        _login(client, "alice")

        me = client.get("/api/v1/auth/me").json()["user"]
        assert me["maxLocalComputers"] == 1
        assert me["effectiveMaxLocalComputers"] == 1


def test_auth_me_omits_limits_for_users_without_an_employee(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A user with no employee link cannot enroll a computer at all, so their
    # payload stays bare rather than implying a limit of zero.
    with _client(monkeypatch, database_auth=False) as client:
        me = client.get("/api/v1/auth/me").json()["user"]
        assert "effectiveMaxLocalComputers" not in me
        assert "localComputerCount" not in me


def test_preferences_response_keeps_the_limit_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The client replaces its session user with the preferences response, so
    # an undecorated payload here silently ungates the connect CTA until the
    # next reload.
    with _client(monkeypatch, database_auth=False) as client:
        _set_global_limit(client, 2)
        _create_employee(client, "alice")
        assert client.post("/api/v1/auth/logout").status_code == 200
        _login(client, "alice")

        response = client.patch("/api/v1/auth/preferences", json={"theme": "dark"})
        assert response.status_code == 200
        user = response.json()["user"]
        assert user["effectiveMaxLocalComputers"] == 2
        assert user["localComputerCount"] == 0


def test_login_response_carries_the_limit_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # LoginScreen seeds the session user straight from the login response —
    # there is no /auth/me round trip before the My Computer page can render.
    with _client(monkeypatch, database_auth=False) as client:
        _set_global_limit(client, 4)
        _create_employee(client, "alice")
        assert client.post("/api/v1/auth/logout").status_code == 200

        response = client.post(
            "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
        )
        assert response.status_code == 200
        assert response.json()["user"]["effectiveMaxLocalComputers"] == 4
