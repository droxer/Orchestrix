import type { AgentPlacement } from "../types.js";

export type PlacementOwnership = "managed" | "local" | "pending";
export type PlacementSandbox = "boxlite" | "host" | "pending";
export type PlacementPreference = "preferred" | "alternate";

export type PlacementStatusTone = "good" | "info" | "warn" | "bad" | "neutral";

export function placementStatusTone(status: AgentPlacement["status"]): PlacementStatusTone {
  if (status === "ready") return "good";
  if (status === "busy") return "info";
  if (status === "pending") return "warn";
  if (status === "failed" || status === "incompatible") return "bad";
  return "neutral";
}

export interface AgentPlacementDescription {
  placement: AgentPlacement;
  nodeName: string;
  ownership: PlacementOwnership;
  sandbox: PlacementSandbox;
  /** Configured route order. Draining placements do not accept work. */
  preference: PlacementPreference | null;
}

export interface PlacementBadgeLabels {
  nodeName: string;
  ownership: string;
  sandboxLabel: string;
  status: string;
}

export function placementBadgeShowsSandbox(
  sandbox: PlacementSandbox,
  requested: boolean,
): boolean {
  return requested && sandbox !== "host";
}

export function placementBadgeDetailLabels(
  labels: PlacementBadgeLabels,
  includeSandbox: boolean,
): string[] {
  return [
    labels.nodeName,
    labels.ownership,
    ...(includeSandbox ? [labels.sandboxLabel] : []),
    labels.status,
  ];
}

export function describeAgentPlacements(
  placements: AgentPlacement[],
): AgentPlacementDescription[] {
  let activeIndex = 0;
  // One computer per row: if an agent ever holds duplicate placements to the
  // same node, keep the highest-priority one (the sort above runs first).
  const seenNodes = new Set<string>();
  return placements
    .filter((placement) => placement.desiredState !== "removed")
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
    .filter((placement) => {
      if (seenNodes.has(placement.daemonNodeId)) return false;
      seenNodes.add(placement.daemonNodeId);
      return true;
    })
    .map((placement) => ({
      placement,
      nodeName: placement.nodeDisplayName || placement.daemonNodeId,
      ownership: placement.nodeOwnership === "managed"
        ? "managed"
        : placement.nodeOwnership === "employee-device"
          ? "local"
          : "pending",
      sandbox: placement.nodeSandboxMode === "boxlite"
        ? "boxlite"
        : placement.nodeSandboxMode === "none"
          ? "host"
          : "pending",
      preference: placement.desiredState === "active"
        ? activeIndex++ === 0 ? "preferred" : "alternate"
        : null,
    }));
}
