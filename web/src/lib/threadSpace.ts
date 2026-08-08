import type { AgentName, AgentRun, RelayArtifact } from "relay-core";

/** One row of the thread space panel: the artifact plus its derived
 *  producing-agent label (null when the artifact carries no run attribution). */
export type SpaceItem = {
  artifact: RelayArtifact;
  producerLabel: string | null;
};

export const SPACE_WIDTH_DEFAULT = 384;
export const SPACE_WIDTH_MIN = 288;
export const SPACE_WIDTH_MAX = 720;

export function clampSpaceWidth(width: number): number {
  if (typeof width !== "number" || Number.isNaN(width)) return SPACE_WIDTH_DEFAULT;
  return Math.min(SPACE_WIDTH_MAX, Math.max(SPACE_WIDTH_MIN, Math.round(width)));
}

function fallbackExecutorLabel(agent: string): string {
  return agent.charAt(0).toUpperCase() + agent.slice(1);
}

/** Same resolution as labelForAgentRun in ./agentDisplayNames: the run's
 *  logical agent id wins; the per-executor map is the fallback for legacy
 *  runs and dispatches with no logical identity. Duplicated here because this
 *  file is compiled by both the NodeNext test build (explicit extensions)
 *  and the Next bundle (extensionless runtime imports) — a runtime import
 *  between the two lib files satisfies only one of them. Parity is covered
 *  by web/tests/threadSpace.test.ts. */
function producerLabelForRun(
  run: AgentRun,
  logicalAgentNames?: Record<string, string>,
  agentDisplayNames?: Partial<Record<AgentName, string>>,
): string {
  const named = run.logicalAgentId ? logicalAgentNames?.[run.logicalAgentId] : undefined;
  return named ?? agentDisplayNames?.[run.agent] ?? fallbackExecutorLabel(run.agent);
}

/** Map a thread's visible artifacts to panel rows: newest first, with the
 *  producing agent resolved through the run's logical agent id. Legacy runs
 *  carry no logicalAgentId and fall back to the per-executor display name. */
export function buildSpaceItems(
  artifacts: readonly RelayArtifact[],
  agentRuns: readonly AgentRun[] | undefined,
  logicalAgentNames?: Record<string, string>,
  agentDisplayNames?: Partial<Record<AgentName, string>>,
): SpaceItem[] {
  const runsById = new Map((agentRuns ?? []).map((run) => [run.id, run]));
  return artifacts
    .slice()
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "") || b.id.localeCompare(a.id))
    .map((artifact) => {
      const run = artifact.agentRunId ? runsById.get(artifact.agentRunId) : undefined;
      if (!run) return { artifact, producerLabel: null };
      return {
        artifact,
        producerLabel: producerLabelForRun(run, logicalAgentNames, agentDisplayNames),
      };
    });
}

/** The producer column only earns its space when the thread has more than one
 *  logical agent behind its runs. Runs without a logical identity count by
 *  executor kind, the same fallback attribution uses. */
export function threadHasMultipleProducers(agentRuns: readonly AgentRun[] | undefined): boolean {
  const identities = new Set<string>();
  for (const run of agentRuns ?? []) identities.add(run.logicalAgentId ?? run.agent);
  return identities.size > 1;
}

export function isThreadSpaceEmpty(items: readonly SpaceItem[]): boolean {
  return items.length === 0;
}

/** A selected id that no longer matches an item (the session replaced the
 *  artifact) resolves to null, so the panel falls back to the list level. */
export function resolveSelectedSpaceItem(
  items: readonly SpaceItem[],
  selectedId: string | null,
): SpaceItem | null {
  if (!selectedId) return null;
  return items.find((item) => item.artifact.id === selectedId) ?? null;
}
