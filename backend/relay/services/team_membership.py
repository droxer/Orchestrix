from __future__ import annotations

from typing import Any


def remove_agent_from_teams(
    team_store: Any, agent_id: str, owner_employee_id: str
) -> list[dict[str, Any]]:
    updated: list[dict[str, Any]] = []
    for team in team_store.list_teams(
        owner_employee_id=owner_employee_id
    ):
        if agent_id in team.get("memberAgentIds", []):
            updated.append(team_store.remove_member(team["id"], agent_id))
    return updated
