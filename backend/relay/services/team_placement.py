"""Keep every member of a team on one computer.

Team assembly already refuses members spread across computers, and routing
refuses to run them. Between those two moments an agent can still be moved:
`create_placement` supersedes an agent's prior placement when it is handed a
different node, so a single-agent placement change silently relocates a team
member and splits the team. This module is the seam that closes that window,
and the team-level move that keeps relocation possible once single moves are
refused.
"""

from __future__ import annotations

from typing import Any

from loguru import logger

from ..persistence.agent_placement_store import create_node_placement


class TeamPlacementError(ValueError):
    def __init__(self, code: str, message: str | None = None):
        self.code = code
        super().__init__(message or code)


def assert_teams_stay_colocated(
    team_store: Any,
    placement_store: Any,
    agent: dict[str, Any],
    next_node_id: str | None,
) -> None:
    """Refuse a placement change that would split one of the agent's teams.

    `next_node_id` is the computer the agent would occupy once the change is
    applied, or None when the change unplaces it. Checking the state the change
    would produce — rather than banning moves outright — keeps the two harmless
    cases working: the sole member of a team moves the team with it, and a
    member that had drifted off may always move back onto its team's computer.
    """
    for team in _teams_with_member(team_store, agent):
        node_ids: set[str] = set()
        for member_id in team.get("memberAgentIds") or []:
            member_node_id = (
                next_node_id
                if member_id == agent["id"]
                else active_placement_node_id(placement_store, member_id)
            )
            if not member_node_id:
                raise TeamPlacementError(
                    "team_member_unplaced",
                    f"Team {team['name']} needs every member on a computer.",
                )
            node_ids.add(member_node_id)
        if len(node_ids) > 1:
            raise TeamPlacementError(
                "team_members_different_nodes",
                f"Team {team['name']} must keep every member on one computer.",
            )


def move_team(
    team_store: Any,
    placement_store: Any,
    agent_store: Any,
    team: dict[str, Any],
    node: dict[str, Any],
) -> list[dict[str, Any]]:
    """Relocate every member of a team onto one computer.

    Every member is validated against the target computer before anything is
    written, so a team is never left half-moved. A failure part-way restores the
    placements already superseded.
    """
    members = [agent_store.get_agent(member_id) for member_id in team.get("memberAgentIds") or []]
    if any(not member or member.get("deletedAt") for member in members):
        raise TeamPlacementError(
            "team_invalid", "Team has a member that no longer exists."
        )
    for member in members:
        _assert_executor_available(member, node)
    superseded: list[dict[str, Any]] = []
    moved: list[dict[str, Any]] = []
    try:
        for member in members:
            before = placement_store.list_placements(agent_id=member["id"])
            if any(
                placement["daemonNodeId"] == node["id"] for placement in before
            ):
                continue
            moved.append(create_node_placement(placement_store, member, node))
            superseded.extend(before)
    except Exception:
        _restore(placement_store, superseded, moved, team)
        raise
    return moved


def active_placement_node_id(placement_store: Any, agent_id: str) -> str | None:
    """The one computer an agent occupies, or None when it occupies none."""
    placements = [
        placement
        for placement in placement_store.list_placements(agent_id=agent_id)
        if placement.get("desiredState", "active") == "active"
    ]
    return placements[0]["daemonNodeId"] if len(placements) == 1 else None


def teams_blocking_placement_change(
    team_store: Any, agent: dict[str, Any]
) -> list[dict[str, Any]]:
    """The agent's teams that other agents also belong to."""
    return [
        team
        for team in _teams_with_member(team_store, agent)
        if len(team.get("memberAgentIds") or []) > 1
    ]


def _teams_with_member(team_store: Any, agent: dict[str, Any]) -> list[dict[str, Any]]:
    if team_store is None:
        return []
    try:
        teams = team_store.list_teams(
            owner_employee_id=agent.get("supervisorEmployeeId")
        )
    except Exception as error:
        if "no such table" in str(error) or "does not exist" in str(error):
            return []
        raise
    return [
        team
        for team in teams
        if not team.get("deletedAt") and agent["id"] in (team.get("memberAgentIds") or [])
    ]


def _assert_executor_available(member: dict[str, Any], node: dict[str, Any]) -> None:
    executor_kind = member["executorKind"]
    # A node registers a status for every known executor, so the keys of
    # `agents` say nothing — only the declared support list and a non-unknown
    # status do. Support, not live readiness, is the bar: a placement is a
    # statement of where an agent belongs, and a team may be moved onto a
    # computer whose daemon happens to be down.
    supported = set(node.get("supportedAgents") or []) | {
        kind
        for kind, status in (node.get("agents") or {}).items()
        if status in ("ready", "busy")
    }
    if executor_kind not in supported or executor_kind in set(
        node.get("disabledAgents") or []
    ):
        raise TeamPlacementError(
            "team_member_executor_unavailable",
            f"{member['displayName']} cannot run on the selected computer.",
        )


def _restore(
    placement_store: Any,
    superseded: list[dict[str, Any]],
    moved: list[dict[str, Any]],
    team: dict[str, Any],
) -> None:
    for placement in moved:
        _rollback_step(placement_store, placement["id"], "removed", team)
    for placement in superseded:
        _rollback_step(placement_store, placement["id"], "active", team)


def _rollback_step(
    placement_store: Any, placement_id: str, desired_state: str, team: dict[str, Any]
) -> None:
    try:
        placement_store.update_placement(placement_id, {"desiredState": desired_state})
    except Exception as error:  # the original failure is what the caller must see
        logger.warning(
            "Team move rollback step failed",
            team_id=team.get("id"),
            placement_id=placement_id,
            desired_state=desired_state,
            error=str(error),
        )
