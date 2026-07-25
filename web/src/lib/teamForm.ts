import type { TeamMutationInput } from "../types.js";

type TeamSelectableAgent = {
  id: string;
  placements: ReadonlyArray<{
    daemonNodeId: string;
    desiredState: string;
  }>;
};

export type NodeScopedTeamIssue = "unplaced" | "different-nodes";

export function teamMutationInput(input: {
  name: string;
  leadAgentId: string;
  memberAgentIds: string[];
  enabled: boolean;
}): TeamMutationInput {
  return {
    name: input.name.trim(),
    leadAgentId: input.leadAgentId,
    memberAgentIds: input.memberAgentIds,
    enabled: input.enabled,
  };
}

export function activePlacementNodeId(agent: TeamSelectableAgent): string | null {
  const active = agent.placements.filter((placement) => placement.desiredState === "active");
  return active.length === 1 ? active[0].daemonNodeId : null;
}

export function canAddAgentToNodeScopedTeam(
  candidate: TeamSelectableAgent,
  currentMembers: TeamSelectableAgent[],
): boolean {
  const candidateNodeId = activePlacementNodeId(candidate);
  if (!candidateNodeId) return false;
  const currentNodeIds = currentMembers.map(activePlacementNodeId);
  if (currentNodeIds.some((nodeId) => !nodeId)) return false;
  const memberNodeIds = new Set(currentNodeIds);
  return memberNodeIds.size === 0
    || (memberNodeIds.size === 1 && memberNodeIds.has(candidateNodeId));
}

export function nodeScopedTeamIssue(
  agents: TeamSelectableAgent[],
  memberAgentIds: string[],
): NodeScopedTeamIssue | null {
  const members = agents.filter((agent) => memberAgentIds.includes(agent.id));
  const nodeIds = members.map(activePlacementNodeId);
  if (members.length !== memberAgentIds.length || nodeIds.some((nodeId) => !nodeId)) {
    return "unplaced";
  }
  return new Set(nodeIds).size > 1 ? "different-nodes" : null;
}
