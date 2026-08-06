"""How many personal computers an employee may enroll.

The limit is one number resolved from two places — a per-employee override when
one is pinned, the org-wide default otherwise — and it is enforced at creation
only. Lowering a limit never disconnects a computer that already exists: an
employee over the line keeps working and is simply refused the next one.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from ..persistence.org_settings_store import DEFAULT_MAX_LOCAL_COMPUTERS

EMPLOYEE_DEVICE_LOCATION = "employee-device"


def global_max_local_computers(ctx: Any) -> int:
    settings = ctx.org_settings_store.get_settings()
    value = settings.get("maxLocalComputersPerEmployee")
    return int(value) if value is not None else DEFAULT_MAX_LOCAL_COMPUTERS


def employee_override(ctx: Any, employee_id: str) -> int | None:
    """The employee's pinned limit, or None when they inherit the global.

    The override lives on the employees table, so a file-backed auth store has
    no place to keep one — every employee there inherits.
    """
    if not employee_id or not hasattr(ctx.auth_store, "list_employees"):
        return None
    for employee in ctx.auth_store.list_employees():
        if employee.get("id") == employee_id:
            value = employee.get("maxLocalComputers")
            return int(value) if value is not None else None
    return None


def effective_max_local_computers(ctx: Any, employee_id: str) -> int:
    override = employee_override(ctx, employee_id)
    if override is not None:
        return override
    return global_max_local_computers(ctx)


def count_local_computers(ctx: Any, employee_id: str) -> int:
    if not employee_id:
        return 0
    return ctx.registry.count_employee_device_nodes(employee_id)


def decorate_user_limits(ctx: Any, user: dict[str, Any]) -> dict[str, Any]:
    """Attach the caller's own computer limit and usage to a session user.

    Same resolution rule as `decorate_employee_limits`, but for the signed-in
    user's `/auth/me` payload so self-service surfaces (My Computer) can gate
    their connect action without an admin-only endpoint. A user with no
    employee link cannot enroll a computer, so their payload stays bare.
    """
    employee_id = user.get("employeeId") or ""
    if not employee_id:
        return user
    return {
        **user,
        "maxLocalComputers": employee_override(ctx, employee_id),
        "effectiveMaxLocalComputers": effective_max_local_computers(ctx, employee_id),
        "localComputerCount": count_local_computers(ctx, employee_id),
    }


def decorate_employee_limits(
    ctx: Any, employees: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Attach the resolved limit and current usage to employee records.

    Resolved server-side so a list render never has to know the inheritance
    rule, and so the global is read once for the whole page.
    """
    global_limit = global_max_local_computers(ctx)
    decorated = []
    for employee in employees:
        override = employee.get("maxLocalComputers")
        override = int(override) if override is not None else None
        decorated.append({
            **employee,
            "maxLocalComputers": override,
            "effectiveMaxLocalComputers": (
                override if override is not None else global_limit
            ),
            "localComputerCount": count_local_computers(ctx, employee.get("id", "")),
        })
    return decorated


def assert_local_computer_allowed(ctx: Any, employee_id: str) -> None:
    """Refuse a new personal computer for an employee already at their limit.

    Call this only on a path that would actually create a computer — adopting
    an already-enrolled workspace must stay possible at the limit, or an
    employee could not restart their own daemon.
    """
    limit = effective_max_local_computers(ctx, employee_id)
    current = count_local_computers(ctx, employee_id)
    if current < limit:
        return
    raise HTTPException(
        409,
        f"This employee already has {current} of {limit} allowed personal "
        "computers. Disconnect one, or raise the limit in admin settings.",
    )
