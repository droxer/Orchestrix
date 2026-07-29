from __future__ import annotations

from tempfile import TemporaryDirectory

from relay.security.auth import DatabaseUserAuthStore, UserAuthStore
from relay.init_users import main


def test_init_users_script_creates_default_admin(capsys, monkeypatch) -> None:
    monkeypatch.setenv("RELAY_STORAGE", "")
    monkeypatch.setenv("RELAY_AUTH_STORE", "")
    with TemporaryDirectory() as root:
        result = main(["--data-dir", root])

        assert result == 0
        assert "Created admin user admin." in capsys.readouterr().out
        store = UserAuthStore(root)
        user = store.authenticate("admin", "admin")
        assert user is not None
        assert user["role"] == "admin"
        assert user["employeeId"] == "admin"
        assert user["departmentId"] == "administration"


def test_init_users_script_creates_database_admin(capsys, monkeypatch) -> None:
    monkeypatch.setenv("RELAY_AUTH_STORE", "database")
    with TemporaryDirectory() as root:
        database_url = f"sqlite:///{root}/auth.db"
        monkeypatch.setenv("RELAY_DATABASE_URL", database_url)
        DatabaseUserAuthStore(database_url, create_schema=True)

        result = main(["--data-dir", root])

        assert result == 0
        assert "Created admin user admin." in capsys.readouterr().out
        store = DatabaseUserAuthStore(database_url)
        user = store.authenticate("admin", "admin")
        assert user is not None
        assert user["role"] == "admin"
        departments = store.list_departments()
        assert departments[0]["name"] == "Administration"
        employees = store.list_employees()
        assert employees[0]["id"] == user["employeeId"]
        assert employees[0]["displayName"] == "admin"
        assert employees[0]["departmentId"] == departments[0]["id"]


def test_init_users_script_can_skip_when_users_exist(capsys, monkeypatch) -> None:
    monkeypatch.setenv("RELAY_STORAGE", "")
    monkeypatch.setenv("RELAY_AUTH_STORE", "")
    with TemporaryDirectory() as root:
        assert main(["--data-dir", root]) == 0
        assert main(["--data-dir", root, "--only-if-empty"]) == 0
        assert "Users already exist; skipped." in capsys.readouterr().out
