import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { basename, join } from "node:path";

import { DEFAULT_RELAY_DATA_DIR, newRelayId, nowIso } from "./session.js";
import type { AgentName } from "relay-core";

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
  }): RelayTask;
  appendEvent(taskId: string, event: RelayTaskEvent): RelayTask;
  getTask(taskId: string): RelayTask;
  listTasks(): RelayTask[];
  updateTask(taskId: string, input: { title?: string; description?: string; priority?: TaskPriority; status?: TaskStatus }): RelayTask;
  assignTask(taskId: string, agent: AgentName): RelayTask;
  linkSession(taskId: string, sessionId: string): RelayTask;
  recordActivity(taskId: string, message: string, input?: { agent?: AgentName; sessionId?: string }): RelayTask;
}

export class LocalTaskStore implements TaskStore {
  private readonly tasksDir: string;

  constructor(private readonly rootDir = DEFAULT_RELAY_DATA_DIR) {
    this.tasksDir = join(this.rootDir, "tasks");
    mkdirSync(this.tasksDir, { recursive: true });
  }

  createTask(input: {
    title: string;
    description?: string;
    priority?: TaskPriority;
    status?: TaskStatus;
    assignedAgent?: AgentName;
  }): RelayTask {
    const taskId = newRelayId("task");
    const dir = this.taskDir(taskId);
    mkdirSync(dir, { recursive: true });
    const events: RelayTaskEvent[] = [
      relayTaskEvent("task.created", taskId, {
        title: input.title,
        description: input.description ?? "",
        priority: input.priority ?? "normal",
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

  appendEvent(taskId: string, event: RelayTaskEvent): RelayTask {
    mkdirSync(this.taskDir(taskId), { recursive: true });
    appendFileSync(this.eventsPath(taskId), `${JSON.stringify(event)}\n`);
    const task = materializeTaskEvents(this.readEvents(taskId));
    this.writeSnapshot(taskId, task);
    return task;
  }

  getTask(taskId: string): RelayTask {
    const snapshot = this.snapshotPath(taskId);
    if (existsSync(snapshot)) {
      return JSON.parse(readFileSync(snapshot, "utf8")) as RelayTask;
    }
    return materializeTaskEvents(this.readEvents(taskId));
  }

  listTasks(): RelayTask[] {
    if (!existsSync(this.tasksDir)) return [];
    return readdirSync(this.tasksDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.getTask(entry.name))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  updateTask(taskId: string, input: { title?: string; description?: string; priority?: TaskPriority; status?: TaskStatus }): RelayTask {
    let task = this.appendEvent(taskId, relayTaskEvent("task.updated", taskId, {
      title: input.title,
      description: input.description,
      priority: input.priority,
    }));
    if (input.status) {
      task = this.appendEvent(taskId, relayTaskEvent("task.status", taskId, { status: input.status }));
    }
    return task;
  }

  assignTask(taskId: string, agent: AgentName): RelayTask {
    let task = this.appendEvent(taskId, relayTaskEvent("task.assigned", taskId, { agent }));
    task = this.appendEvent(taskId, relayTaskEvent("task.status", taskId, { status: "assigned" }));
    return this.recordActivity(taskId, `Assigned to ${agent}.`, { agent });
  }

  linkSession(taskId: string, sessionId: string): RelayTask {
    const task = this.appendEvent(taskId, relayTaskEvent("task.session_linked", taskId, { sessionId }));
    return this.recordActivity(task.id, `Linked session ${sessionId}.`, { sessionId });
  }

  recordActivity(taskId: string, message: string, input: { agent?: AgentName; sessionId?: string } = {}): RelayTask {
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
