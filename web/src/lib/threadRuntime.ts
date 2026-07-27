type ThreadComputer = {
  id: string;
  employeeId?: string;
  online: boolean;
  stale: boolean;
  status: string;
};

type ThreadRuntimeSession = {
  daemonNodeId?: string;
  agentRuns: ReadonlyArray<{ agent: string; daemonNodeId?: string; logicalAgentId?: string }>;
};

type ThreadAgent = {
  id: string;
  placements: ReadonlyArray<{
    daemonNodeId: string;
    desiredState: string;
  }>;
};

export function selectableThreadComputers<T extends ThreadComputer>(
  nodes: readonly T[],
  employeeId: string,
): T[] {
  return nodes.filter(
    (node) => node.employeeId === employeeId
      && node.online
      && !node.stale
      && ["ready", "running", "busy"].includes(node.status),
  );
}

/**
 * Content key for a computer list, covering only what the picker renders and
 * routes on.
 *
 * The node poll runs every few seconds and every response carries fresh
 * `lastSeenAt` / `lastSeenAgeMs` / `activeRuns` values, so a naive
 * `useMemo([nodes])` hands the composer a new array on every tick and
 * re-renders the picker forever. Keying on this signature means a poll that
 * changed nothing the picker can see produces no work at all.
 */
export function threadComputerSignature(
  nodes: readonly (ThreadComputer & { displayName?: string })[],
): string {
  return nodes.map((node) => `${node.id}:${node.displayName ?? ""}`).join("|");
}

/**
 * Which computer a new thread should target, given the previous choice.
 *
 * Returns the previous choice whenever that computer still exists, even if the
 * latest poll reports it unselectable. Staleness is a time threshold the daemon
 * heartbeat crosses and re-crosses, so a node flapping out of the selectable
 * set for one poll used to silently reassign the user's thread to whichever
 * computer happened to sort first. A pick only moves when its computer is gone
 * from the fleet entirely.
 */
export function resolveNewThreadComputer(
  previousId: string | null,
  selectable: readonly ThreadComputer[],
  known: readonly ThreadComputer[],
): string | null {
  if (previousId && known.some((node) => node.id === previousId)) return previousId;
  return selectable[0]?.id ?? null;
}

export function agentsForThreadNode<T extends ThreadAgent>(
  agents: readonly T[],
  daemonNodeId: string | null | undefined,
): T[] {
  if (!daemonNodeId) return [];
  return agents.filter((agent) => agent.placements.some(
    (placement) => placement.daemonNodeId === daemonNodeId
      && placement.desiredState === "active",
  ));
}

export function threadRuntimeNodeId(
  session: ThreadRuntimeSession | undefined,
  agents: readonly ThreadAgent[] = [],
): string | undefined {
  if (session?.daemonNodeId) return session.daemonNodeId;
  const runs = [...(session?.agentRuns ?? [])].reverse();
  const stamped = runs.find((run) => run.daemonNodeId)?.daemonNodeId;
  if (stamped) return stamped;
  // Threads that predate node stamping name no computer anywhere — but the
  // agent that ran still has an active placement, which is where the work
  // happened. Infer the pinned computer from the latest such run.
  for (const run of runs) {
    if (!run.logicalAgentId) continue;
    const agent = agents.find((item) => item.id === run.logicalAgentId);
    const placement = agent?.placements.find((item) => item.desiredState === "active");
    if (placement) return placement.daemonNodeId;
  }
  return undefined;
}

export function threadNeedsRuntimeSelection(
  session: ThreadRuntimeSession | undefined,
  composingNew: boolean,
  agents: readonly ThreadAgent[] = [],
): boolean {
  return composingNew || !threadRuntimeNodeId(session, agents);
}
