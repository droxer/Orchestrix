import type { RelaySession, RelayTask, TaskRoutineCadence, TaskRoutineType } from "../types.js";

export const TASK_ROUTINE_TYPES: TaskRoutineType[] = ["task", "job"];
export const TASK_ROUTINE_CADENCES: TaskRoutineCadence[] = ["daily", "weekly", "monthly", "custom"];

export interface RoutineFilters {
  query: string;
  type: "all" | TaskRoutineType;
  cadence: "all" | TaskRoutineCadence;
  agent: string;
  assignee: string;
  state: "all" | "enabled" | "disabled" | "due" | "unscheduled";
}

export function filterRoutineTasks(tasks: RelayTask[], filters: RoutineFilters, today = isoToday()): RelayTask[] {
  const query = filters.query.trim().toLowerCase();
  const assignee = filters.assignee.trim().toLowerCase();
  return tasks.filter((task) => {
    if (!task.isRoutine) return false;
    if (filters.type !== "all" && task.routineType !== filters.type) return false;
    if (filters.cadence !== "all" && task.routineCadence !== filters.cadence) return false;
    if (filters.agent !== "all" && task.assignedAgentId !== filters.agent) return false;
    if (assignee && !(task.assigneeEmployeeId ?? task.ownerEmployeeId ?? "").toLowerCase().includes(assignee)) return false;
    if (filters.state === "enabled" && !task.routineEnabled) return false;
    if (filters.state === "disabled" && task.routineEnabled) return false;
    if (filters.state === "due" && routineDueTone(task, today) === "neutral") return false;
    if (filters.state === "unscheduled" && task.routineNextRunDate) return false;
    if (query) {
      const haystack = `${task.title} ${task.description} ${task.id}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }).sort(compareRoutineTasks);
}

/**
 * Routine state is *schedule health*, not backlog lifecycle. A routine
 * definition never moves through the board, so its own `status` field stays
 * at whatever it was created with — surfaces that render it are showing
 * noise. Every routine surface derives state from the three facts that
 * actually vary: is an occurrence executing right now, is the schedule on,
 * and where does the next run date sit relative to today.
 */
export type RoutineState =
  | "running"
  | "overdue"
  | "due"
  | "unscheduled"
  | "scheduled"
  | "paused";

/**
 * Routines whose latest occurrence is still in flight. `running` outranks
 * `paused`: pausing a schedule stops future dispatches, it does not abort the
 * run already underway, and a live run is the more urgent fact to show.
 */
export function routineState(
  routine: RelayTask,
  running: ReadonlySet<string>,
  today = isoToday(),
): RoutineState {
  if (running.has(routine.id)) return "running";
  if (!routine.routineEnabled) return "paused";
  if (!routine.routineNextRunDate) return "unscheduled";
  if (routine.routineNextRunDate < today) return "overdue";
  if (routine.routineNextRunDate === today) return "due";
  return "scheduled";
}

export function routineDueTone(task: RelayTask, today = isoToday()): "neutral" | "warn" | "bad" {
  if (!task.routineEnabled || !task.routineNextRunDate) return "neutral";
  if (task.routineNextRunDate < today) return "bad";
  if (task.routineNextRunDate === today) return "warn";
  return "neutral";
}

export function latestRoutineSession(
  routine: RelayTask,
  tasks: RelayTask[],
  sessions: RelaySession[],
): RelaySession | undefined {
  const occurrenceIds = new Set(routine.occurrenceIds ?? []);
  const occurrences = tasks
    .filter((task) => occurrenceIds.has(task.id) || task.sourceRoutineId === routine.id)
    .sort((left, right) =>
      (left.scheduledFor ?? left.createdAt).localeCompare(
        right.scheduledFor ?? right.createdAt,
      ) || left.createdAt.localeCompare(right.createdAt),
    );
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const linkedIds = [
    ...routine.linkedSessionIds,
    ...occurrences.flatMap((occurrence) => occurrence.linkedSessionIds),
  ];
  return [...linkedIds].reverse().map((id) => sessionById.get(id)).find(Boolean);
}

/**
 * Ids of routines with an occurrence in flight. Derived once per render and
 * passed to `routineState` so a board of N routines stays O(tasks) rather
 * than re-scanning the task list per card.
 */
export function runningRoutineIds(tasks: RelayTask[]): Set<string> {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (task.isRoutine) continue;
    if (!task.sourceRoutineId) continue;
    if (task.status !== "running" && task.status !== "review") continue;
    ids.add(task.sourceRoutineId);
  }
  return ids;
}

export function runningRoutineCount(
  routines: RelayTask[],
  tasks: RelayTask[],
): number {
  const running = runningRoutineIds(tasks);
  return routines.filter((routine) => running.has(routine.id)).length;
}

function compareRoutineTasks(left: RelayTask, right: RelayTask): number {
  return enabledRank(left) - enabledRank(right)
    || routineDate(left).localeCompare(routineDate(right))
    || right.updatedAt.localeCompare(left.updatedAt);
}

function enabledRank(task: RelayTask): number {
  return task.routineEnabled ? 0 : 1;
}

function routineDate(task: RelayTask): string {
  return task.routineNextRunDate ?? "9999-12-31";
}

export function isoToday(date = new Date()): string {
  // Local-date key, not UTC — routine next-run dates are calendar days, so
  // toISOString() (UTC) flips "today" a day early/late for users far from UTC.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
