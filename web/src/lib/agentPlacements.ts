import type { AgentPlacement } from "../types.js";

export type PlacementOwnership = "managed" | "local" | "pending";
export type PlacementSandbox = "boxlite" | "host" | "pending";
export type PlacementPreference = "preferred" | "alternate";

export interface AgentPlacementDescription {
  placement: AgentPlacement;
  nodeName: string;
  ownership: PlacementOwnership;
  sandbox: PlacementSandbox;
  /** Configured route order. Draining placements do not accept work. */
  preference: PlacementPreference | null;
}

export function describeAgentPlacements(
  placements: AgentPlacement[],
): AgentPlacementDescription[] {
  let activeIndex = 0;
  return placements
    .filter((placement) => placement.desiredState !== "removed")
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
    .map((placement) => ({
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
      preference: placement.desiredState === "active"
        ? activeIndex++ === 0 ? "preferred" : "alternate"
        : null,
    }));
}
