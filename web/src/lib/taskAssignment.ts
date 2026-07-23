import type { AgentTeam, CurrentUser, LogicalAgentAvailability } from "../types.js";

export function teamLeadReady(team: Pick<AgentTeam, "enabled" | "lead">): boolean {
  return teamLeadAvailability(team) === "ready";
}

/** Named Teams dispatch only their configured lead, so roster availability
 *  must never be elevated by a ready supporter. */
export function teamLeadAvailability(
  team: Pick<AgentTeam, "enabled" | "lead">,
): LogicalAgentAvailability {
  if (!team.enabled || !team.lead?.enabled) return "offline";
  return team.lead.availability;
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
