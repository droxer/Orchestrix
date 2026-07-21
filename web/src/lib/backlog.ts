import type { AgentName, DaemonNodeMonitorRecord, EmployeeAgent, RelayTask, TaskPriority, TaskStatus } from "../types.js";

export const TASK_STATUSES: TaskStatus[] = ["backlog", "assigned", "running", "waiting_for_human", "review", "blocked", "done"];
export const TASK_PRIORITIES: TaskPriority[] = ["high", "normal", "low"];

export interface BacklogFilters {
  query: string;
  status: "all" | TaskStatus;
  priority: "all" | TaskPriority;
  agent: string;
  assignee: string;
  due: "all" | "overdue" | "today" | "unscheduled";
}

export function filterTasks(tasks: RelayTask[], filters: BacklogFilters, today = isoToday()): RelayTask[] {
  const query = filters.query.trim().toLowerCase();
  const assignee = filters.assignee.trim().toLowerCase();
  return tasks.filter((task) => {
    if (task.isRoutine) return false;
    if (filters.status !== "all" && task.status !== filters.status) return false;
    if (filters.priority !== "all" && task.priority !== filters.priority) return false;
    if (filters.agent !== "all" && task.assignedAgentId !== filters.agent) return false;
    if (assignee && !(task.assigneeEmployeeId ?? task.ownerEmployeeId ?? "").toLowerCase().includes(assignee)) return false;
    if (query) {
      const haystack = `${task.title} ${task.description} ${task.id}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (filters.due === "overdue" && (!task.dueDate || task.dueDate >= today || task.status === "done")) return false;
    if (filters.due === "today" && task.dueDate !== today) return false;
    if (filters.due === "unscheduled" && task.dueDate) return false;
    return true;
  }).sort(compareTasks);
}

export function tasksByStatus(tasks: RelayTask[]): Record<TaskStatus, RelayTask[]> {
  return TASK_STATUSES.reduce((acc, status) => {
    acc[status] = tasks.filter((task) => task.status === status);
    return acc;
  }, {} as Record<TaskStatus, RelayTask[]>);
}

// Employee workflows use named logical-agent availability only. Legacy
// executor-only assignments stay visible but cannot be dispatched.
export function agentReadyForTask(
  task: RelayTask,
  _nodes: DaemonNodeMonitorRecord[],
  logicalAgents: EmployeeAgent[] = [],
): boolean {
  if (task.assignedAgentId) {
    return logicalAgents.some(
      (agent) => agent.id === task.assignedAgentId && agent.enabled && agent.availability === "ready",
    );
  }
  return false;
}

export function discussionAgentsForTask(
  _task: RelayTask,
  _nodes: DaemonNodeMonitorRecord[],
  logicalAgents: EmployeeAgent[] = [],
): AgentName[] {
  const readyLogicalAgents = logicalAgents.filter(
    (agent) => agent.enabled && agent.availability === "ready",
  );
  return [...new Set(readyLogicalAgents.map((agent) => agent.executorKind))];
}

export function dueTone(task: RelayTask, today = isoToday()): "neutral" | "warn" | "bad" {
  if (!task.dueDate || task.status === "done") return "neutral";
  if (task.dueDate < today) return "bad";
  if (task.dueDate === today) return "warn";
  return "neutral";
}

export function localDateKey(date = new Date()): string {
  // Local-date key, not UTC — task due dates are entered as calendar days, so
  // toISOString() (UTC) flips "today" a day early/late for users far from UTC.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const isoToday = localDateKey;

function compareTasks(left: RelayTask, right: RelayTask): number {
  return priorityRank(left.priority) - priorityRank(right.priority)
    || (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31")
    || right.updatedAt.localeCompare(left.updatedAt);
}

function priorityRank(priority: TaskPriority): number {
  return { high: 0, normal: 1, low: 2 }[priority] ?? 1;
}
