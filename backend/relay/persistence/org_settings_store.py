"""Org-wide admin settings.

A single row, database-only. The backend always has a database engine (sessions
and tasks require one), so a second file-backed implementation would only add a
divergent code path to keep in sync.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Integer,
    Table,
    Text,
    insert,
    select,
    update,
)

from .store_common import (
    _format_iso,
    create_all_tables,
    metadata as shared_metadata,
    shared_engine,
    store_transaction,
)

# The whole table is one row; the id is a constant so concurrent writers
# contend on a single primary key rather than racing to insert siblings.
SETTINGS_ROW_ID = "org"

DEFAULT_MAX_LOCAL_COMPUTERS = 3
# 0 means "this employee may enroll no personal machine". The ceiling exists so
# a typo cannot turn the limit into an accidental no-op; an admin who wants no
# practical cap sets the ceiling.
MIN_MAX_LOCAL_COMPUTERS = 0
MAX_MAX_LOCAL_COMPUTERS = 50

# How many times a task may be re-dispatched because its last round reported it
# unfinished. One means "no automatic continuation": the first round is not a
# continuation, so the cap only bounds the rounds that follow.
DEFAULT_MAX_TASK_ROUNDS = 5
MIN_MAX_TASK_ROUNDS = 1
MAX_MAX_TASK_ROUNDS = 50


class OrgSettingsValidationError(ValueError):
    pass


def normalize_max_local_computers(value: Any) -> int:
    """Coerce an API-supplied limit, rejecting anything outside the range."""
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise OrgSettingsValidationError(
            "maxLocalComputers must be a whole number."
        )
    try:
        limit = int(value)
    except (TypeError, ValueError) as error:
        raise OrgSettingsValidationError(
            "maxLocalComputers must be a whole number."
        ) from error
    if limit < MIN_MAX_LOCAL_COMPUTERS or limit > MAX_MAX_LOCAL_COMPUTERS:
        raise OrgSettingsValidationError(
            "maxLocalComputers must be between "
            f"{MIN_MAX_LOCAL_COMPUTERS} and {MAX_MAX_LOCAL_COMPUTERS}."
        )
    return limit


def normalize_max_task_rounds(value: Any) -> int:
    """Coerce an API-supplied round cap, rejecting anything outside the range."""
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise OrgSettingsValidationError("maxTaskRounds must be a whole number.")
    try:
        rounds = int(value)
    except (TypeError, ValueError) as error:
        raise OrgSettingsValidationError(
            "maxTaskRounds must be a whole number."
        ) from error
    if rounds < MIN_MAX_TASK_ROUNDS or rounds > MAX_MAX_TASK_ROUNDS:
        raise OrgSettingsValidationError(
            f"maxTaskRounds must be between {MIN_MAX_TASK_ROUNDS} and "
            f"{MAX_MAX_TASK_ROUNDS}."
        )
    return rounds


class DatabaseOrgSettingsStore:
    metadata = shared_metadata

    settings = Table(
        "org_settings",
        metadata,
        Column("id", Text, primary_key=True),
        Column(
            "max_local_computers_per_employee",
            Integer,
            nullable=False,
        ),
        Column(
            "max_task_rounds",
            Integer,
            nullable=False,
            server_default=str(DEFAULT_MAX_TASK_ROUNDS),
        ),
        Column("created_at", DateTime(timezone=True), nullable=False),
        Column("updated_at", DateTime(timezone=True), nullable=False),
        CheckConstraint(
            "max_task_rounds >= 1",
            name="ck_org_settings_max_task_rounds_positive",
        ),
        CheckConstraint(
            "max_local_computers_per_employee >= 0",
            name="ck_org_settings_max_local_computers_non_negative",
        ),
    )

    def __init__(self, database_url: str, *, create_schema: bool = False):
        self.engine = shared_engine(database_url)
        if create_schema:
            create_all_tables(self.engine)

    def get_settings(self) -> dict[str, Any]:
        with store_transaction(self.engine) as conn:
            row = (
                conn.execute(
                    select(self.settings).where(self.settings.c.id == SETTINGS_ROW_ID)
                )
                .mappings()
                .first()
            )
        if not row:
            # Absent row is the shipped default rather than an error: a fresh
            # install has never opened the settings screen.
            return {
                "maxLocalComputersPerEmployee": DEFAULT_MAX_LOCAL_COMPUTERS,
                "maxTaskRounds": DEFAULT_MAX_TASK_ROUNDS,
                "updatedAt": None,
            }
        return _row_to_settings(row)

    def update_settings(
        self,
        *,
        max_local_computers_per_employee: int | None = None,
        max_task_rounds: int | None = None,
    ) -> dict[str, Any]:
        # Each field is optional so a caller can change one without having to
        # read and resend the other, which would race a concurrent edit.
        current = self.get_settings()
        limit = normalize_max_local_computers(
            current["maxLocalComputersPerEmployee"]
            if max_local_computers_per_employee is None
            else max_local_computers_per_employee
        )
        rounds = normalize_max_task_rounds(
            current["maxTaskRounds"] if max_task_rounds is None else max_task_rounds
        )
        now = datetime.now(timezone.utc)
        with store_transaction(self.engine) as conn:
            existing = conn.scalar(
                select(self.settings.c.id).where(self.settings.c.id == SETTINGS_ROW_ID)
            )
            if existing:
                conn.execute(
                    update(self.settings)
                    .where(self.settings.c.id == SETTINGS_ROW_ID)
                    .values(
                        max_local_computers_per_employee=limit,
                        max_task_rounds=rounds,
                        updated_at=now,
                    )
                )
            else:
                conn.execute(
                    insert(self.settings).values(
                        id=SETTINGS_ROW_ID,
                        max_local_computers_per_employee=limit,
                        max_task_rounds=rounds,
                        created_at=now,
                        updated_at=now,
                    )
                )
        return {
            "maxLocalComputersPerEmployee": limit,
            "maxTaskRounds": rounds,
            "updatedAt": _format_iso(now),
        }


def _row_to_settings(row: Any) -> dict[str, Any]:
    return {
        "maxLocalComputersPerEmployee": int(row["max_local_computers_per_employee"]),
        "maxTaskRounds": int(row["max_task_rounds"]),
        "updatedAt": _format_iso(row["updated_at"]),
    }
