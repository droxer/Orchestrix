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

/** An employee agent must be active as well as backed by a routable placement. */
export function isEmployeeAgentRoutable(agent: EmployeeAgent): boolean {
  return agent.enabled && !agent.deletedAt && isLogicalAgentRoutable(agent.availability);
}

/** Keep the current selection when possible, otherwise choose the first agent
 * that can actually accept work. Never fall back to an unavailable agent. */
export function preferredRoutableAgent(
  logicalAgents: readonly EmployeeAgent[],
  preferredAgentId: string | null,
): EmployeeAgent | undefined {
  return logicalAgents.find(
    (agent) => agent.id === preferredAgentId && isEmployeeAgentRoutable(agent),
  ) ?? logicalAgents.find(isEmployeeAgentRoutable);
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

/** Display name per logical agent id — the only way to tell two named agents
 * that share an executor kind apart. */
export function buildLogicalAgentNameMap(
  logicalAgents: readonly EmployeeAgent[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const agent of logicalAgents) {
    map[agent.id] = agent.displayName;
  }
  return map;
}

/** Name the agent behind one run. The run's logical agent id wins; the
 * per-executor map is the fallback for runs that carry no logical identity
 * (legacy sessions or workflow dispatches) or whose agent no longer exists. */
export function labelForAgentRun(
  run: { agent: AgentName; agentId?: string },
  logicalAgentNames?: Record<string, string>,
  agentDisplayNames?: Partial<Record<AgentName, string>>,
): string {
  const named = run.agentId ? logicalAgentNames?.[run.agentId] : undefined;
  return named ?? labelForExecutor(run.agent, agentDisplayNames);
}
