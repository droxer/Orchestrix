import type { DaemonNodeMonitorRecord, RelaySession } from "../types.js";

export function findActiveRunForSession(
  node: DaemonNodeMonitorRecord | undefined,
  sessionId: string | undefined,
): DaemonNodeMonitorRecord["activeRuns"][number] | undefined {
  if (!node || !sessionId) return undefined;
  return node.activeRuns.find((run) => run.sessionId === sessionId);
}

/** True when the UI should show the stop control and block new sends. */
export function isConversationRunInFlight(input: {
  activeRun: DaemonNodeMonitorRecord["activeRuns"][number] | undefined;
  session: Pick<RelaySession, "status"> | undefined;
  pendingSend: boolean;
  dispatchingRun: boolean;
}): boolean {
  const { activeRun, session, pendingSend, dispatchingRun } = input;
  if (activeRun || pendingSend || dispatchingRun) return true;
  return session?.status === "running";
}

/** True when cancel should be offered for the open conversation. */
export function canCancelConversationRun(input: {
  activeRun: DaemonNodeMonitorRecord["activeRuns"][number] | undefined;
  session: Pick<RelaySession, "id" | "status"> | undefined;
}): boolean {
  return Boolean(input.activeRun || input.session?.status === "running");
}

export function conversationCancelNodeId(input: {
  node: Pick<DaemonNodeMonitorRecord, "id"> | undefined;
  sandbox: { id: string } | undefined;
}): string | undefined {
  return input.node?.id ?? input.sandbox?.id;
}
