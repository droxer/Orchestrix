from __future__ import annotations

import json
import os
import stat
import time
from concurrent.futures import ThreadPoolExecutor
from tempfile import TemporaryDirectory

import pytest
from fastapi import HTTPException
from relay.security import auth as auth_module
from relay.security.auth import (
    DatabaseUserAuthStore,
    UserAuthStore,
    configure_admin_token,
    get_admin_token,
    hash_session_token,
)
from sqlalchemy import create_engine, text


def test_local_auth_store_hashes_session_tokens_and_restricts_files() -> None:
    with TemporaryDirectory() as root:
        store = UserAuthStore(root)
        user = store.create_user("alice", "secret123")
        session = store.create_session(user["id"])

        persisted = json.loads(store.sessions_path.read_text(encoding="utf-8"))
        assert persisted[0]["tokenHash"] == hash_session_token(session["token"])
        assert "token" not in persisted[0]
        assert store.get_session_by_token(session["token"])["userId"] == user["id"]
        assert stat.S_IMODE(store.auth_dir.stat().st_mode) == 0o700
        assert stat.S_IMODE(store.users_path.stat().st_mode) == 0o600
        assert stat.S_IMODE(store.sessions_path.stat().st_mode) == 0o600


def test_database_auth_store_preserves_utc_timestamps_outside_utc() -> None:
    previous_timezone = os.environ.get("TZ")
    os.environ["TZ"] = "Asia/Shanghai"
    time.tzset()
    try:
        with TemporaryDirectory() as root:
            store = DatabaseUserAuthStore(
                f"sqlite:///{root}/auth.db", create_schema=True
            )
            created = store.create_user("alice", "secret123")
            persisted = store.get_user_by_id(created["id"])

            assert persisted is not None
            assert persisted["createdAt"] == created["createdAt"]
    finally:
        if previous_timezone is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = previous_timezone
        time.tzset()


def test_database_auth_store_persists_users_and_hashes_session_tokens() -> None:
    with TemporaryDirectory() as root:
        database_url = f"sqlite:///{root}/auth.db"
        store = DatabaseUserAuthStore(database_url, create_schema=True)

        user = store.create_user(
            " Alice ", "secret123", role="admin", email="alice@example.com"
        )
        assert user["username"] == "alice"
        assert user["role"] == "admin"
        assert user["employeeId"]
        assert "passwordHash" not in user

        assert store.authenticate("ALICE", "secret123")["id"] == user["id"]
        assert store.authenticate("alice", "wrong") is None

        session = store.create_session(user["id"])
        assert store.get_session_by_token(session["token"])["userId"] == user["id"]

        engine = create_engine(database_url, future=True)
        with engine.begin() as conn:
            row = (
                conn.execute(text("select token_hash from auth_sessions"))
                .mappings()
                .one()
            )
            employee = (
                conn.execute(text("select id, display_name, email from employees"))
                .mappings()
                .one()
            )

        assert row["token_hash"] == hash_session_token(session["token"])
        assert row["token_hash"] != session["token"]
        assert dict(employee) == {
            "id": user["employeeId"],
            "display_name": "alice",
            "email": "alice@example.com",
        }
        assert store.delete_session(session["token"]) is True
        assert store.get_session_by_token(session["token"]) is None


def test_database_auth_store_normalizes_human_readable_ids_before_uuid_queries() -> None:
    normalize = auth_module.normalize_database_id

    assert normalize("alice") is None
    generated = normalize("550E8400-E29B-41D4-A716-446655440000")
    assert generated == "550e8400-e29b-41d4-a716-446655440000"


@pytest.mark.parametrize("store_kind", ["local", "database"])
def test_bootstrap_allows_exactly_one_concurrent_first_admin(store_kind: str) -> None:
    with TemporaryDirectory() as root:
        configure_admin_token(root)
        if store_kind == "database":
            store = DatabaseUserAuthStore(
                f"sqlite:///{root}/auth.db", create_schema=True
            )
        else:
            store = UserAuthStore(root)
        token = get_admin_token()
        assert token is not None

        def bootstrap(index: int) -> str:
            try:
                store.bootstrap_with_token(token, f"admin-{index}", "secret123")
            except HTTPException as error:
                return f"http-{error.status_code}"
            return "created"

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(bootstrap, range(2)))

        assert sorted(outcomes) == ["created", "http-409"]
        assert len(store.list_users()) == 1


def test_database_auth_store_enforces_unique_normalized_usernames() -> None:
    with TemporaryDirectory() as root:
        store = DatabaseUserAuthStore(f"sqlite:///{root}/auth.db", create_schema=True)
        store.create_user("Alice", "secret123")

        try:
            store.create_user(" alice ", "secret123")
        except ValueError as error:
            assert str(error) == "username already exists."
        else:
            raise AssertionError(
                "Expected duplicate normalized username to be rejected."
            )


def test_database_auth_store_persists_user_preferences() -> None:
    with TemporaryDirectory() as root:
        database_url = f"sqlite:///{root}/auth.db"
        store = DatabaseUserAuthStore(database_url, create_schema=True)
        user = store.create_user("alice", "secret123")

        updated = store.update_user_preferences(
            user["id"],
            theme="dark",
            language="zh-TW",
        )

        assert updated["theme"] == "dark"
        assert updated["language"] == "zh-TW"

        reopened = DatabaseUserAuthStore(database_url)
        persisted = reopened.get_user_by_id(user["id"])
        assert persisted is not None
        assert persisted["theme"] == "dark"
        assert persisted["language"] == "zh-TW"
