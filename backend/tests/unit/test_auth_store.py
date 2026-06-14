from __future__ import annotations

from tempfile import TemporaryDirectory

from sqlalchemy import create_engine, text

from relay.auth import DatabaseUserAuthStore, hash_session_token


def test_database_auth_store_persists_users_and_hashes_session_tokens() -> None:
    with TemporaryDirectory() as root:
        database_url = f"sqlite:///{root}/auth.db"
        store = DatabaseUserAuthStore(database_url, create_schema=True)

        user = store.create_user(" Alice ", "secret123", role="admin", email="alice@example.com", employee_id="emp_1")
        assert user["username"] == "alice"
        assert user["role"] == "admin"
        assert "passwordHash" not in user

        assert store.authenticate("ALICE", "secret123")["id"] == user["id"]
        assert store.authenticate("alice", "wrong") is None

        session = store.create_session(user["id"])
        assert store.get_session_by_token(session["token"])["userId"] == user["id"]

        engine = create_engine(database_url, future=True)
        with engine.begin() as conn:
            row = conn.execute(text("select token_hash from auth_sessions")).mappings().one()
            employee = conn.execute(text("select public_id, display_name, email from employees")).mappings().one()

        assert row["token_hash"] == hash_session_token(session["token"])
        assert row["token_hash"] != session["token"]
        assert dict(employee) == {"public_id": "emp_1", "display_name": "alice", "email": "alice@example.com"}
        assert store.delete_session(session["token"]) is True
        assert store.get_session_by_token(session["token"]) is None


def test_database_auth_store_enforces_unique_normalized_usernames() -> None:
    with TemporaryDirectory() as root:
        store = DatabaseUserAuthStore(f"sqlite:///{root}/auth.db", create_schema=True)
        store.create_user("Alice", "secret123")

        try:
            store.create_user(" alice ", "secret123")
        except ValueError as error:
            assert str(error) == "username already exists."
        else:
            raise AssertionError("Expected duplicate normalized username to be rejected.")
