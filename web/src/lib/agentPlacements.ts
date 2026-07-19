import type { AgentPlacement } from "../types.js";

export type PlacementOwnership = "managed" | "local" | "pending";
export type PlacementSandbox = "boxlite" | "host" | "pending";
export type PlacementRank = "primary" | "fallback";

export interface AgentPlacementDescription {
  placement: AgentPlacement;
  nodeName: string;
  ownership: PlacementOwnership;
  sandbox: PlacementSandbox;
  rank: PlacementRank;
}

export function describeAgentPlacements(
  placements: AgentPlacement[],
): AgentPlacementDescription[] {
  return placements
    .filter((placement) => placement.desiredState !== "removed")
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
    .map((placement, index) => ({
      placement,
      nodeName: placement.nodeDisplayName || placement.daemonNodeId,
      ownership: placement.nodeOwnership === "managed"
        ? "managed"
        : placement.nodeOwnership === "user-run"
          ? "local"
          : "pending",
      sandbox: placement.nodeSandboxMode === "boxlite"
        ? "boxlite"
        : placement.nodeSandboxMode === "none"
          ? "host"
          : "pending",
      rank: index === 0 ? "primary" : "fallback",
    }));
}
