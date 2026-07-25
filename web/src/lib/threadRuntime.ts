type ThreadComputer = {
  id: string;
  employeeId?: string;
  online: boolean;
  stale: boolean;
  status: string;
};

type ThreadRuntimeSession = {
  daemonNodeId?: string;
  agentRuns: ReadonlyArray<{ agent: string; daemonNodeId?: string }>;
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
): string | undefined {
  if (session?.daemonNodeId) return session.daemonNodeId;
  return [...(session?.agentRuns ?? [])]
    .reverse()
    .find((run) => run.daemonNodeId)
    ?.daemonNodeId;
}

export function threadNeedsRuntimeSelection(
  session: ThreadRuntimeSession | undefined,
  composingNew: boolean,
): boolean {
  return composingNew || !threadRuntimeNodeId(session);
}
