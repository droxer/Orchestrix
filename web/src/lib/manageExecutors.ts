import type { AgentName } from "../types.js";

/**
 * Decide whether the drawer should reload its baseline from `node`.
 *
 * The admin node poll replaces the `node` reference every couple seconds,
 * so we must NOT re-snapshot just because `node.disabledAgents` is a fresh
 * array. We only re-snapshot when the drawer first opens or the user
 * actually targets a different node.
 */
export function shouldSnapshotDisabledAgents(
  open: boolean,
  previousNodeId: string | null,
  currentNodeId: string | null,
): boolean {
  if (!open || !currentNodeId) return false;
  return previousNodeId !== currentNodeId;
}

/** Normalize the payload sent to the backend: sorted, deduped, defensive copy. */
export function normalizeDisabledAgentsPayload(
  disabled: Iterable<AgentName>,
): AgentName[] {
  return [...new Set(disabled)].sort();
}

/** Agents that the user is newly disabling AND are currently reporting ready. */
export function newlyDisabledReadyAgents(
  initialDisabled: Set<AgentName>,
  nextDisabled: Set<AgentName>,
  agentStatuses: Partial<Record<AgentName, string>>,
): AgentName[] {
  return [...nextDisabled].filter(
    (agent) => !initialDisabled.has(agent) && agentStatuses[agent] === "ready",
  );
}

export function disabledSetsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}
