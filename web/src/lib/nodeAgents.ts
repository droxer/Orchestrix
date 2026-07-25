import type { AgentPlacement, EmployeeAgent } from "../types.js";

/**
 * A logical agent hosted on a computer, derived from its non-removed
 * placement on that node. The computer is infrastructure: node surfaces
 * lead with the agents it hosts, not with executor readiness chips.
 */
export interface HostedAgent {
  agent: EmployeeAgent;
  placement: AgentPlacement;
}

/**
 * Status → tone for hosted-agent chips. Kept inline (not imported from
 * agentPlacements) because this module is also built for the node --test
 * runner, whose NodeNext resolution needs the `.js` specifier that Turbopack
 * cannot resolve for a value import. Must stay in sync with
 * `placementStatusTone` in agentPlacements.ts.
 */
export function hostedAgentTone(status: AgentPlacement["status"]): "good" | "info" | "warn" | "bad" | "neutral" {
  if (status === "ready") return "good";
  if (status === "busy") return "info";
  if (status === "pending") return "warn";
  if (status === "failed" || status === "incompatible") return "bad";
  return "neutral";
}

export function hostedAgentsByNode(agents: EmployeeAgent[]): Map<string, HostedAgent[]> {
  const byNode = new Map<string, HostedAgent[]>();
  for (const agent of agents) {
    for (const placement of agent.placements) {
      if (placement.desiredState === "removed") continue;
      const hosted = byNode.get(placement.daemonNodeId) ?? [];
      byNode.set(placement.daemonNodeId, [...hosted, { agent, placement }]);
    }
  }
  return new Map(
    [...byNode.entries()].map(([nodeId, hosted]) => [
      nodeId,
      [...hosted].sort(
        (left, right) =>
          left.agent.displayName.localeCompare(right.agent.displayName)
          || left.placement.id.localeCompare(right.placement.id),
      ),
    ]),
  );
}
