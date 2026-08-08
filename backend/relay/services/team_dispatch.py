from __future__ import annotations

from typing import Any

from .agent_routing import resolve_agent_assignments

TEAM_UNAVAILABLE_MESSAGE = "The agent team is not currently available."


class TeamDispatchError(ValueError):
    def __init__(
        self,
        code: str = "team_unavailable",
        *,
        permanent: bool = False,
    ):
        self.code = code
        self.permanent = permanent
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
    mode: str = "action",
) -> list[dict[str, Any]]:
    _team, agents = _task_team_agents(
        task,
        team_store=team_store,
        agent_store=agent_store,
    )
    return resolve_agent_assignments(
        team_member_assignments(agents, mode=mode),
        employee_id=task_execution_employee_id(task),
        is_admin=False,
        agent_store=agent_store,
        placement_store=placement_store,
        daemon_nodes=daemon_nodes,
    )


def team_agents(
    team_id: str,
    employee_id: str,
    *,
    team_store: Any,
    agent_store: Any,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Resolve a team to its ordered, dispatchable members. Lead first.

    The single validation point for "can this team run work right now",
    shared by task dispatch and by thread continuation.
    """
    team = team_store.get_team(team_id) if team_store and team_id else None
    if not team or team.get("deletedAt"):
        raise TeamDispatchError("team_not_found", permanent=True)
    if not team.get("enabled", True):
        raise TeamDispatchError("team_disabled", permanent=True)
    if team.get("ownerEmployeeId") != employee_id:
        raise TeamDispatchError("team_forbidden", permanent=True)
    members = list(team.get("memberAgentIds") or [])
    lead = team.get("leadAgentId")
    if not isinstance(lead, str) or lead not in members:
        raise TeamDispatchError("team_invalid", permanent=True)
    ordered_member_ids = [lead, *(member for member in members if member != lead)]
    agents = [agent_store.get_agent(member) for member in ordered_member_ids]
    if any(not agent or agent.get("deletedAt") for agent in agents):
        raise TeamDispatchError("team_invalid", permanent=True)
    if any(not agent.get("enabled", True) for agent in agents):
        raise TeamDispatchError("team_disabled", permanent=True)
    return team, agents


def team_member_assignments(
    agents: list[dict[str, Any]], *, mode: str = "action"
) -> list[dict[str, Any]]:
    return [_team_member_assignment(agent, mode=mode) for agent in agents]


def _task_team_agents(
    task: dict[str, Any],
    *,
    team_store: Any,
    agent_store: Any,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    return team_agents(
        task.get("assignedTeamId") or "",
        task_execution_employee_id(task),
        team_store=team_store,
        agent_store=agent_store,
    )


def _team_member_assignment(
    agent: dict[str, Any], *, mode: str = "action"
) -> dict[str, Any]:
    role = agent.get("defaultRole")
    return {
        "agentId": agent["id"],
        "agent": agent["executorKind"],
        "mode": _member_mode(role, mode),
        **({"role": role} if role else {}),
    }


def _member_mode(role: str | None, requested_mode: str) -> str:
    """Pick the mode a member runs in, given its role and what was asked for.

    Only a plain "do the work" request is specialized: a reviewer asked to act
    reviews instead. An explicit review or ask request already describes the
    whole round, so every member honors it as given.
    """
    if requested_mode == "action" and role == "reviewer":
        return "review"
    return requested_mode
