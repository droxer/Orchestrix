/**
 * Pure option-derivation helpers for the create-agent form: grouping a
 * employee's daemon nodes into computers, and listing the runtimes actually
 * available on a given computer.
 */

export interface NodeLike {
  id: string;
  employeeId?: string;
  workspaceId?: string;
  managedNodeId?: string;
  supportedAgents?: string[];
  disabledAgents?: string[];
}

export type ComputerOwnership = "local" | "managed";

/** A workspace path is execution metadata, never a user-facing Computer name. */
export function computerName(node: { id: string; displayName?: string }): string {
  return node.displayName?.trim() || node.id;
}

/** Mirrors the backend's core/computer_identity.py computer_id() one-to-one. */
export function computerId(node: NodeLike): string {
  const managed = node.managedNodeId?.trim();
  if (managed) return `managed:${managed}`;
  const employee = node.employeeId?.trim();
  const machine = node.workspaceId?.trim();
  if (employee && machine) return `device:${employee}:${machine}`;
  return `node:${node.id}`;
}

export function computersForEmployee(
  nodes: NodeLike[],
  employeeId: string,
): { computerId: string; ownership: ComputerOwnership; nodes: NodeLike[] }[] {
  const byComputer = new Map<string, NodeLike[]>();
  for (const node of nodes) {
    if (node.employeeId !== employeeId) continue;
    const id = computerId(node);
    byComputer.set(id, [...(byComputer.get(id) ?? []), node]);
  }
  return [...byComputer].map(([id, group]) => ({
    computerId: id,
    ownership: group.some((node) => Boolean(node.managedNodeId?.trim())) ? "managed" : "local",
    nodes: group,
  }));
}

export function runtimesForComputer(nodes: NodeLike[], target: string): string[] {
  const supported = new Set<string>();
  const disabled = new Set<string>();
  for (const node of nodes) {
    if (computerId(node) !== target) continue;
    for (const kind of node.supportedAgents ?? []) supported.add(kind);
    for (const kind of node.disabledAgents ?? []) disabled.add(kind);
  }
  return [...supported].filter((kind) => !disabled.has(kind));
}
