import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  LocalSessionStore,
  relayEvent,
  type AgentRole,
  type HumanDecisionKind,
  type RelayArtifact,
  type SessionStore,
} from "./session.js";
import {
  LocalTaskStore,
  relayTaskEvent,
  taskPriority,
  taskStatus,
  type TaskStore,
} from "./task.js";
import { SessionController, type WorkflowStep } from "./controller.js";
import { createPostgresStoreSet } from "./postgres-store.js";
import type { AgentName, CodexTaskMode } from "relay-core";

const MAX_BODY_BYTES = 10 * 1024 * 1024;

export interface RelayServerOptions {
  port?: number;
  host?: string;
  store?: SessionStore;
  taskStore?: TaskStore;
}

export interface RelayApiResponse {
  status: number;
  contentType: string;
  body: string;
  sse?: boolean;
}

export async function serveRelay(options: RelayServerOptions = {}): Promise<void> {
  const defaults = !options.store && !options.taskStore ? createPostgresStoreSet() : undefined;
  const store = options.store ?? defaults?.sessionStore ?? new LocalSessionStore();
  const taskStore = options.taskStore ?? defaults?.taskStore ?? new LocalTaskStore();
  if (defaults) await defaults.storage.ready;
  const port = options.port ?? 8787;
  const host = options.host ?? "127.0.0.1";
  const server = createServer((request, response) => {
    void routeRequest(store, taskStore, request, response).catch((error: unknown) => {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
  server.listen(port, host, () => {
    console.log(`Relay API listening on http://${host}:${port}`);
  });
}

export async function routeRequest(store: SessionStore, taskStore: TaskStore, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://relay.local");
  const body = method === "GET" ? undefined : await readJsonBody(request);
  const routed = await handleRelayApiRequest(store, taskStore, method, url.pathname, body);
  response.writeHead(routed.status, {
    "Content-Type": routed.contentType,
    ...(routed.sse
      ? {
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        }
      : {}),
  });
  response.end(routed.body);
}

export async function handleRelayApiRequest(
  store: SessionStore,
  taskStore: TaskStore,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<RelayApiResponse> {
  const parts = pathname.split("/").filter(Boolean);
  if (method === "GET" && parts.length === 0) {
    return apiRootResponse();
  }
  if (method === "GET" && parts.length === 1 && parts[0] === "tasks") {
    return jsonResponse(200, { tasks: await taskStore.listTasks() });
  }
  if (method === "POST" && parts.length === 1 && parts[0] === "tasks") {
    return createTaskResponse(store, taskStore, body);
  }
  if (method === "GET" && parts.length === 2 && parts[0] === "tasks") {
    return jsonResponse(200, await taskStore.getTask(parts[1]));
  }
  if (method === "PATCH" && parts.length === 2 && parts[0] === "tasks") {
    return updateTaskResponse(taskStore, parts[1], body);
  }
  if (method === "POST" && parts.length === 3 && parts[0] === "tasks" && parts[2] === "assign") {
    return assignTaskResponse(taskStore, parts[1], body);
  }
  if (method === "POST" && parts.length === 3 && parts[0] === "tasks" && parts[2] === "pickup") {
    return pickupTaskResponse(store, taskStore, parts[1], body);
  }
  if (method === "GET" && parts.length === 3 && parts[0] === "tasks" && parts[2] === "events") {
    return jsonResponse(200, { events: (await taskStore.getTask(parts[1])).events });
  }
  if (method === "GET" && parts.length === 1 && parts[0] === "sessions") {
    return jsonResponse(200, { sessions: await store.listSessions() });
  }
  if (method === "POST" && parts.length === 1 && parts[0] === "sessions") {
    return createSessionResponse(store, taskStore, body);
  }
  if (method === "GET" && parts.length === 2 && parts[0] === "sessions") {
    return jsonResponse(200, await store.getSession(parts[1]));
  }
  if (method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "assignments") {
    return assignSessionResponse(store, taskStore, parts[1], body);
  }
  if (method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "decisions") {
    return decisionResponse(store, taskStore, parts[1], body);
  }
  if (method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "handoffs") {
    return handoffResponse(store, taskStore, parts[1], body);
  }
  if (method === "GET" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "events") {
    return sseEventsResponse(store, parts[1]);
  }
  if (method === "GET" && parts.length === 4 && parts[0] === "sessions" && parts[2] === "artifacts") {
    return { status: 200, contentType: "text/plain; charset=utf-8", body: await store.readArtifact(parts[1], parts[3]) };
  }
  return jsonResponse(404, { error: "Not found" });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let raw = "";
  let bytes = 0;
  for await (const chunk of request) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > MAX_BODY_BYTES) {
      throw new Error("Request body exceeds 10 MB limit.");
    }
    raw += String(chunk);
  }
  if (!raw.trim()) return undefined;
  return JSON.parse(raw);
}

interface AssignmentInput {
  agent: AgentName;
  role?: AgentRole;
  mode?: CodexTaskMode;
}

async function createTaskResponse(store: SessionStore, taskStore: TaskStore, body: unknown): Promise<RelayApiResponse> {
  const input = asRecord(body);
  const title = stringField(input, "title") || stringField(input, "taskGoal");
  if (!title) return jsonResponse(400, { error: "title is required." });
  let task = await taskStore.createTask({
    title,
    description: stringField(input, "description"),
    priority: taskPriority(input.priority) ?? "normal",
  });
  const agent = agentName(input.assignedAgent);
  if (agent) {
    task = await taskStore.assignTask(task.id, agent);
  }
  if (input.createSession === true || Array.isArray(input.assignments)) {
    const workspacePath = stringField(input, "workspacePath") || "/workspace";
    const controller = new SessionController(store, { taskStore, taskId: task.id, workspacePath });
    const session = await controller.createSession(
      task.description ? `${task.title}\n\n${task.description}` : task.title,
      [...new Set(["human", ...(Array.isArray(input.assignments) ? input.assignments.map((item: unknown) => agentName(asRecord(item).agent)) : agent ? [agent] : []).filter(Boolean)])] as string[],
      true,
    );
    const assignments = assignmentList(input.assignments);
    if (assignments.length > 0) {
      await controller.assignSession(session.id, assignments);
    }
    task = await taskStore.linkSession(task.id, session.id);
  }
  return jsonResponse(201, task);
}

async function updateTaskResponse(taskStore: TaskStore, taskId: string, body: unknown): Promise<RelayApiResponse> {
  const input = asRecord(body);
  const title = stringField(input, "title");
  const description = typeof input.description === "string" ? input.description : undefined;
  const priority = taskPriority(input.priority);
  const status = taskStatus(input.status);
  if (!title && description === undefined && !priority && !status) {
    return jsonResponse(400, { error: "PATCH requires title, description, priority, or status." });
  }
  const task = await taskStore.updateTask(taskId, {
    title: title || undefined,
    description,
    priority,
    status,
  });
  return jsonResponse(200, task);
}

async function assignTaskResponse(taskStore: TaskStore, taskId: string, body: unknown): Promise<RelayApiResponse> {
  const input = asRecord(body);
  const agent = agentName(input.agent);
  if (!agent) return jsonResponse(400, { error: "agent must be claude, pi, or codex." });
  return jsonResponse(200, await taskStore.assignTask(taskId, agent));
}

async function pickupTaskResponse(store: SessionStore, taskStore: TaskStore, taskId: string, body: unknown): Promise<RelayApiResponse> {
  const input = asRecord(body);
  const current = await taskStore.getTask(taskId);
  const agent = agentName(input.agent) ?? current.assignedAgent;
  if (!agent) return jsonResponse(400, { error: "agent must be claude, pi, or codex." });
  let task = current.assignedAgent === agent ? current : await taskStore.assignTask(taskId, agent);
  if (task.status !== "assigned") {
    task = await taskStore.appendEvent(taskId, relayTaskEvent("task.status", taskId, { status: "assigned" }));
  }
  const mode = input.mode === "review" || agent === "codex" && input.mode !== "implement" ? "review" : "implement";
  const workspacePath = stringField(input, "workspacePath") || "/workspace";
  const controller = new SessionController(store, { taskStore, taskId: task.id, workspacePath });
  const session = await controller.createSession(
    task.description ? `${task.title}\n\n${task.description}` : task.title,
    ["human", agent],
    true,
  );
  await controller.assignSession(session.id, [{ agent, mode }]);
  task = await taskStore.recordActivity(task.id, `${agent} picked up the task.`, { agent, sessionId: session.id });
  return jsonResponse(200, { task, session: await store.getSession(session.id) });
}

async function createSessionResponse(store: SessionStore, taskStore: TaskStore, body: unknown): Promise<RelayApiResponse> {
  const input = asRecord(body);
  const taskGoal = stringField(input, "taskGoal");
  if (!taskGoal) return jsonResponse(400, { error: "taskGoal is required." });
  const assignments = assignmentList(input.assignments);
  const participants = ["human", ...assignments.map((assignment) => assignment.agent)];
  const workspacePath = stringField(input, "workspacePath") || "/workspace";
  const controller = new SessionController(store, { taskStore, taskId: typeof input.taskId === "string" ? input.taskId : undefined, workspacePath });
  const session = await controller.createSession(taskGoal, [...new Set(participants)], true);
  if (assignments.length > 0) {
    await controller.assignSession(session.id, assignments);
  }
  return jsonResponse(201, await store.getSession(session.id));
}

async function assignSessionResponse(store: SessionStore, taskStore: TaskStore, sessionId: string, body: unknown): Promise<RelayApiResponse> {
  const input = asRecord(body);
  const assignments = assignmentList(input.assignments);
  if (assignments.length === 0) return jsonResponse(400, { error: "assignments must include at least one agent." });
  const controller = new SessionController(store, { taskStore });
  await controller.assignSession(sessionId, assignments);
  return jsonResponse(200, await store.getSession(sessionId));
}

async function decisionResponse(store: SessionStore, taskStore: TaskStore, sessionId: string, body: unknown): Promise<RelayApiResponse> {
  const input = asRecord(body);
  const kind = decisionKind(input.kind);
  if (!kind) return jsonResponse(400, { error: "kind must be approve, reject, cancel, rerun, handoff, or mark_done." });
  const controller = new SessionController(store, { taskStore });
  const session = await controller.recordDecision(sessionId, kind, stringField(input, "note") || undefined, agentName(input.targetAgent));
  return jsonResponse(200, session);
}

async function handoffResponse(store: SessionStore, taskStore: TaskStore, sessionId: string, body: unknown): Promise<RelayApiResponse> {
  const input = asRecord(body);
  const targetAgent = agentName(input.targetAgent);
  if (!targetAgent) return jsonResponse(400, { error: "targetAgent must be claude, pi, or codex." });
  const mode = input.mode === "review" || targetAgent === "codex" && input.mode !== "implement" ? "review" : "implement";
  const controller = new SessionController(store, { taskStore });
  const session = await controller.handoffSession(sessionId, targetAgent, [{ agent: targetAgent, mode, role: roleName(input.role) }], stringField(input, "note") || undefined);
  return jsonResponse(200, session);
}

async function sseEventsResponse(store: SessionStore, sessionId: string): Promise<RelayApiResponse> {
  const session = await store.getSession(sessionId);
  let body = "";
  for (const event of session.events) {
    body += `event: ${event.type}\n`;
    body += `data: ${JSON.stringify(event)}\n\n`;
  }
  body += "event: heartbeat\n";
  body += `data: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`;
  return { status: 200, contentType: "text/event-stream; charset=utf-8", body, sse: true };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  return typeof field === "string" ? field.trim() : "";
}

function assignmentList(value: unknown): WorkflowStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const agent = agentName(record.agent);
    if (!agent) return [];
    const mode = record.mode === "review" ? "review" : "implement";
    const role = typeof record.role === "string" && ["implementer", "reviewer", "planner", "tester", "fixer"].includes(record.role)
      ? record.role as AgentRole
      : undefined;
    return [{ agent, mode, role }];
  });
}

function agentName(value: unknown): AgentName | undefined {
  return value === "claude" || value === "pi" || value === "codex" ? value : undefined;
}

function roleName(value: unknown): AgentRole | undefined {
  return typeof value === "string" && ["implementer", "reviewer", "planner", "tester", "fixer"].includes(value)
    ? value as AgentRole
    : undefined;
}

function decisionKind(value: unknown): HumanDecisionKind | undefined {
  return value === "approve" || value === "reject" || value === "cancel" || value === "rerun" || value === "handoff" || value === "mark_done"
    ? value
    : undefined;
}

function jsonResponse(status: number, body: unknown): RelayApiResponse {
  return {
    status,
    contentType: "application/json; charset=utf-8",
    body: `${JSON.stringify(body, null, 2)}\n`,
  };
}

function apiRootResponse(): RelayApiResponse {
  return jsonResponse(200, {
    name: "Relay API",
    ui: false,
    endpoints: [
      "GET /tasks",
      "POST /tasks",
      "GET /tasks/:id",
      "PATCH /tasks/:id",
      "POST /tasks/:id/assign",
      "POST /tasks/:id/pickup",
      "GET /tasks/:id/events",
      "GET /sessions",
      "POST /sessions",
      "GET /sessions/:id",
      "POST /sessions/:id/assignments",
      "POST /sessions/:id/decisions",
      "POST /sessions/:id/handoffs",
      "GET /sessions/:id/events",
      "GET /sessions/:id/artifacts/:artifactId",
    ],
  });
}
