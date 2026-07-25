import type { AgentName, EmployeeAgent, LogicalAgentAvailability } from "../types.js";

function fallbackExecutorLabel(agent: AgentName): string {
  return agent.charAt(0).toUpperCase() + agent.slice(1);
}

/** Matches backend agent routing: ready and busy placements can take work. */
export function isLogicalAgentRoutable(
  availability: LogicalAgentAvailability,
): boolean {
  return availability === "ready" || availability === "busy";
}

function routableScore(agent: EmployeeAgent): number {
  if (agent.availability === "ready") return 0;
  if (agent.availability === "busy") return 1;
  return 2;
}

/** Resolve the employee-configured label for an executor kind. */
export function displayNameForExecutor(
  executorKind: AgentName | undefined,
  logicalAgents: readonly EmployeeAgent[],
): string {
  if (!executorKind) return "";
  const map = buildExecutorDisplayNameMap(logicalAgents);
  return map[executorKind] ?? fallbackExecutorLabel(executorKind);
}

/** One display name per executor kind, preferring routable logical agents. */
export function buildExecutorDisplayNameMap(
  logicalAgents: readonly EmployeeAgent[],
): Partial<Record<AgentName, string>> {
  const map: Partial<Record<AgentName, string>> = {};
  const sorted = [...logicalAgents]
    .filter((agent) => !agent.deletedAt)
    .sort((left, right) => {
      return routableScore(left) - routableScore(right)
        || left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" });
    });
  for (const agent of sorted) {
    if (!map[agent.executorKind]) {
      map[agent.executorKind] = agent.displayName;
    }
  }
  return map;
}

export function labelForExecutor(
  executorKind: AgentName,
  agentDisplayNames?: Partial<Record<AgentName, string>>,
): string {
  return agentDisplayNames?.[executorKind] ?? fallbackExecutorLabel(executorKind);
}
