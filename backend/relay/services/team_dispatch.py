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
        team, agents = _task_team_agents(
            task, team_store=team_store, agent_store=agent_store
        )
        return team_member_assignments(agents, team=team)
    assigned_agent_id = task.get("assignedAgentId")
    assigned_agent = task.get("assignedAgent")
    if assigned_agent_id and assigned_agent:
        return [
            {
                "agentId": assigned_agent_id,
                "agent": assigned_agent,
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
    team, agents = _task_team_agents(
        task,
        team_store=team_store,
        agent_store=agent_store,
    )
    return resolve_agent_assignments(
        team_member_assignments(agents, team=team),
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
    agents: list[dict[str, Any]],
    *,
    team: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    snapshot = (
        {
            "teamId": team["id"],
            "teamRevision": team.get("updatedAt") or team.get("createdAt"),
            "memberAgentIds": [agent["id"] for agent in agents],
            "leadAgentId": team.get("leadAgentId"),
        }
        if team
        else None
    )
    return [
        _team_member_assignment(
            agent,
            coordinator=index == 0,
            team_snapshot=snapshot,
        )
        for index, agent in enumerate(agents)
    ]


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
    agent: dict[str, Any],
    *,
    coordinator: bool = False,
    team_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    role = agent.get("defaultRole")
    return {
        "agentId": agent["id"],
        "agent": agent["executorKind"],
        "phase": _member_phase(role),
        **({"role": role} if role else {}),
        **({"coordinator": True} if coordinator else {}),
        "brief": _member_brief(role, coordinator),
        **({"teamSnapshot": team_snapshot} if team_snapshot else {}),
    }


def _member_brief(role: str | None, coordinator: bool) -> str:
    if role == "planner":
        return "Develop the plan, dependencies, risks, and open questions for the shared goal."
    if role == "reviewer":
        return "Review the accumulated workspace changes and synthesize blocking issues and missing tests."
    if role == "tester":
        return "Validate the accumulated implementation with focused tests and report reproducible failures."
    if role == "fixer":
        return "Fix confirmed defects in the accumulated implementation without duplicating completed work."
    if role == "implementer":
        return "Implement the part of the shared goal that fits your role and preserve earlier teammates' work."
    if coordinator:
        return "Coordinate the round, establish clear boundaries, and keep the shared work coherent."
    return "Contribute a distinct part of the shared goal and avoid duplicating completed teammate work."


def _member_phase(role: str | None) -> str:
    if role == "planner":
        return "discussion"
    if role == "reviewer":
        return "review"
    return "execution"
