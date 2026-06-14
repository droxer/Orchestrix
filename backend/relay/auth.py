from __future__ import annotations

import hashlib
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import HTTPException, Request
from loguru import logger
from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, MetaData, Table, Text, Uuid, create_engine, delete, insert, select, update
from sqlalchemy.exc import IntegrityError

from .ids import new_database_id, new_relay_id, now_iso
from .storage_config import database_url_from_env, use_postgres_storage

DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60  # 1 week
USER_COOKIE_NAME = "relay_session"
PW_HASH_ALGORITHM = "pbkdf2_sha256"
PW_HASH_ITERATIONS = 600_000
UserRole = Literal["admin", "user"]


def database_id_column() -> Column[Any]:
    return Column("id", Uuid(as_uuid=False), primary_key=True, default=new_database_id)


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _format_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _read_json(path: Path) -> Any:
    import json

    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _write_json(path: Path, value: Any, mode: int | None = 0o600) -> None:
    import json

    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    if mode is None:
        with tmp.open("w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2)
            handle.write("\n")
    else:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2)
            handle.write("\n")
    tmp.replace(path)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), PW_HASH_ITERATIONS).hex()
    return f"{PW_HASH_ALGORITHM}${PW_HASH_ITERATIONS}${salt}${digest}"


def verify_password(password: str, hashed: str) -> bool:
    try:
        algorithm, iterations, salt, digest = hashed.split("$")
    except ValueError:
        return False
    if algorithm != PW_HASH_ALGORITHM:
        return False
    try:
        iterations = int(iterations)
    except ValueError:
        return False
    expected = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations).hex()
    return secrets.compare_digest(expected, digest)


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class UserAuthStore:
    def __init__(self, root_dir: str | Path, *, session_ttl_seconds: int = DEFAULT_SESSION_TTL_SECONDS):
        self.root_dir = Path(root_dir)
        self.auth_dir = self.root_dir / "auth"
        self.users_path = self.auth_dir / "users.json"
        self.sessions_path = self.auth_dir / "sessions.json"
        self.session_ttl_seconds = session_ttl_seconds

    def has_users(self) -> bool:
        return len(self._read_users()) > 0

    def create_user(
        self,
        username: str,
        password: str,
        role: UserRole = "user",
        email: str | None = None,
        employee_id: str | None = None,
        display_name: str | None = None,
        department_id: str | None = None,
        department_name: str | None = None,
    ) -> dict[str, Any]:
        users = self._read_users()
        username = username.strip().lower()
        if not username:
            raise ValueError("username is required.")
        if not password:
            raise ValueError("password is required.")
        if role not in ("admin", "user"):
            raise ValueError("role must be admin or user.")
        if any(user["username"] == username for user in users):
            raise ValueError("username already exists.")
        user = {
            "id": new_relay_id("usr"),
            "username": username,
            "email": email.strip() if email else None,
            "role": role,
            "employeeId": employee_id.strip() if employee_id else None,
            "displayName": display_name.strip() if display_name else None,
            "departmentId": department_id.strip() if department_id else None,
            "departmentName": department_name.strip() if department_name else None,
            "passwordHash": hash_password(password),
            "createdAt": now_iso(),
            "updatedAt": now_iso(),
        }
        users.append(user)
        self._write_users(users)
        logger.info("User created", user_id=user["id"], username=username, role=role)
        return self._public_user(user)

    def authenticate(self, username: str, password: str) -> dict[str, Any] | None:
        username = username.strip().lower()
        for user in self._read_users():
            if user["username"] == username and verify_password(password, user["passwordHash"]):
                return user
        return None

    def bootstrap_with_token(self, token: str, username: str, password: str) -> dict[str, Any]:
        expected = os.environ.get("RELAY_ADMIN_TOKEN", "").strip()
        if not expected:
            raise HTTPException(503, "RELAY_ADMIN_TOKEN is not configured.")
        if not token or len(token) != len(expected) or not secrets.compare_digest(token, expected):
            raise HTTPException(401, "Invalid admin token.")
        if self.has_users():
            raise HTTPException(409, "Bootstrap is only allowed before the first user is created.")
        return self.create_user(username, password, role="admin")

    def create_session(self, user_id: str) -> dict[str, Any]:
        token = new_session_token()
        now = datetime.now(timezone.utc)
        expires_at = now.timestamp() + self.session_ttl_seconds
        session = {
            "token": token,
            "userId": user_id,
            "createdAt": _format_iso(now),
            "expiresAt": _format_iso(datetime.fromtimestamp(expires_at, tz=timezone.utc)),
        }
        sessions = self._read_sessions()
        sessions.append(session)
        self._write_sessions(sessions)
        return session

    def get_session_by_token(self, token: str | None) -> dict[str, Any] | None:
        if not token:
            return None
        sessions = self._read_sessions()
        for session in sessions:
            if session.get("token") == token:
                expires_at = _parse_iso(session.get("expiresAt"))
                if expires_at and expires_at <= datetime.now(timezone.utc):
                    self.delete_session(token)
                    return None
                return session
        return None

    def get_user_by_id(self, user_id: str) -> dict[str, Any] | None:
        return next((user for user in self._read_users() if user["id"] == user_id), None)

    def delete_session(self, token: str) -> bool:
        sessions = self._read_sessions()
        before = len(sessions)
        sessions = [s for s in sessions if s.get("token") != token]
        if len(sessions) < before:
            self._write_sessions(sessions)
            return True
        return False

    def cleanup_expired_sessions(self) -> int:
        sessions = self._read_sessions()
        now = datetime.now(timezone.utc)
        kept = [s for s in sessions if not (_parse_iso(s.get("expiresAt")) and _parse_iso(s.get("expiresAt")) <= now)]
        removed = len(sessions) - len(kept)
        if removed:
            self._write_sessions(kept)
        return removed

    def list_users(self) -> list[dict[str, Any]]:
        return [self._public_user(user) for user in self._read_users()]

    def _read_users(self) -> list[dict[str, Any]]:
        return _read_json(self.users_path) if self.users_path.exists() else []

    def _write_users(self, users: list[dict[str, Any]]) -> None:
        _write_json(self.users_path, users)

    def _read_sessions(self) -> list[dict[str, Any]]:
        return _read_json(self.sessions_path) if self.sessions_path.exists() else []

    def _write_sessions(self, sessions: list[dict[str, Any]]) -> None:
        _write_json(self.sessions_path, sessions)

    @staticmethod
    def _public_user(user: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": user["id"],
            "username": user["username"],
            "email": user.get("email"),
            "role": user["role"],
            "employeeId": user.get("employeeId"),
            "displayName": user.get("displayName"),
            "createdAt": user["createdAt"],
        }


class DatabaseUserAuthStore:
    metadata = MetaData()

    departments = Table(
        "departments",
        metadata,
        database_id_column(),
        Column("public_id", Text, nullable=False, unique=True),
        Column("name", Text, nullable=False),
        Column("parent_department_id", Uuid(as_uuid=False), ForeignKey("departments.id", ondelete="SET NULL"), nullable=True),
        Column("parent_department_public_id", Text, nullable=True),
        Column("created_at", DateTime(timezone=True), nullable=False),
        Column("updated_at", DateTime(timezone=True), nullable=False),
    )
    employees = Table(
        "employees",
        metadata,
        database_id_column(),
        Column("public_id", Text, nullable=False, unique=True),
        Column("display_name", Text, nullable=False),
        Column("email", Text, nullable=True),
        Column("department_id", Uuid(as_uuid=False), ForeignKey("departments.id", ondelete="SET NULL"), nullable=True),
        Column("department_public_id", Text, nullable=True),
        Column("created_at", DateTime(timezone=True), nullable=False),
        Column("updated_at", DateTime(timezone=True), nullable=False),
    )
    users = Table(
        "auth_users",
        metadata,
        database_id_column(),
        Column("public_id", Text, nullable=False, unique=True),
        Column("username", Text, nullable=False, unique=True),
        Column("email", Text, nullable=True),
        Column("role", Text, nullable=False),
        Column("employee_id", Uuid(as_uuid=False), ForeignKey("employees.id", ondelete="SET NULL"), nullable=True),
        Column("employee_public_id", Text, nullable=True),
        Column("password_hash", Text, nullable=False),
        Column("created_at", DateTime(timezone=True), nullable=False),
        Column("updated_at", DateTime(timezone=True), nullable=False),
        CheckConstraint("role in ('admin', 'user')", name="ck_auth_users_role"),
    )
    sessions = Table(
        "auth_sessions",
        metadata,
        database_id_column(),
        Column("public_id", Text, nullable=False, unique=True),
        Column("token_hash", Text, nullable=False, unique=True),
        Column("user_id", Uuid(as_uuid=False), ForeignKey("auth_users.id", ondelete="CASCADE"), nullable=False),
        Column("user_public_id", Text, nullable=False),
        Column("created_at", DateTime(timezone=True), nullable=False),
        Column("expires_at", DateTime(timezone=True), nullable=False),
    )

    def __init__(
        self,
        database_url: str,
        *,
        session_ttl_seconds: int = DEFAULT_SESSION_TTL_SECONDS,
        create_schema: bool = False,
    ):
        self.engine = create_engine(database_url, future=True)
        self.session_ttl_seconds = session_ttl_seconds
        if create_schema:
            self.metadata.create_all(self.engine)

    def has_users(self) -> bool:
        with self.engine.begin() as conn:
            return conn.execute(select(self.users.c.id).limit(1)).first() is not None

    def create_user(
        self,
        username: str,
        password: str,
        role: UserRole = "user",
        email: str | None = None,
        employee_id: str | None = None,
        display_name: str | None = None,
        department_id: str | None = None,
        department_name: str | None = None,
    ) -> dict[str, Any]:
        username = username.strip().lower()
        if not username:
            raise ValueError("username is required.")
        if not password:
            raise ValueError("password is required.")
        if role not in ("admin", "user"):
            raise ValueError("role must be admin or user.")
        employee_id = employee_id.strip() if employee_id else username
        display_name = display_name.strip() if display_name else username
        department_id = department_id.strip() if department_id else None
        department_name = department_name.strip() if department_name else None
        email = email.strip() if email else None

        now = datetime.now(timezone.utc)
        user = {
            "id": new_relay_id("usr"),
            "username": username,
            "email": email,
            "role": role,
            "employeeId": employee_id,
            "passwordHash": hash_password(password),
            "createdAt": _format_iso(now),
            "updatedAt": _format_iso(now),
        }
        try:
            with self.engine.begin() as conn:
                self._ensure_employee(conn, employee_id, display_name=display_name, email=email, department_id=department_id, department_name=department_name)
                conn.execute(insert(self.users).values(**database_user_to_row(user, employee_pk=self._employee_pk(conn, employee_id))))
        except IntegrityError as error:
            raise ValueError("username already exists.") from error
        logger.info("User created", user_id=user["id"], username=username, role=role)
        return UserAuthStore._public_user(user)

    def ensure_department(self, department_id: str, *, name: str | None = None, parent_department_id: str | None = None) -> dict[str, Any]:
        department_id = department_id.strip()
        if not department_id:
            raise ValueError("departmentId is required.")
        with self.engine.begin() as conn:
            return self._ensure_department(conn, department_id, name=name, parent_department_id=parent_department_id)

    def list_departments(self) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = conn.execute(select(self.departments).order_by(self.departments.c.name)).mappings().all()
        return [row_to_department(row) for row in rows]

    def ensure_employee(
        self,
        employee_id: str,
        *,
        display_name: str | None = None,
        email: str | None = None,
        department_id: str | None = None,
        department_name: str | None = None,
    ) -> dict[str, Any]:
        employee_id = employee_id.strip()
        if not employee_id:
            raise ValueError("employeeId is required.")
        with self.engine.begin() as conn:
            return self._ensure_employee(conn, employee_id, display_name=display_name, email=email, department_id=department_id, department_name=department_name)

    def list_employees(self) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            department_rows = conn.execute(select(self.departments)).mappings().all()
            departments = {row["public_id"]: row_to_department(row) for row in department_rows}
            rows = conn.execute(select(self.employees).order_by(self.employees.c.public_id)).mappings().all()
        return [employee_with_department(row_to_employee(row), departments) for row in rows]

    def authenticate(self, username: str, password: str) -> dict[str, Any] | None:
        username = username.strip().lower()
        with self.engine.begin() as conn:
            row = conn.execute(select(self.users).where(self.users.c.username == username)).mappings().first()
        user = row_to_database_user(row) if row else None
        if user and verify_password(password, user["passwordHash"]):
            return user
        return None

    def bootstrap_with_token(self, token: str, username: str, password: str) -> dict[str, Any]:
        expected = os.environ.get("RELAY_ADMIN_TOKEN", "").strip()
        if not expected:
            raise HTTPException(503, "RELAY_ADMIN_TOKEN is not configured.")
        if not token or len(token) != len(expected) or not secrets.compare_digest(token, expected):
            raise HTTPException(401, "Invalid admin token.")
        if self.has_users():
            raise HTTPException(409, "Bootstrap is only allowed before the first user is created.")
        return self.create_user(username, password, role="admin")

    def create_session(self, user_id: str) -> dict[str, Any]:
        token = new_session_token()
        now = datetime.now(timezone.utc)
        expires_at = datetime.fromtimestamp(now.timestamp() + self.session_ttl_seconds, tz=timezone.utc)
        session = {
            "id": new_relay_id("usess"),
            "token": token,
            "userId": user_id,
            "createdAt": _format_iso(now),
            "expiresAt": _format_iso(expires_at),
        }
        with self.engine.begin() as conn:
            conn.execute(insert(self.sessions).values(**database_session_to_row(session, user_pk=self._user_pk(conn, user_id))))
        return session

    def get_session_by_token(self, token: str | None) -> dict[str, Any] | None:
        if not token:
            return None
        with self.engine.begin() as conn:
            row = conn.execute(select(self.sessions).where(self.sessions.c.token_hash == hash_session_token(token))).mappings().first()
            if not row:
                return None
            session = row_to_database_session(row, token)
            expires_at = _parse_iso(session.get("expiresAt"))
            if expires_at and expires_at <= datetime.now(timezone.utc):
                conn.execute(delete(self.sessions).where(self.sessions.c.token_hash == hash_session_token(token)))
                return None
        return session

    def get_user_by_id(self, user_id: str) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            row = conn.execute(select(self.users).where(self.users.c.public_id == user_id)).mappings().first()
        return row_to_database_user(row) if row else None

    def delete_session(self, token: str) -> bool:
        with self.engine.begin() as conn:
            result = conn.execute(delete(self.sessions).where(self.sessions.c.token_hash == hash_session_token(token)))
        return result.rowcount > 0

    def cleanup_expired_sessions(self) -> int:
        with self.engine.begin() as conn:
            result = conn.execute(delete(self.sessions).where(self.sessions.c.expires_at <= datetime.now(timezone.utc)))
        return result.rowcount

    def list_users(self) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = conn.execute(select(self.users).order_by(self.users.c.created_at)).mappings().all()
        return [UserAuthStore._public_user(row_to_database_user(row)) for row in rows]

    @staticmethod
    def _public_user(user: dict[str, Any]) -> dict[str, Any]:
        return UserAuthStore._public_user(user)

    def _ensure_department(self, conn: Any, department_id: str, *, name: str | None = None, parent_department_id: str | None = None) -> dict[str, Any]:
        department_id = department_id.strip()
        name = name.strip() if name else department_id
        parent_department_id = parent_department_id.strip() if parent_department_id else None
        now = datetime.now(timezone.utc)
        if parent_department_id:
            self._ensure_department(conn, parent_department_id)
        row = conn.execute(select(self.departments).where(self.departments.c.public_id == department_id)).mappings().first()
        if row:
            department_pk = row["id"]
            patch: dict[str, Any] = {"updated_at": now}
            if name:
                patch["name"] = name
            if parent_department_id:
                patch["parent_department_id"] = self._department_pk(conn, parent_department_id)
                patch["parent_department_public_id"] = parent_department_id
            if len(patch) > 1:
                conn.execute(update(self.departments).where(self.departments.c.id == department_pk).values(**patch))
                return {
                    **row_to_department(row),
                    "name": patch.get("name", row["name"]),
                    "parentDepartmentId": patch.get("parent_department_public_id", row["parent_department_public_id"]),
                    "updatedAt": _format_iso(now),
                }
            return row_to_department(row)

        department = {
            "id": department_id,
            "name": name,
            "parentDepartmentId": parent_department_id,
            "createdAt": _format_iso(now),
            "updatedAt": _format_iso(now),
        }
        parent_department_pk = self._department_pk(conn, parent_department_id) if parent_department_id else None
        conn.execute(insert(self.departments).values(**department_to_row(department, parent_department_pk=parent_department_pk)))
        return department

    def _ensure_employee(
        self,
        conn: Any,
        employee_id: str,
        *,
        display_name: str | None = None,
        email: str | None = None,
        department_id: str | None = None,
        department_name: str | None = None,
    ) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        department_id = department_id.strip() if department_id else None
        if department_id:
            self._ensure_department(conn, department_id, name=department_name)
        row = conn.execute(select(self.employees).where(self.employees.c.public_id == employee_id)).mappings().first()
        if row:
            employee_pk = row["id"]
            patch: dict[str, Any] = {"updated_at": now}
            if display_name:
                patch["display_name"] = display_name
            if email:
                patch["email"] = email
            if department_id:
                patch["department_id"] = self._department_pk(conn, department_id)
                patch["department_public_id"] = department_id
            if len(patch) > 1:
                conn.execute(update(self.employees).where(self.employees.c.id == employee_pk).values(**patch))
                return {
                    **row_to_employee(row),
                    **({"displayName": display_name} if display_name else {}),
                    **({"email": email} if email else {}),
                    **({"departmentId": department_id} if department_id else {}),
                    "updatedAt": _format_iso(now),
                }
            return row_to_employee(row)

        employee = {
            "id": employee_id,
            "displayName": display_name or employee_id,
            "email": email,
            "departmentId": department_id,
            "createdAt": _format_iso(now),
            "updatedAt": _format_iso(now),
        }
        department_pk = self._department_pk(conn, department_id) if department_id else None
        conn.execute(insert(self.employees).values(**employee_to_row(employee, department_pk=department_pk)))
        return employee

    def _user_pk(self, conn: Any, user_id: str) -> str:
        user_pk = conn.scalar(select(self.users.c.id).where(self.users.c.public_id == user_id))
        if not user_pk:
            raise KeyError(user_id)
        return user_pk

    def _employee_pk(self, conn: Any, employee_id: str) -> str:
        employee_pk = conn.scalar(select(self.employees.c.id).where(self.employees.c.public_id == employee_id))
        if not employee_pk:
            raise KeyError(employee_id)
        return employee_pk

    def _department_pk(self, conn: Any, department_id: str) -> str:
        department_pk = conn.scalar(select(self.departments.c.id).where(self.departments.c.public_id == department_id))
        if not department_pk:
            raise KeyError(department_id)
        return department_pk


def auth_store_from_env(root_dir: str | Path) -> Any:
    auth_store = os.environ.get("RELAY_AUTH_STORE", "").strip().lower()
    if auth_store != "database" and not use_postgres_storage():
        return UserAuthStore(root_dir)
    setting = "RELAY_AUTH_STORE=database" if auth_store == "database" else "RELAY_STORAGE=postgres"
    database_url = database_url_from_env(setting=setting)
    return DatabaseUserAuthStore(database_url)


def database_user_to_row(user: dict[str, Any], *, employee_pk: str | None = None) -> dict[str, Any]:
    return {
        "id": new_database_id(),
        "public_id": user["id"],
        "username": user["username"],
        "email": user.get("email"),
        "role": user["role"],
        "employee_id": employee_pk,
        "employee_public_id": user.get("employeeId"),
        "password_hash": user["passwordHash"],
        "created_at": _parse_iso(user["createdAt"]),
        "updated_at": _parse_iso(user["updatedAt"]),
    }


def employee_to_row(employee: dict[str, Any], *, department_pk: str | None = None) -> dict[str, Any]:
    return {
        "id": new_database_id(),
        "public_id": employee["id"],
        "display_name": employee["displayName"],
        "email": employee.get("email"),
        "department_id": department_pk,
        "department_public_id": employee.get("departmentId"),
        "created_at": _parse_iso(employee["createdAt"]),
        "updated_at": _parse_iso(employee["updatedAt"]),
    }


def department_to_row(department: dict[str, Any], *, parent_department_pk: str | None = None) -> dict[str, Any]:
    return {
        "id": new_database_id(),
        "public_id": department["id"],
        "name": department["name"],
        "parent_department_id": parent_department_pk,
        "parent_department_public_id": department.get("parentDepartmentId"),
        "created_at": _parse_iso(department["createdAt"]),
        "updated_at": _parse_iso(department["updatedAt"]),
    }


def row_to_department(row: Any) -> dict[str, Any]:
    return {
        "id": row["public_id"],
        "name": row["name"],
        "parentDepartmentId": row["parent_department_public_id"],
        "createdAt": _format_iso(row["created_at"]),
        "updatedAt": _format_iso(row["updated_at"]),
    }


def row_to_employee(row: Any) -> dict[str, Any]:
    return {
        "id": row["public_id"],
        "displayName": row["display_name"],
        "email": row["email"],
        "departmentId": row["department_public_id"],
        "createdAt": _format_iso(row["created_at"]),
        "updatedAt": _format_iso(row["updated_at"]),
    }


def employee_with_department(employee: dict[str, Any], departments: dict[str, dict[str, Any]]) -> dict[str, Any]:
    department = departments.get(employee.get("departmentId") or "")
    if not department:
        return employee
    return {**employee, "departmentName": department["name"]}


def row_to_database_user(row: Any) -> dict[str, Any]:
    return {
        "id": row["public_id"],
        "username": row["username"],
        "email": row["email"],
        "role": row["role"],
        "employeeId": row["employee_public_id"],
        "passwordHash": row["password_hash"],
        "createdAt": _format_iso(row["created_at"]),
        "updatedAt": _format_iso(row["updated_at"]),
    }


def database_session_to_row(session: dict[str, Any], *, user_pk: str) -> dict[str, Any]:
    return {
        "id": new_database_id(),
        "public_id": session["id"],
        "token_hash": hash_session_token(session["token"]),
        "user_id": user_pk,
        "user_public_id": session["userId"],
        "created_at": _parse_iso(session["createdAt"]),
        "expires_at": _parse_iso(session["expiresAt"]),
    }


def row_to_database_session(row: Any, token: str) -> dict[str, Any]:
    return {
        "id": row["public_id"],
        "token": token,
        "userId": row["user_public_id"],
        "createdAt": _format_iso(row["created_at"]),
        "expiresAt": _format_iso(row["expires_at"]),
    }


def user_session_token_from_request(request: Request) -> str | None:
    return request.cookies.get(USER_COOKIE_NAME)


def require_user_session(request: Request, auth_store: UserAuthStore) -> dict[str, Any]:
    token = user_session_token_from_request(request)
    if not token:
        raise HTTPException(401, "Authentication required.")
    session = auth_store.get_session_by_token(token)
    if not session:
        raise HTTPException(401, "Session expired or invalid.")
    user = auth_store.get_user_by_id(session["userId"])
    if not user:
        raise HTTPException(401, "User not found.")
    return user


def require_admin_session(request: Request, auth_store: UserAuthStore) -> dict[str, Any]:
    user = require_user_session(request, auth_store)
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin access required.")
    return user


def user_session_cookie_attrs(*, max_age_seconds: int, secure: bool | None = None) -> dict[str, Any]:
    attrs: dict[str, Any] = {
        "key": USER_COOKIE_NAME,
        "httponly": True,
        "samesite": "lax",
        "max_age": max_age_seconds,
        "path": "/",
    }
    if secure is not None:
        attrs["secure"] = secure
    return attrs
