import type { AgentTeam, CurrentUser, LogicalAgentAvailability } from "../types.js";

export function assignmentOptionVisible(
  ownerEmployeeId: string | undefined,
  assigneeEmployeeId: string,
  selected: boolean,
): boolean {
  if (selected) return true;
  if (!assigneeEmployeeId) return true;
  return ownerEmployeeId === assigneeEmployeeId;
}

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

/** Human label for a task's assignee. `employeeNames` is the resolved employee
 *  directory (see useEmployeeNames); without it, everyone but the viewer falls
 *  back to the raw employee id, which is what the Assignee column used to show. */
export function taskAssigneeDisplayName(
  task: {
    assigneeEmployeeId?: string;
    ownerEmployeeId?: string;
    assignedTeamId?: string;
  },
  currentUser: CurrentUser,
  employeeNames?: ReadonlyMap<string, string>,
): string | undefined {
  const employeeId = task.assigneeEmployeeId ?? task.ownerEmployeeId;
  if (!employeeId) return undefined;
  if (employeeId === currentUser.employeeId || employeeId === currentUser.id) {
    return currentUser.displayName?.trim() || currentUser.username;
  }
  return employeeNames?.get(employeeId) ?? employeeId;
}

/** True when the task's owning employee is the viewer. Personal views
 *  (backlog/routine) suppress the redundant self chip and let the executor
 *  glyph stand in as the assignee. */
export function isTaskAssigneeCurrentUser(
  task: { assigneeEmployeeId?: string; ownerEmployeeId?: string },
  currentUser: CurrentUser,
): boolean {
  const employeeId = task.assigneeEmployeeId ?? task.ownerEmployeeId;
  if (!employeeId) return false;
  return employeeId === currentUser.employeeId || employeeId === currentUser.id;
}
