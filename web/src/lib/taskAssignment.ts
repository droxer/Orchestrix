import type { AgentTeam, CurrentUser, LogicalAgentAvailability } from "../types.js";

export function teamReady(team: Pick<AgentTeam, "enabled" | "members">): boolean {
  return teamAvailability(team) === "ready";
}

/** Team dispatch is a lead-first pipeline across the full roster, so every
 *  member must be enabled and ready before the team is dispatchable. */
export function teamAvailability(
  team: Pick<AgentTeam, "enabled" | "members">,
): LogicalAgentAvailability {
  if (!team.enabled || team.members.length === 0) return "offline";
  if (team.members.some((member) => !member.enabled || member.availability === "offline")) {
    return "offline";
  }
  if (team.members.some((member) => member.availability === "pending")) return "pending";
  if (team.members.some((member) => member.availability === "busy")) return "busy";
  return "ready";
}

export function taskAssigneeDisplayName(
  task: {
    assigneeEmployeeId?: string;
    ownerEmployeeId?: string;
    assignedTeamId?: string;
  },
  currentUser: CurrentUser,
): string | undefined {
  const employeeId = task.assigneeEmployeeId ?? task.ownerEmployeeId;
  if (!employeeId) return undefined;
  if (employeeId === currentUser.employeeId || employeeId === currentUser.id) {
    return currentUser.displayName?.trim() || currentUser.username;
  }
  return employeeId;
}
