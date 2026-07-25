import type { AgentName, AgentTaskMode, RelaySession } from "../types.js";

export function isAwaitingFeedbackDecision(session: RelaySession | undefined): boolean {
  return session?.status === "waiting_for_human" && session.pendingDecision === "feedback";
}

// A rerun repeats the last turn, so it must target the same *named* agent —
// the executor kind alone would let another agent on that kind pick it up.
export function rerunAssignmentForSession(
  session: RelaySession,
  fallbackAgent: AgentName,
  fallbackMode: AgentTaskMode = "action",
): { agent: AgentName; agentId?: string; mode: AgentTaskMode } {
  const lastRun = session.agentRuns[session.agentRuns.length - 1];
  return {
    agent: lastRun?.agent ?? session.currentAgent ?? fallbackAgent,
    ...(lastRun?.logicalAgentId ? { agentId: lastRun.logicalAgentId } : {}),
    mode: lastRun?.mode ?? fallbackMode,
  };
}
