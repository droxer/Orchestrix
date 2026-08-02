import type { RelayTask, RelayTaskSummary } from "../types.js";

/** Convert a full mutation response to the compact shape owned by the list cache. */
export function taskSummaryFromTask(task: RelayTask): RelayTaskSummary {
  const { events, activity, ...fields } = task;
  return {
    ...fields,
    eventCount: events.length,
    activityCount: activity.length,
    ...(activity.length > 0 ? { lastActivity: activity.at(-1) } : {}),
  };
}

/** Merge a mutation projection without allowing an out-of-order response to regress it. */
export function mergeTaskSummaryIntoTasks(
  tasks: RelayTaskSummary[],
  summary: RelayTaskSummary,
): RelayTaskSummary[] {
  const existing = tasks.find((candidate) => candidate.id === summary.id);
  if (!existing) return [summary, ...tasks];
  if (
    summary.eventCount < existing.eventCount
    || (summary.eventCount === existing.eventCount && summary.updatedAt < existing.updatedAt)
  ) {
    return tasks;
  }
  return tasks.map((candidate) => candidate.id === summary.id ? summary : candidate);
}
