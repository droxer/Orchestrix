import type { TeamMutationInput } from "../types.js";

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
