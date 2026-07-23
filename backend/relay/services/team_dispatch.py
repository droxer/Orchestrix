from __future__ import annotations

from typing import Any

from .agent_routing import resolve_agent_assignments

TEAM_UNAVAILABLE_MESSAGE = "The agent team is not currently available."


class TeamDispatchError(ValueError):
    def __init__(self, code: str = "team_unavailable"):
        self.code = code
        super().__init__(code)


def task_execution_employee_id(task: dict[str, Any]) -> str:
    employee_id = task.get("assigneeEmployeeId") or task.get("ownerEmployeeId")
    return employee_id if isinstance(employee_id, str) else ""


def task_thread_ownership(
    task: dict[str, Any], *, team_store: Any, agent_store: Any
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
        team, _agents = _task_team_agents(
            task, team_store=team_store, agent_store=agent_store
        )
        ownership["owner_agent_id"] = team["leadAgentId"]
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
        _team, agents = _task_team_agents(
            task, team_store=team_store, agent_store=agent_store
        )
        return [_team_member_assignment(agent) for agent in agents]
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


def resolve_team_task_assignments(
    task: dict[str, Any],
    *,
    team_store: Any,
    agent_store: Any,
    placement_store: Any,
    daemon_nodes: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    _team, agents = _task_team_agents(
        task,
        team_store=team_store,
        agent_store=agent_store,
    )
    return resolve_agent_assignments(
        [_team_member_assignment(agent) for agent in agents],
        employee_id=task_execution_employee_id(task),
        is_admin=False,
        agent_store=agent_store,
        placement_store=placement_store,
        daemon_nodes=daemon_nodes,
    )


def _task_team_agents(
    task: dict[str, Any],
    *,
    team_store: Any,
    agent_store: Any,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    team_id = task.get("assignedTeamId")
    team = team_store.get_team(team_id) if team_store and team_id else None
    employee_id = task_execution_employee_id(task)
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
    ordered_member_ids = [lead, *(member for member in members if member != lead)]
    agents = [agent_store.get_agent(member) for member in ordered_member_ids]
    if any(
        not agent or agent.get("deletedAt") or not agent.get("enabled", True)
        for agent in agents
    ):
        raise TeamDispatchError()
    return team, agents


def _team_member_assignment(agent: dict[str, Any]) -> dict[str, Any]:
    return {
        "agentId": agent["id"],
        "agent": agent["executorKind"],
        "mode": "action",
        **({"role": agent["defaultRole"]} if agent.get("defaultRole") else {}),
    }
