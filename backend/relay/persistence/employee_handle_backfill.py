"""The employee-handle backfill plan, computed without writing anything.

Migration `20260831_0065_add_employee_handle` derives a handle for every
existing employee. Which handle a row gets depends on data the migration cannot
be tested against — how many employees share a display name, how many have no
login at all — so the rule lives here and both the migration and
`relay rehearse-employee-handles` read it. Running the command against a copy
of production answers "what will this actually name people?" before the real
run does it for keeps.
"""

from __future__ import annotations

import re
from typing import Any

# Which source the handle came from, worst to best. Anything below `username`
# is a guess, and the report counts them so a bad backfill is visible before it
# is applied rather than after someone notices their name.
HandleSource = str  # "username" | "display_name" | "id_prefix"


def slugify(value: Any) -> str:
    lowered = str(value or "").strip().lower()
    slug = re.sub(r"[^a-z0-9._-]+", "-", lowered).strip("-.")
    slug = re.sub(r"-{2,}", "-", slug)
    return slug[:64] if len(slug) >= 2 else ""


def plan_handles(
    employees: list[dict[str, Any]], usernames: dict[str, str]
) -> list[dict[str, Any]]:
    """One row per employee, in the order the migration walks them.

    `employees` must already be ordered by (created_at, id) — the oldest row
    wins the plain handle, and everyone after it is suffixed rather than
    dropped, because the column is unique and nothing may be lost.
    """
    taken: set[str] = set()
    plan: list[dict[str, Any]] = []
    for employee in employees:
        employee_id = str(employee["id"])
        username_slug = slugify(usernames.get(employee_id))
        display_slug = slugify(employee.get("display_name"))
        if username_slug:
            candidate, source = username_slug, "username"
        elif display_slug:
            candidate, source = display_slug, "display_name"
        else:
            candidate, source = employee_id[:8], "id_prefix"

        handle = candidate
        suffix = 2
        while handle in taken:
            handle = f"{candidate}-{suffix}"
            suffix += 1
        taken.add(handle)
        plan.append(
            {
                "id": employee_id,
                "displayName": employee.get("display_name"),
                "handle": handle,
                "source": source,
                "suffixed": handle != candidate,
            }
        )
    return plan


def summarize(plan: list[dict[str, Any]]) -> dict[str, Any]:
    """The numbers worth reading before applying the migration."""
    return {
        "employees": len(plan),
        "bySource": {
            source: sum(1 for row in plan if row["source"] == source)
            for source in ("username", "display_name", "id_prefix")
        },
        "suffixed": sum(1 for row in plan if row["suffixed"]),
        # A handle nobody would recognize. Small numbers are expected (service
        # accounts); a large one means the backfill is about to rename people
        # to something meaningless and should be corrected first.
        "unrecognizable": [row for row in plan if row["source"] == "id_prefix"],
        "collisions": [row for row in plan if row["suffixed"]],
    }
