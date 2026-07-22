import type { AgentTeam, CurrentUser, LogicalAgentAvailability } from "../types.js";

export function teamLeadReady(team: Pick<AgentTeam, "enabled" | "lead">): boolean {
  return Boolean(
    team.enabled
    && team.lead?.enabled
    && team.lead.availability === "ready",
  );
}

/** A team's live status is the most active state among its enabled members:
 *  one busy agent means the team is working; otherwise a ready agent means
 *  it can take work; pending beats offline as "still coming up". */
export function teamAvailability(team: Pick<AgentTeam, "members">): LogicalAgentAvailability {
  const states = team.members
    .filter((member) => member.enabled)
    .map((member) => member.availability);
  if (states.includes("busy")) return "busy";
  if (states.includes("ready")) return "ready";
  if (states.includes("pending")) return "pending";
  return "offline";
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
