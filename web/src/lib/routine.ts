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
