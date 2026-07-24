import type { ManagedNodeRecord } from "../types.js";

export function managedNodeHistory(nodes: ManagedNodeRecord[]): ManagedNodeRecord[] {
  return nodes
    .filter((node) => node.desiredState === "deleted" && node.phase === "deleted")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
