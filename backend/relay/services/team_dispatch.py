from __future__ import annotations

from typing import Any

from .agent_routing import resolve_agent_assignments


class TeamDispatchError(ValueError):
    def __init__(self, code: str = "team_unavailable"):
        self.code = code
        super().__init__(code)


def task_execution_employee_id(task: dict[str, Any]) -> str:
    employee_id = task.get("assigneeEmployeeId") or task.get("ownerEmployeeId")
    return employee_id if isinstance(employee_id, str) else ""


def task_thread_ownership(
    task: dict[str, Any], *, team_store: Any, agent_store: Any | None = None
) -> dict[str, str]:
    ownership: dict[str, str] = {}
    employee_id = task_execution_employee_id(task)
    if employee_id:
        ownership["owner_employee_id"] = employee_id
    assigned_agent_id = task.get("assignedAgentId")
    if isinstance(assigned_agent_id, str) and assigned_agent_id:
        ownership["owner_agent_id"] = assigned_agent_id
    team_id = task.get("assignedTeamId")
    if isinstance(team_id, str) and team_id:
        ownership["team_id"] = team_id
        team = team_store.get_team(team_id) if team_store else None
        lead_id = team.get("leadAgentId") if team else None
        members = set(team.get("memberAgentIds") or []) if team else set()
        lead = agent_store.get_agent(lead_id) if agent_store and lead_id else None
        if (
            not team
            or team.get("deletedAt")
            or not team.get("enabled", True)
            or not isinstance(lead_id, str)
            or lead_id not in members
            or (agent_store and (not lead or lead.get("deletedAt") or not lead.get("enabled", True)))
        ):
            raise TeamDispatchError()
        ownership["owner_agent_id"] = lead_id
    return ownership


def task_thread_assignments(
    task: dict[str, Any],
    supplied_assignments: list[dict[str, Any]],
    *,
    team_store: Any,
    agent_store: Any,
) -> list[dict[str, Any]]:
    team_id = task.get("assignedTeamId")
    if isinstance(team_id, str) and team_id:
        team = team_store.get_team(team_id) if team_store else None
        lead_id = team.get("leadAgentId") if team else None
        lead = agent_store.get_agent(lead_id) if agent_store and lead_id else None
        if lead and not lead.get("deletedAt") and lead.get("enabled", True):
            return [
                {
                    "agentId": lead["id"],
                    "agent": lead["executorKind"],
                    "mode": "action",
                }
            ]
        return []
    assigned_agent_id = task.get("assignedAgentId")
    assigned_agent = task.get("assignedAgent")
    if assigned_agent_id and assigned_agent:
        return [
            {
                "agentId": assigned_agent_id,
                "agent": assigned_agent,
                "mode": "action",
            }
        ]
    return supplied_assignments


def resolve_team_task_assignment(
    task: dict[str, Any],
    *,
    team_store: Any,
    agent_store: Any,
    placement_store: Any,
    daemon_nodes: list[dict[str, Any]],
) -> dict[str, Any]:
    team_id = task.get("assignedTeamId")
    team = team_store.get_team(team_id) if team_store and team_id else None
    return resolve_team_lead_assignment(
        team,
        employee_id=task_execution_employee_id(task),
        agent_store=agent_store,
        placement_store=placement_store,
        daemon_nodes=daemon_nodes,
    )


def resolve_team_lead_assignment(
    team: dict[str, Any] | None,
    *,
    employee_id: str,
    agent_store: Any,
    placement_store: Any,
    daemon_nodes: list[dict[str, Any]],
) -> dict[str, Any]:
    if (
        not team
        or team.get("deletedAt")
        or not team.get("enabled", True)
        or team.get("ownerEmployeeId") != employee_id
    ):
        raise TeamDispatchError()
    members = list(team.get("memberAgentIds") or [])
    lead = team.get("leadAgentId")
    if not isinstance(lead, str) or lead not in members:
        raise TeamDispatchError()
    agent = agent_store.get_agent(lead)
    if not agent or agent.get("deletedAt") or not agent.get("enabled", True):
        raise TeamDispatchError()
    assignment = {
        "agentId": lead,
        "agent": agent["executorKind"],
        "mode": "action",
    }
    return resolve_agent_assignments(
        [assignment],
        employee_id=employee_id,
        is_admin=False,
        agent_store=agent_store,
        placement_store=placement_store,
        daemon_nodes=daemon_nodes,
    )[0]
