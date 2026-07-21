import type { AgentName, CurrentUser, TaskPriority, TaskRoutineCadence, TaskRoutineType, TaskStatus } from "../types.js";

export type TaskBoardFormBase = {
  id?: string;
  title: string;
  description: string;
  priority: TaskPriority;
  assigneeEmployeeId: string;
  assignedAgent: "" | AgentName;
  assignedAgentId?: string;
};

export type BacklogTaskFormState = TaskBoardFormBase & {
  variant: "backlog";
  status: TaskStatus;
  dueDate: string;
};

export type RoutineTaskFormState = TaskBoardFormBase & {
  variant: "routine";
  routineType: TaskRoutineType;
  routineCadence: TaskRoutineCadence;
  routineNextRunDate: string;
  routineEnabled: boolean;
};

export type TaskBoardFormState = BacklogTaskFormState | RoutineTaskFormState;

export function emptyBacklogForm(currentUser: CurrentUser): BacklogTaskFormState {
  return {
    variant: "backlog",
    title: "",
    description: "",
    priority: "normal",
    status: "backlog",
    dueDate: "",
    assigneeEmployeeId: currentUser.employeeId ?? currentUser.username,
    assignedAgent: "",
    assignedAgentId: "",
  };
}

export function emptyRoutineForm(currentUser: CurrentUser, date = new Date()): RoutineTaskFormState {
  return {
    variant: "routine",
    title: "",
    description: "",
    priority: "normal",
    assigneeEmployeeId: currentUser.employeeId ?? currentUser.username,
    assignedAgent: "",
    assignedAgentId: "",
    routineType: "task",
    routineCadence: "weekly",
    routineNextRunDate: nextRoutineRunDate("weekly", date),
    routineEnabled: false,
  };
}

export function nextRoutineRunDate(cadence: TaskRoutineCadence, date = new Date()): string {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (cadence === "custom") return "";
  if (cadence === "daily") next.setDate(next.getDate() + 1);
  else if (cadence === "weekly") next.setDate(next.getDate() + 7);
  else {
    const targetMonth = next.getMonth() + 1;
    const lastDay = new Date(next.getFullYear(), targetMonth + 1, 0).getDate();
    next.setDate(Math.min(next.getDate(), lastDay));
    next.setMonth(targetMonth);
  }
  return localDateKey(next);
}

export function taskBoardFormsEqual(a: TaskBoardFormState, b: TaskBoardFormState): boolean {
  if (a.variant !== b.variant) return false;
  if (
    a.id !== b.id
    || a.title !== b.title
    || a.description !== b.description
    || a.priority !== b.priority
    || a.assigneeEmployeeId !== b.assigneeEmployeeId
    || a.assignedAgent !== b.assignedAgent
    || a.assignedAgentId !== b.assignedAgentId
  ) {
    return false;
  }
  if (a.variant === "backlog" && b.variant === "backlog") {
    return a.status === b.status && a.dueDate === b.dueDate;
  }
  if (a.variant === "routine" && b.variant === "routine") {
    return a.routineType === b.routineType
      && a.routineCadence === b.routineCadence
      && a.routineNextRunDate === b.routineNextRunDate
      && a.routineEnabled === b.routineEnabled;
  }
  return false;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
