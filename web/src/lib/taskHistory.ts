import type { RelayTaskEvent, TaskStatus } from "../types.js";

/**
 * One readable line of a task's run history.
 *
 * The event log is the authoritative record of what happened to a task, but it
 * carries bookkeeping (dispatch claims, edits) that says nothing about a run.
 * This projection keeps the entries a person can act on and leaves the wording
 * to the component — the lib stays pure so it can be tested without i18n.
 */
export type TaskHistoryEntry = {
  /** The event id — stable across refetches, so it keys the list. */
  id: string;
  timestamp: string;
  kind: TaskHistoryKind;
  /** Task the event belongs to: the record itself, or one of its occurrences. */
  taskId: string;
  /** True when this line came from a routine occurrence rather than the routine. */
  fromOccurrence: boolean;
  /** Thread this line points at, when the event names one. */
  sessionId?: string;
  status?: TaskStatus;
  message?: string;
};

export type TaskHistoryKind =
  | "created"
  | "assigned"
  | "unassigned"
  | "status"
  | "session_linked"
  | "session_unlinked"
  | "occurrence"
  | "dispatch_started"
  | "dispatch_queued"
  | "dispatch_rejected"
  | "activity";

/** Newest-first cap. A long-lived routine accumulates hundreds of events. */
export const TASK_HISTORY_LIMIT = 25;

function entryFor(event: RelayTaskEvent, ownerTaskId: string): TaskHistoryEntry | undefined {
  const base = {
    id: event.id,
    timestamp: event.timestamp,
    taskId: event.taskId,
    fromOccurrence: event.taskId !== ownerTaskId,
  };
  switch (event.type) {
    case "task.created":
      return { ...base, kind: "created" };
    case "task.assigned":
      return { ...base, kind: "assigned" };
    case "task.unassigned":
      return { ...base, kind: "unassigned" };
    case "task.status":
      return { ...base, kind: "status", status: event.status, message: event.reason };
    case "task.session_linked":
      return { ...base, kind: "session_linked", sessionId: event.sessionId };
    case "task.session_unlinked":
      return { ...base, kind: "session_unlinked", sessionId: event.sessionId };
    case "task.occurrence_created":
      return { ...base, kind: "occurrence", taskId: event.occurrenceId, fromOccurrence: false };
    case "task.dispatch_outcome":
      return {
        ...base,
        kind: `dispatch_${event.outcome.state}` as TaskHistoryKind,
        message: event.outcome.message ?? event.outcome.code,
      };
    case "task.activity":
      return {
        ...base,
        kind: "activity",
        message: event.activity.message,
        ...(event.activity.sessionId ? { sessionId: event.activity.sessionId } : {}),
      };
    default:
      // Edits and dispatch claim/release churn are not run history.
      return undefined;
  }
}

/**
 * Newest-first history for a task, optionally including its occurrences'
 * events (a routine never runs itself — its runs happen in occurrences).
 */
export function taskHistoryEntries(
  events: RelayTaskEvent[],
  ownerTaskId: string,
  limit = TASK_HISTORY_LIMIT,
): TaskHistoryEntry[] {
  const entries: TaskHistoryEntry[] = [];
  for (const event of events) {
    const entry = entryFor(event, ownerTaskId);
    if (entry) entries.push(entry);
  }
  return entries
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp) || right.id.localeCompare(left.id))
    .slice(0, limit);
}
