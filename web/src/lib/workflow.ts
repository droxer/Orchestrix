import type { AgentName, AgentTaskMode, RelaySession } from "../types.js";

export function isAwaitingFeedbackDecision(session: RelaySession | undefined): boolean {
  return session?.status === "waiting_for_human" && session.pendingDecision === "feedback";
}

export function rerunAssignmentForSession(
  session: RelaySession,
  fallbackAgent: AgentName,
  fallbackMode: AgentTaskMode = "action",
): { agent: AgentName; mode: AgentTaskMode } {
  const lastRun = session.agentRuns[session.agentRuns.length - 1];
  return {
    agent: lastRun?.agent ?? session.currentAgent ?? fallbackAgent,
    mode: lastRun?.mode ?? fallbackMode,
  };
}
