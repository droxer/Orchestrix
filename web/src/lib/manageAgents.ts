import type { AgentName, AgentRole } from "../types.js";

export const AGENT_ROLE_VALUES: AgentRole[] = ["planner", "implementer", "reviewer", "tester", "fixer"];
export type AgentRoleMap = Partial<Record<AgentName, AgentRole>>;
export type AgentRoleMapSource = {
  agentRoleDefaults?: AgentRoleMap;
  agentRoleOverrides?: AgentRoleMap;
} | null | undefined;
const AGENT_NAMES_IN_ORDER: AgentName[] = ["claude", "pi", "codex", "kimi"];

/**
 * Decide whether the drawer should reload its baseline from `node`.
 *
 * The admin fleet poll replaces the `node` reference every couple seconds,
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

/** Normalize role maps to known agents/roles and canonical agent order. */
export function normalizeAgentRoleMapPayload(
  roles: AgentRoleMap,
): AgentRoleMap {
  const normalized: AgentRoleMap = {};
  for (const agent of AGENT_NAMES_IN_ORDER) {
    const role = roles[agent];
    if (role && AGENT_ROLE_VALUES.includes(role)) {
      normalized[agent] = role;
    }
  }
  return normalized;
}

/** Effective employee-facing role map: personal override, then system default. */
export function effectiveAgentRoleMap(source: AgentRoleMapSource): AgentRoleMap {
  const defaults = normalizeAgentRoleMapPayload(source?.agentRoleDefaults ?? {});
  const overrides = normalizeAgentRoleMapPayload(source?.agentRoleOverrides ?? {});
  return { ...defaults, ...overrides };
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

export function agentRoleMapsEqual(a: AgentRoleMap, b: AgentRoleMap): boolean {
  const left = normalizeAgentRoleMapPayload(a);
  const right = normalizeAgentRoleMapPayload(b);
  return AGENT_NAMES_IN_ORDER.every((agent) => left[agent] === right[agent]);
}
