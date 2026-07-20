import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { basename, join } from "node:path";

import { DEFAULT_RELAY_DATA_DIR, newRelayId, nowIso } from "./session-store.js";
import type { AgentName } from "./state.js";

export type TaskPriority = "low" | "normal" | "high";
export type TaskStatus = "backlog" | "assigned" | "running" | "waiting_for_human" | "review" | "done" | "blocked";
export type TaskRoutineType = "task" | "job";
export type TaskRoutineCadence = "daily" | "weekly" | "monthly" | "custom";

export interface RelayTaskActivity {
  id: string;
  createdAt: string;
  message: string;
  agent?: AgentName;
  sessionId?: string;
}

export interface RelayTask {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  /** Employee who owns this task; their agent carries it out on their behalf. */
  ownerEmployeeId?: string;
  /** Human assignee responsible for the backlog item. */
  assigneeEmployeeId?: string;
  /** Date-only due date in YYYY-MM-DD format. */
  dueDate?: string;
  isRoutine: boolean;
  routineType?: TaskRoutineType;
  routineCadence?: TaskRoutineCadence;
  /** Date-only next routine run date in YYYY-MM-DD format. */
  routineNextRunDate?: string;
  routineEnabled: boolean;
  assignedAgent?: AgentName;
  assignedAgentId?: string;
  linkedSessionIds: string[];
  activity: RelayTaskActivity[];
  createdAt: string;
  updatedAt: string;
  /** Set when a task.deleted event has been recorded; deleted tasks are hidden from lists. */
  deletedAt?: string;
  events: RelayTaskEvent[];
}

export type RelayTaskEvent =
  | {
      id: string;
      type: "task.created";
      taskId: string;
      timestamp: string;
      title: string;
      description: string;
      priority: TaskPriority;
      ownerEmployeeId?: string;
      assigneeEmployeeId?: string;
      dueDate?: string;
      isRoutine?: boolean;
      routineType?: TaskRoutineType;
      routineCadence?: TaskRoutineCadence;
      routineNextRunDate?: string;
      routineEnabled?: boolean;
    }
  | {
      id: string;
      type: "task.updated";
      taskId: string;
      timestamp: string;
      title?: string;
      description?: string;
      priority?: TaskPriority;
      assigneeEmployeeId?: string;
      dueDate?: string;
      isRoutine?: boolean;
      routineType?: TaskRoutineType;
      routineCadence?: TaskRoutineCadence;
      routineNextRunDate?: string;
      routineEnabled?: boolean;
    }
  | {
      id: string;
      type: "task.assigned";
      taskId: string;
      timestamp: string;
      agent: AgentName;
      agentId?: string;
    }
  | {
      id: string;
      type: "task.status";
      taskId: string;
      timestamp: string;
      status: TaskStatus;
      reason?: string;
    }
  | {
      id: string;
      type: "task.deleted";
      taskId: string;
      timestamp: string;
    }
  | {
      id: string;
      type: "task.session_linked";
      taskId: string;
      timestamp: string;
      sessionId: string;
    }
  | {
      id: string;
      type: "task.activity";
      taskId: string;
      timestamp: string;
      activity: RelayTaskActivity;
    };

export interface TaskStore {
  createTask(input: {
    title: string;
    description?: string;
    priority?: TaskPriority;
    status?: TaskStatus;
    assignedAgent?: AgentName;
    assignedAgentId?: string;
    ownerEmployeeId?: string;
    assigneeEmployeeId?: string;
    dueDate?: string;
    isRoutine?: boolean;
    routineType?: TaskRoutineType;
    routineCadence?: TaskRoutineCadence;
    routineNextRunDate?: string;
    routineEnabled?: boolean;
  }): Promise<RelayTask>;
  appendEvent(taskId: string, event: RelayTaskEvent): Promise<RelayTask>;
  getTask(taskId: string): Promise<RelayTask>;
  listTasks(): Promise<RelayTask[]>;
  deleteTask(taskId: string): Promise<RelayTask>;
  updateTask(taskId: string, input: { title?: string; description?: string; priority?: TaskPriority; status?: TaskStatus; assigneeEmployeeId?: string; dueDate?: string; isRoutine?: boolean; routineType?: TaskRoutineType; routineCadence?: TaskRoutineCadence; routineNextRunDate?: string; routineEnabled?: boolean }): Promise<RelayTask>;
  assignTask(taskId: string, agent: AgentName, agentId?: string): Promise<RelayTask>;
  claimNextTaskForAgent(agent: AgentName, assigneeEmployeeId?: string): Promise<RelayTask | undefined>;
  linkSession(taskId: string, sessionId: string): Promise<RelayTask>;
  recordActivity(taskId: string, message: string, input?: { agent?: AgentName; sessionId?: string }): Promise<RelayTask>;
}

export class LocalTaskStore implements TaskStore {
  private readonly tasksDir: string;

  constructor(private readonly rootDir = DEFAULT_RELAY_DATA_DIR) {
    this.tasksDir = join(this.rootDir, "tasks");
    mkdirSync(this.tasksDir, { recursive: true });
  }

  async createTask(input: {
    title: string;
    description?: string;
    priority?: TaskPriority;
    status?: TaskStatus;
    assignedAgent?: AgentName;
    assignedAgentId?: string;
    ownerEmployeeId?: string;
    assigneeEmployeeId?: string;
    dueDate?: string;
    isRoutine?: boolean;
    routineType?: TaskRoutineType;
    routineCadence?: TaskRoutineCadence;
    routineNextRunDate?: string;
    routineEnabled?: boolean;
  }): Promise<RelayTask> {
    const taskId = newRelayId("task");
    const dir = this.taskDir(taskId);
    mkdirSync(dir, { recursive: true });
    const events: RelayTaskEvent[] = [
      relayTaskEvent("task.created", taskId, {
        title: input.title,
        description: input.description ?? "",
        priority: input.priority ?? "normal",
        ...(input.ownerEmployeeId ? { ownerEmployeeId: input.ownerEmployeeId } : {}),
        ...(input.assigneeEmployeeId ? { assigneeEmployeeId: input.assigneeEmployeeId } : {}),
        ...(input.dueDate ? { dueDate: input.dueDate } : {}),
        ...(input.isRoutine !== undefined ? { isRoutine: input.isRoutine } : {}),
        ...(input.routineType ? { routineType: input.routineType } : {}),
        ...(input.routineCadence ? { routineCadence: input.routineCadence } : {}),
        ...(input.routineNextRunDate ? { routineNextRunDate: input.routineNextRunDate } : {}),
        ...(input.routineEnabled !== undefined ? { routineEnabled: input.routineEnabled } : {}),
      }),
    ];
    if (input.assignedAgent) {
      events.push(relayTaskEvent("task.assigned", taskId, {
        agent: input.assignedAgent,
        ...(input.assignedAgentId ? { agentId: input.assignedAgentId } : {}),
      }));
    }
    if (input.status && input.status !== "backlog") {
      events.push(relayTaskEvent("task.status", taskId, { status: input.status }));
    }
    const task = materializeTaskEvents(events);
    this.writeEvents(taskId, events);
    this.writeSnapshot(taskId, task);
    return task;
  }

  async appendEvent(taskId: string, event: RelayTaskEvent): Promise<RelayTask> {
    mkdirSync(this.taskDir(taskId), { recursive: true });
    appendFileSync(this.eventsPath(taskId), `${JSON.stringify(event)}\n`);
    const task = materializeTaskEvents(this.readEvents(taskId));
    this.writeSnapshot(taskId, task);
    return task;
  }

  async getTask(taskId: string): Promise<RelayTask> {
    const snapshot = this.snapshotPath(taskId);
    if (existsSync(snapshot)) {
      return JSON.parse(readFileSync(snapshot, "utf8")) as RelayTask;
    }
    return materializeTaskEvents(this.readEvents(taskId));
  }

  async listTasks(): Promise<RelayTask[]> {
    if (!existsSync(this.tasksDir)) return [];
    return readdirSync(this.tasksDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.getTaskSync(entry.name))
      .filter((task) => !task.deletedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async deleteTask(taskId: string): Promise<RelayTask> {
    const task = await this.getTask(taskId);
    if (task.deletedAt) return task;
    return this.appendEvent(taskId, relayTaskEvent("task.deleted", taskId, {}));
  }

  async updateTask(taskId: string, input: { title?: string; description?: string; priority?: TaskPriority; status?: TaskStatus; assigneeEmployeeId?: string; dueDate?: string; isRoutine?: boolean; routineType?: TaskRoutineType; routineCadence?: TaskRoutineCadence; routineNextRunDate?: string; routineEnabled?: boolean }): Promise<RelayTask> {
    let task = await this.appendEvent(taskId, relayTaskEvent("task.updated", taskId, {
      title: input.title,
      description: input.description,
      priority: input.priority,
      assigneeEmployeeId: input.assigneeEmployeeId,
      dueDate: input.dueDate,
      isRoutine: input.isRoutine,
      routineType: input.routineType,
      routineCadence: input.routineCadence,
      routineNextRunDate: input.routineNextRunDate,
      routineEnabled: input.routineEnabled,
    }));
    if (input.status) {
      task = await this.appendEvent(taskId, relayTaskEvent("task.status", taskId, { status: input.status }));
    }
    return task;
  }

  async assignTask(taskId: string, agent: AgentName, agentId?: string): Promise<RelayTask> {
    let task = await this.appendEvent(taskId, relayTaskEvent("task.assigned", taskId, {
      agent,
      ...(agentId ? { agentId } : {}),
    }));
    task = await this.appendEvent(taskId, relayTaskEvent("task.status", taskId, { status: "assigned" }));
    return this.recordActivity(taskId, `Assigned to ${agent}.`, { agent });
  }

  async claimNextTaskForAgent(agent: AgentName, assigneeEmployeeId?: string): Promise<RelayTask | undefined> {
    const candidates = (await this.listTasks()).filter((task) =>
      task.status === "assigned"
      && task.assignedAgent === agent
      && (!assigneeEmployeeId || task.assigneeEmployeeId === assigneeEmployeeId || task.ownerEmployeeId === assigneeEmployeeId)
    );
    const task = candidates.sort(taskClaimSortKey)[0];
    if (!task) return undefined;
    await this.appendEvent(task.id, relayTaskEvent("task.status", task.id, { status: "running" }));
    return this.recordActivity(task.id, `Claimed by ${agent}.`, { agent });
  }

  async linkSession(taskId: string, sessionId: string): Promise<RelayTask> {
    const task = await this.appendEvent(taskId, relayTaskEvent("task.session_linked", taskId, { sessionId }));
    return this.recordActivity(task.id, `Linked session ${sessionId}.`, { sessionId });
  }

  async recordActivity(taskId: string, message: string, input: { agent?: AgentName; sessionId?: string } = {}): Promise<RelayTask> {
    return this.appendEvent(taskId, relayTaskEvent("task.activity", taskId, {
      activity: {
        id: newRelayId("act"),
        createdAt: nowIso(),
        message,
        agent: input.agent,
        sessionId: input.sessionId,
      },
    }));
  }

  private writeEvents(taskId: string, events: RelayTaskEvent[]): void {
    writeFileSync(this.eventsPath(taskId), events.map((item) => JSON.stringify(item)).join("\n") + "\n");
  }

  private writeSnapshot(taskId: string, task: RelayTask): void {
    writeFileSync(this.snapshotPath(taskId), `${JSON.stringify(task, null, 2)}\n`);
  }

  private readEvents(taskId: string): RelayTaskEvent[] {
    const path = this.eventsPath(taskId);
    if (!existsSync(path)) throw new Error(`Unknown Relay task ${taskId}.`);
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RelayTaskEvent);
  }

  private getTaskSync(taskId: string): RelayTask {
    const snapshot = this.snapshotPath(taskId);
    if (existsSync(snapshot)) {
      return JSON.parse(readFileSync(snapshot, "utf8")) as RelayTask;
    }
    return materializeTaskEvents(this.readEvents(taskId));
  }

  private taskDir(taskId: string): string {
    return join(this.tasksDir, basename(taskId));
  }

  private eventsPath(taskId: string): string {
    return join(this.taskDir(taskId), "events.jsonl");
  }

  private snapshotPath(taskId: string): string {
    return join(this.taskDir(taskId), "snapshot.json");
  }
}

export function relayTaskEvent<T extends RelayTaskEvent["type"]>(
  type: T,
  taskId: string,
  payload: Omit<Extract<RelayTaskEvent, { type: T }>, "id" | "type" | "taskId" | "timestamp">,
): Extract<RelayTaskEvent, { type: T }> {
  return {
    id: newRelayId("evt"),
    type,
    taskId,
    timestamp: nowIso(),
    ...payload,
  } as Extract<RelayTaskEvent, { type: T }>;
}

export function materializeTaskEvents(events: RelayTaskEvent[]): RelayTask {
  const created = events.find((event): event is Extract<RelayTaskEvent, { type: "task.created" }> => event.type === "task.created");
  if (!created) throw new Error("Relay task event log is missing task.created.");
  const task: RelayTask = {
    id: created.taskId,
    title: created.title,
    description: created.description,
    priority: created.priority,
    ...(created.ownerEmployeeId ? { ownerEmployeeId: created.ownerEmployeeId } : {}),
    ...(created.assigneeEmployeeId ? { assigneeEmployeeId: created.assigneeEmployeeId } : {}),
    ...(created.dueDate ? { dueDate: created.dueDate } : {}),
    status: "backlog",
    isRoutine: Boolean(created.isRoutine),
    routineEnabled: Boolean(created.routineEnabled),
    linkedSessionIds: [],
    activity: [],
    createdAt: created.timestamp,
    updatedAt: created.timestamp,
    events: [],
  };
  applyRoutineFields(task, created);

  for (const event of events) {
    task.events.push(event);
    task.updatedAt = event.timestamp;
    if (event.type === "task.updated") {
      if (event.title !== undefined) task.title = event.title;
      if (event.description !== undefined) task.description = event.description;
      if (event.priority !== undefined) task.priority = event.priority;
      if (event.assigneeEmployeeId !== undefined) {
        if (event.assigneeEmployeeId) task.assigneeEmployeeId = event.assigneeEmployeeId;
        else delete task.assigneeEmployeeId;
      }
      if (event.dueDate !== undefined) {
        if (event.dueDate) task.dueDate = event.dueDate;
        else delete task.dueDate;
      }
      applyRoutineFields(task, event);
    } else if (event.type === "task.assigned") {
      task.assignedAgent = event.agent;
      if (event.agentId) task.assignedAgentId = event.agentId;
      else delete task.assignedAgentId;
    } else if (event.type === "task.status") {
      task.status = event.status;
    } else if (event.type === "task.deleted") {
      task.deletedAt = event.timestamp;
    } else if (event.type === "task.session_linked") {
      if (!task.linkedSessionIds.includes(event.sessionId)) task.linkedSessionIds.push(event.sessionId);
    } else if (event.type === "task.activity") {
      task.activity.push(event.activity);
    }
  }
  return task;
}

function applyRoutineFields(task: RelayTask, event: Partial<Extract<RelayTaskEvent, { type: "task.created" | "task.updated" }>>): void {
  if (event.isRoutine !== undefined) {
    task.isRoutine = event.isRoutine;
    if (!event.isRoutine) {
      task.routineEnabled = false;
      delete task.routineType;
      delete task.routineCadence;
      delete task.routineNextRunDate;
      return;
    }
  }
  if (!task.isRoutine) return;
  if (event.routineEnabled !== undefined) task.routineEnabled = event.routineEnabled;
  if (event.routineType !== undefined) task.routineType = event.routineType;
  if (event.routineCadence !== undefined) task.routineCadence = event.routineCadence;
  if (event.routineNextRunDate !== undefined) {
    if (event.routineNextRunDate) task.routineNextRunDate = event.routineNextRunDate;
    else delete task.routineNextRunDate;
  }
}

function taskClaimSortKey(left: RelayTask, right: RelayTask): number {
  const priorityRank = (task: RelayTask) => ({ high: 0, normal: 1, low: 2 })[task.priority] ?? 1;
  return priorityRank(left) - priorityRank(right)
    || (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31")
    || left.createdAt.localeCompare(right.createdAt);
}

export function taskPriority(value: unknown): TaskPriority | undefined {
  return value === "low" || value === "normal" || value === "high" ? value : undefined;
}

export function taskStatus(value: unknown): TaskStatus | undefined {
  return value === "backlog" || value === "assigned" || value === "running" || value === "waiting_for_human" || value === "review" || value === "done" || value === "blocked"
    ? value
    : undefined;
}

export function taskRoutineType(value: unknown): TaskRoutineType | undefined {
  return value === "task" || value === "job" ? value : undefined;
}

export function taskRoutineCadence(value: unknown): TaskRoutineCadence | undefined {
  return value === "daily" || value === "weekly" || value === "monthly" || value === "custom" ? value : undefined;
}
