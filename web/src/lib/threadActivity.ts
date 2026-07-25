import type { AgentName, SessionStatus } from "../types.js";

// The kind of a thread row's one-line activity signal. Maps to a leading
// indicator (a slate pulse for a live run, a status pip otherwise) and, for
// the settled states, whether the line reads muted.
export type ThreadActivityKind = "working" | "warn" | "bad" | "good" | "neutral";

export type ThreadActivity = {
  kind: ThreadActivityKind;
  /** i18n key for the label. For "working" the caller interpolates the agent. */
  labelKey: string;
} | null;

// Pure derivation of a row's activity signal from its session status and any
// in-flight agent. A running agent always wins (the live pulse); settled
// statuses map to a status word; states with nothing worth a second line
// return null so the row stays a single title row.
export function threadActivity(
  status: SessionStatus,
  runningAgent: AgentName | undefined,
): ThreadActivity {
  if (runningAgent) {
    return { kind: "working", labelKey: "thread.agent_working" };
  }
  switch (status) {
    case "waiting_for_human":
      return { kind: "warn", labelKey: "thread.statuses.waiting_for_human" };
    case "failed":
      return { kind: "bad", labelKey: "status.failed" };
    case "completed":
      return { kind: "good", labelKey: "status.completed" };
    case "cancelled":
      return { kind: "neutral", labelKey: "status.cancelled" };
    default:
      return null;
  }
}
