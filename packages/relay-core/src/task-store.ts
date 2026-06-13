import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { basename, join } from "node:path";

import { DEFAULT_RELAY_DATA_DIR, newRelayId, nowIso } from "./session-store.js";
import type { AgentName } from "./state.js";

export type TaskPriority = "low" | "normal" | "high";
export type TaskStatus = "backlog" | "assigned" | "running" | "waiting_for_human" | "review" | "done" | "blocked";

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
  assignedAgent?: AgentName;
  linkedSessionIds: string[];
  activity: RelayTaskActivity[];
  createdAt: string;
  updatedAt: string;
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
    }
  | {
      id: string;
      type: "task.updated";
      taskId: string;
      timestamp: string;
      title?: string;
      description?: string;
      priority?: TaskPriority;
    }
  | {
      id: string;
      type: "task.assigned";
      taskId: string;
      timestamp: string;
      agent: AgentName;
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
    ownerEmployeeId?: string;
  }): Promise<RelayTask>;
  appendEvent(taskId: string, event: RelayTaskEvent): Promise<RelayTask>;
  getTask(taskId: string): Promise<RelayTask>;
  listTasks(): Promise<RelayTask[]>;
  updateTask(taskId: string, input: { title?: string; description?: string; priority?: TaskPriority; status?: TaskStatus }): Promise<RelayTask>;
  assignTask(taskId: string, agent: AgentName): Promise<RelayTask>;
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
    ownerEmployeeId?: string;
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
      }),
    ];
    if (input.assignedAgent) {
      events.push(relayTaskEvent("task.assigned", taskId, { agent: input.assignedAgent }));
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
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async updateTask(taskId: string, input: { title?: string; description?: string; priority?: TaskPriority; status?: TaskStatus }): Promise<RelayTask> {
    let task = await this.appendEvent(taskId, relayTaskEvent("task.updated", taskId, {
      title: input.title,
      description: input.description,
      priority: input.priority,
    }));
    if (input.status) {
      task = await this.appendEvent(taskId, relayTaskEvent("task.status", taskId, { status: input.status }));
    }
    return task;
  }

  async assignTask(taskId: string, agent: AgentName): Promise<RelayTask> {
    let task = await this.appendEvent(taskId, relayTaskEvent("task.assigned", taskId, { agent }));
    task = await this.appendEvent(taskId, relayTaskEvent("task.status", taskId, { status: "assigned" }));
    return this.recordActivity(taskId, `Assigned to ${agent}.`, { agent });
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
    status: "backlog",
    linkedSessionIds: [],
    activity: [],
    createdAt: created.timestamp,
    updatedAt: created.timestamp,
    events: [],
  };

  for (const event of events) {
    task.events.push(event);
    task.updatedAt = event.timestamp;
    if (event.type === "task.updated") {
      if (event.title !== undefined) task.title = event.title;
      if (event.description !== undefined) task.description = event.description;
      if (event.priority !== undefined) task.priority = event.priority;
    } else if (event.type === "task.assigned") {
      task.assignedAgent = event.agent;
    } else if (event.type === "task.status") {
      task.status = event.status;
    } else if (event.type === "task.session_linked") {
      if (!task.linkedSessionIds.includes(event.sessionId)) task.linkedSessionIds.push(event.sessionId);
    } else if (event.type === "task.activity") {
      task.activity.push(event.activity);
    }
  }
  return task;
}

export function taskPriority(value: unknown): TaskPriority | undefined {
  return value === "low" || value === "normal" || value === "high" ? value : undefined;
}

export function taskStatus(value: unknown): TaskStatus | undefined {
  return value === "backlog" || value === "assigned" || value === "running" || value === "waiting_for_human" || value === "review" || value === "done" || value === "blocked"
    ? value
    : undefined;
}
