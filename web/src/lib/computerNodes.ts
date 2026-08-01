import type { DaemonNodeMonitorRecord } from "../types.js";

/** Nodes assigned to one employee — what an employee sees on their own computer page. */
export function nodesAssignedToEmployee(
  nodes: DaemonNodeMonitorRecord[],
  employeeId: string | undefined,
): DaemonNodeMonitorRecord[] {
  if (!employeeId) return [];
  return nodes.filter((node) => node.employeeId === employeeId);
}
