import type { DaemonNodeMonitorRecord, RelaySession } from "../types.js";

export function findActiveRunForSession(
  node: DaemonNodeMonitorRecord | undefined,
  sessionId: string | undefined,
): DaemonNodeMonitorRecord["activeRuns"][number] | undefined {
  if (!node || !sessionId) return undefined;
  return node.activeRuns.find((run) => run.sessionId === sessionId);
}

export function findActiveRunOwnerForSession(
  nodes: DaemonNodeMonitorRecord[],
  sessionId: string | undefined,
): { node: DaemonNodeMonitorRecord; run: DaemonNodeMonitorRecord["activeRuns"][number] } | undefined {
  if (!sessionId) return undefined;
  for (const node of nodes) {
    const run = findActiveRunForSession(node, sessionId);
    if (run) return { node, run };
  }
  return undefined;
}

/** True when the UI should show the stop control and block new sends. */
export function isThreadRunInFlight(input: {
  activeRun: DaemonNodeMonitorRecord["activeRuns"][number] | undefined;
  session: Pick<RelaySession, "status"> | undefined;
  pendingSend: boolean;
  dispatchingRun: boolean;
}): boolean {
  const { activeRun, session, pendingSend, dispatchingRun } = input;
  if (activeRun || pendingSend || dispatchingRun) return true;
  return session?.status === "running";
}

/** True when cancel should be offered for the open thread. */
export function canCancelThreadRun(input: {
  activeRun: DaemonNodeMonitorRecord["activeRuns"][number] | undefined;
  session: Pick<RelaySession, "id" | "status"> | undefined;
}): boolean {
  return Boolean(input.activeRun || input.session?.status === "running");
}

export function threadCancelNodeId(input: {
  node: Pick<DaemonNodeMonitorRecord, "id"> | undefined;
  sandbox: { id: string } | undefined;
}): string | undefined {
  return input.node?.id ?? input.sandbox?.id;
}
