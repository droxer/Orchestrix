import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { assignmentFailureOutcome, SessionController, type WorkflowStep } from "./controller.js";
import { handleRelayApiRequest } from "./server.js";
import {
  DEFAULT_RELAY_DATA_DIR,
  LocalSessionStore,
  newRelayId,
  relayEvent,
  roleForAgent,
  type RelaySession,
  type SessionStore,
} from "./session.js";
import type {
  DaemonNodeCommand,
  DaemonNodeEvent,
  DaemonNodeRegistration,
  DaemonNodeRunCommand,
} from "relay-core";
import {
  initialAgentState,
  mergeAgentState,
  type AgentExecutor,
  type AgentName,
  type AgentOutputSink,
  type AgentState,
  type CodexTaskMode,
} from "relay-core";
import { ensureAgentReady, withOrchestratorSession } from "./workflow.js";
import { LocalTaskStore } from "./task.js";

export type SandboxStatus = "provisioning" | "ready" | "running" | "stopped" | "failed";

const CONTROL_PANEL_VERSION = process.env.RELAY_CONTROL_PANEL_VERSION ?? Date.now().toString(36);

export interface SandboxRecord {
  id: string;
  employeeId: string;
  workspacePath?: string;
  status: SandboxStatus;
  agents: Record<AgentName, "unknown" | "ready" | "failed">;
  token?: string;
  tokenHash?: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  lastError?: string;
}

export interface SandboxRunAssignment {
  agent: AgentName;
  mode?: CodexTaskMode;
}

export interface SandboxRunRequest {
  taskGoal: string;
  assignments: SandboxRunAssignment[];
  sessionId?: string;
}

export interface SandboxBackend {
  provision(input: { employeeId: string; workspacePath?: string; token?: string }): Promise<SandboxRecord>;
  get(sandboxId: string): SandboxRecord | undefined;
  list(): SandboxRecord[];
  run(sandboxId: string, request: SandboxRunRequest): Promise<RelaySession>;
  cancelRun?(sandboxId: string, sessionId: string, reason: string): Promise<RelaySession>;
}

export interface DaemonNodeActiveRun {
  commandId: string;
  sessionId: string;
  runId: string;
  agent: AgentName;
  mode: CodexTaskMode;
  taskGoal: string;
  workspacePath?: string;
  startedAt: string;
}

export interface DaemonNodeMonitorRecord extends Omit<SandboxRecord, "token" | "tokenHash"> {
  queuedCommandCount: number;
  activeRuns: DaemonNodeActiveRun[];
}

interface TrackedDaemonNodeActiveRun extends DaemonNodeActiveRun {
  sandboxId: string;
}

const DAEMON_RUN_TIMEOUT_MS = 15 * 60 * 1000;
type DaemonCompletionEvent = Extract<DaemonNodeEvent, { type: "run.completed" | "run.failed" | "run.cancelled" }>;

export type DaemonCommandStatus = "queued" | "dispatched" | "completed" | "failed" | "cancelled";
export type DaemonRunStatus = "running" | "completed" | "failed" | "cancelled";

export interface DaemonCommandRecord {
  id: string;
  nodeId: string;
  command: DaemonNodeCommand;
  status: DaemonCommandStatus;
  createdAt: string;
  updatedAt: string;
  dispatchedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface DaemonRunRecord extends DaemonNodeActiveRun {
  nodeId: string;
  status: DaemonRunStatus;
  completedAt?: string;
  exitCode?: number;
  error?: string;
}

export type DaemonEvent =
  | {
      id: string;
      type: "daemon.node.registered";
      timestamp: string;
      node: SandboxRecord;
    }
  | {
      id: string;
      type: "daemon.node.seen";
      timestamp: string;
      nodeId: string;
      patch: Pick<Partial<SandboxRecord>, "status" | "lastError" | "lastSeenAt">;
    }
  | {
      id: string;
      type: "daemon.command.queued" | "daemon.command.dispatched";
      timestamp: string;
      nodeId: string;
      commandId: string;
    }
  | {
      id: string;
      type: "daemon.command.completed" | "daemon.command.failed" | "daemon.command.cancelled";
      timestamp: string;
      nodeId: string;
      commandId: string;
      runId?: string;
      exitCode?: number;
      error?: string;
    };

export interface DaemonStore {
  registerNode(input: SandboxRecord): SandboxRecord;
  markNodeSeen(nodeId: string, patch?: Pick<Partial<SandboxRecord>, "status" | "lastError">): SandboxRecord | undefined;
  getNode(nodeId: string): SandboxRecord | undefined;
  listNodes(): SandboxRecord[];
  enqueueCommand(nodeId: string, command: DaemonNodeCommand): DaemonCommandRecord;
  takeQueuedCommands(nodeId: string, limit?: number): DaemonCommandRecord[];
  queuedCommandCount(nodeId: string): number;
  listActiveRuns(nodeId?: string): DaemonRunRecord[];
  markCommandCompleted(nodeId: string, event: Extract<DaemonNodeEvent, { type: "run.completed" }>): void;
  markCommandFailed(nodeId: string, event: Extract<DaemonNodeEvent, { type: "run.failed" }>): void;
  markCommandCancelled(nodeId: string, event: Extract<DaemonNodeEvent, { type: "run.cancelled" }>): void;
  appendDaemonEvent(event: DaemonEvent): void;
}

export interface RelayDaemonOptions {
  port?: number;
  host?: string;
  backend?: SandboxBackend;
  daemonNodeMode?: "reverse" | "local";
  daemonStore?: DaemonStore;
  store?: SessionStore;
  sink?: AgentOutputSink;
  execStream?: AgentExecutor;
}

export interface RelayDaemonResponse {
  status: number;
  contentType: string;
  body: string;
}

export function serveRelayDaemon(options: RelayDaemonOptions = {}): void {
  const store = options.store ?? new LocalSessionStore();
  const daemonNodeRegistry = new DaemonNodeRegistry(store, options.daemonStore);
  const backend = options.backend ?? (options.daemonNodeMode === "local"
    ? new LocalSandboxBackend({
        store,
        sink: options.sink,
        execStream: options.execStream,
      })
    : new ReverseDaemonNodeBackend(daemonNodeRegistry));
  const port = options.port ?? 8790;
  const host = options.host ?? "127.0.0.1";
  const server = createServer((request, response) => {
    void routeDaemonRequest(backend, request, response, daemonNodeRegistry).catch((error: unknown) => {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
  server.listen(port, host, () => {
    const baseUrl = `http://${host}:${port}`;
    console.log(`Relay daemon listening on ${baseUrl}`);
    console.log(`Relay daemon control panel: ${baseUrl}/control`);
  });
}

export async function routeDaemonRequest(
  backend: SandboxBackend,
  request: IncomingMessage,
  response: ServerResponse,
  reverseRegistry?: DaemonNodeRegistry,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://relay-daemon.local");
  const body = method === "GET" ? undefined : await readJsonBody(request);
  const authToken = bearerToken(request.headers.authorization);
  const routed = await handleRelayDaemonRequest(backend, method, url.pathname, body, reverseRegistry, authToken);
  response.writeHead(routed.status, { "Content-Type": routed.contentType });
  response.end(routed.body);
}

export async function handleRelayDaemonRequest(
  backend: SandboxBackend,
  method: string,
  pathname: string,
  body?: unknown,
  reverseRegistry?: DaemonNodeRegistry,
  authToken?: string,
): Promise<RelayDaemonResponse> {
  const parts = pathname.split("/").filter(Boolean);
  if (method === "GET" && parts.length === 1 && parts[0] === "control") {
    return htmlResponse(200, daemonControlPanelHtml());
  }
  if (method === "GET" && parts.length === 2 && parts[0] === "control" && parts[1] === "version") {
    return jsonResponse(200, { version: CONTROL_PANEL_VERSION });
  }
  if (method === "GET" && parts.length === 0) {
    return jsonResponse(200, {
      name: "Relay daemon",
      ui: true,
      uiPath: "/control",
      endpoints: [
        "GET /sandboxes",
        "POST /sandboxes",
        "GET /sandboxes/:id",
        "POST /sandboxes/:id/runs",
        "GET /control",
        "GET /control/version",
        "GET /daemon-nodes",
        "POST /daemon-nodes/register",
        "GET /daemon-nodes/:sandboxId/commands",
        "POST /daemon-nodes/:sandboxId/events",
      ],
    });
  }
  const isDaemonNodeRoute = parts[0] === "daemon-nodes";
  if (method === "GET" && parts.length === 1 && isDaemonNodeRoute) {
    if (!reverseRegistry) return jsonResponse(404, { error: "Reverse daemon node registry is not enabled." });
    return jsonResponse(200, { nodes: reverseRegistry.monitorNodes() });
  }
  if (method === "POST" && parts.length === 2 && isDaemonNodeRoute && parts[1] === "register") {
    if (!reverseRegistry) return jsonResponse(404, { error: "Reverse daemon node registry is not enabled." });
    return jsonResponse(200, reverseRegistry.register(daemonNodeRegistration(body, authToken)));
  }
  if (method === "GET" && parts.length === 3 && isDaemonNodeRoute && parts[2] === "commands") {
    if (!reverseRegistry) return jsonResponse(404, { error: "Reverse daemon node registry is not enabled." });
    return jsonResponse(200, { commands: reverseRegistry.takeCommands(parts[1], authToken) });
  }
  if (method === "POST" && parts.length === 3 && isDaemonNodeRoute && parts[2] === "events") {
    if (!reverseRegistry) return jsonResponse(404, { error: "Reverse daemon node registry is not enabled." });
    reverseRegistry.handleEvent(parts[1], daemonNodeEvent(body), authToken);
    return jsonResponse(202, { ok: true });
  }
  if (parts[0] === "sessions") {
    if (!reverseRegistry) return jsonResponse(404, { error: "Session store is not available." });
    return handleRelayApiRequest(
      reverseRegistry.store,
      method,
      pathname,
      body,
      new LocalTaskStore(dataDirForSessionStore(reverseRegistry.store)),
    );
  }
  if (method === "GET" && parts.length === 1 && parts[0] === "sandboxes") {
    return jsonResponse(200, { sandboxes: backend.list() });
  }
  if (method === "POST" && parts.length === 1 && parts[0] === "sandboxes") {
    const input = asRecord(body);
    const employeeId = stringField(input, "employeeId");
    if (!employeeId) return jsonResponse(400, { error: "employeeId is required." });
    try {
      return jsonResponse(201, await backend.provision({
        employeeId,
        workspacePath: stringField(input, "workspacePath") || undefined,
        token: authToken,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/token/i.test(message)) return jsonResponse(401, { error: message });
      throw error;
    }
  }
  if (method === "GET" && parts.length === 2 && parts[0] === "sandboxes") {
    const sandbox = backend.get(parts[1]);
    if (!sandbox) return jsonResponse(404, { error: "Sandbox not found." });
    const authError = sandboxAuthError(sandbox, authToken);
    if (authError) return jsonResponse(401, { error: authError });
    return jsonResponse(200, sandbox);
  }
  if (method === "POST" && parts.length === 3 && parts[0] === "sandboxes" && parts[2] === "runs") {
    const sandbox = backend.get(parts[1]);
    if (!sandbox) return jsonResponse(404, { error: "Sandbox not found." });
    const authError = sandboxAuthError(sandbox, authToken);
    if (authError) return jsonResponse(401, { error: authError });
    const request = sandboxRunRequest(body);
    if (!request) {
      return jsonResponse(400, { error: "taskGoal and at least one assignment are required." });
    }
    return jsonResponse(202, await backend.run(parts[1], request));
  }
  if (method === "POST" && parts.length === 5 && parts[0] === "sandboxes" && parts[2] === "runs" && parts[4] === "cancel") {
    const sandbox = backend.get(parts[1]);
    if (!sandbox) return jsonResponse(404, { error: "Sandbox not found." });
    const authError = sandboxAuthError(sandbox, authToken);
    if (authError) return jsonResponse(401, { error: authError });
    if (!backend.cancelRun) return jsonResponse(400, { error: "Sandbox backend does not support cancellation." });
    const input = asRecord(body);
    return jsonResponse(202, await backend.cancelRun(parts[1], parts[3], stringField(input, "reason") || "Cancelled by human."));
  }
  return jsonResponse(404, { error: "Not found" });
}

export class DaemonNodeRegistry {
  private readonly sandboxes = new Map<string, SandboxRecord>();
  private readonly activeCommands = new Map<string, TrackedDaemonNodeActiveRun>();
  private readonly completions = new Map<string, {
    resolve: (event: DaemonCompletionEvent) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private readonly outputs = new Map<string, string[]>();
  private readonly outputSequences = new Map<string, Set<number>>();

  constructor(
    public readonly store: SessionStore = new LocalSessionStore(),
    private readonly daemonStore: DaemonStore = new LocalDaemonStore(dataDirForSessionStore(store)),
  ) {
    for (const sandbox of daemonStore.listNodes()) {
      this.sandboxes.set(sandbox.id, offlineSandboxRecord(sandbox));
    }
    for (const run of daemonStore.listActiveRuns()) {
      this.activeCommands.set(run.commandId, { ...run, sandboxId: run.nodeId });
    }
  }

  register(input: DaemonNodeRegistration): SandboxRecord {
    const now = new Date().toISOString();
    const existing = this.sandboxes.get(input.sandboxId);
    const agents: SandboxRecord["agents"] = {
      claude: input.supportedAgents.includes("claude") ? "ready" : "unknown",
      pi: input.supportedAgents.includes("pi") ? "ready" : "unknown",
      codex: input.supportedAgents.includes("codex") ? "ready" : "unknown",
    };
    const sandbox: SandboxRecord = {
      id: input.sandboxId,
      employeeId: input.employeeId,
      workspacePath: input.workspacePath,
      status: input.status === "busy" ? "running" : input.status === "stopped" ? "stopped" : "ready",
      agents,
      token: input.token,
      tokenHash: hashDaemonNodeToken(input.token),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastSeenAt: now,
    };
    this.sandboxes.set(sandbox.id, sandbox);
    this.daemonStore.registerNode(sandbox);
    return sandbox;
  }

  updateStatus(sandboxId: string, patch: Pick<Partial<SandboxRecord>, "status" | "lastError">): void {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) return;
    const updated = {
      ...sandbox,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.sandboxes.set(sandboxId, updated);
    this.daemonStore.markNodeSeen(sandboxId, patch);
  }

  get(sandboxId: string): SandboxRecord | undefined {
    return this.sandboxes.get(sandboxId);
  }

  list(): SandboxRecord[] {
    return [...this.sandboxes.values()];
  }

  monitorNodes(): DaemonNodeMonitorRecord[] {
    return this.list().map((sandbox) => {
      const { token: _token, tokenHash: _tokenHash, ...node } = sandbox;
      return {
        ...node,
        queuedCommandCount: this.daemonStore.queuedCommandCount(sandbox.id),
        activeRuns: this.daemonStore.listActiveRuns(sandbox.id).map(daemonActiveRun),
      };
    });
  }

  findByEmployee(employeeId: string, workspacePath?: string): SandboxRecord | undefined {
    return this.list().find((sandbox) =>
      sandbox.employeeId === employeeId &&
      (!workspacePath || !sandbox.workspacePath || sandbox.workspacePath === workspacePath)
    );
  }

  enqueue(sandboxId: string, command: DaemonNodeCommand): void {
    this.daemonStore.enqueueCommand(sandboxId, command);
    if (command.type === "run.start") {
      this.activeCommands.set(command.id, {
        sandboxId,
        commandId: command.id,
        sessionId: command.sessionId,
        runId: command.runId,
        agent: command.agent,
        mode: command.mode,
        taskGoal: command.taskGoal,
        workspacePath: command.workspacePath,
        startedAt: new Date().toISOString(),
      });
    }
  }

  takeCommands(sandboxId: string, token?: string): DaemonNodeCommand[] {
    this.assertAuthorized(sandboxId, token);
    this.markSeen(sandboxId);
    const records = this.daemonStore.takeQueuedCommands(sandboxId);
    for (const record of records) {
      const command = record.command;
      if (command.type === "run.start") {
        this.activeCommands.set(command.id, {
          sandboxId,
          commandId: command.id,
          sessionId: command.sessionId,
          runId: command.runId,
          agent: command.agent,
          mode: command.mode,
          taskGoal: command.taskGoal,
          workspacePath: command.workspacePath,
          startedAt: record.dispatchedAt ?? new Date().toISOString(),
        });
      }
    }
    return records.map((record) => record.command);
  }

  waitForCompletion(commandId: string, timeoutMs = DAEMON_RUN_TIMEOUT_MS): Promise<DaemonCompletionEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const active = this.activeCommands.get(commandId);
        if (active) {
          this.daemonStore.markCommandFailed(active.sandboxId, {
            type: "run.failed",
            commandId,
            sessionId: active.sessionId,
            runId: active.runId,
            agent: active.agent,
            mode: active.mode,
            error: `Daemon node command ${commandId} timed out after ${timeoutMs}ms.`,
          });
        }
        this.completions.delete(commandId);
        this.activeCommands.delete(commandId);
        reject(new Error(`Daemon node command ${commandId} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.completions.set(commandId, { resolve, reject, timer });
    });
  }

  cancelActiveRun(sandboxId: string, sessionId: string, reason: string): TrackedDaemonNodeActiveRun | undefined {
    const active = [...this.activeCommands.values()].find((run) =>
      run.sandboxId === sandboxId && run.sessionId === sessionId
    );
    if (!active) return undefined;
    this.enqueue(sandboxId, {
      id: newRelayId("cmd"),
      type: "run.cancel",
      commandId: active.commandId,
      sessionId: active.sessionId,
      runId: active.runId,
      agent: active.agent,
      mode: active.mode,
      reason,
    });
    return active;
  }

  handleEvent(sandboxId: string, event: DaemonNodeEvent, token?: string): void {
    this.assertAuthorized(sandboxId, token);
    this.markSeen(sandboxId);
    if (event.type === "run.output") {
      const seen = this.outputSequences.get(event.runId) ?? new Set<number>();
      if (seen.has(event.sequence)) return;
      seen.add(event.sequence);
      this.outputSequences.set(event.runId, seen);
      this.outputs.set(event.runId, [...(this.outputs.get(event.runId) ?? []), event.text]);
      this.store.appendEvent(event.sessionId, relayEvent("agent.output", event.sessionId, {
        runId: event.runId,
        agent: event.agent,
        stream: event.stream,
        text: event.text,
      }));
      return;
    }
    this.activeCommands.delete(event.commandId);
    if (event.type === "run.completed") {
      this.daemonStore.markCommandCompleted(sandboxId, event);
    } else if (event.type === "run.cancelled") {
      this.daemonStore.markCommandCancelled(sandboxId, event);
    } else {
      this.daemonStore.markCommandFailed(sandboxId, event);
    }
    const completion = this.completions.get(event.commandId);
    if (completion) {
      clearTimeout(completion.timer);
      completion.resolve(event);
    }
    this.completions.delete(event.commandId);
  }

  outputForRun(runId: string): string {
    return (this.outputs.get(runId) ?? []).join("");
  }

  private assertAuthorized(sandboxId: string, token?: string): void {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) throw new Error(`Unknown sandbox ${sandboxId}.`);
    if (!daemonNodeTokenMatches(sandbox, token)) throw new Error("Unauthorized daemon node request.");
  }

  private markSeen(sandboxId: string): void {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) return;
    const now = new Date().toISOString();
    const updated = { ...sandbox, updatedAt: now, lastSeenAt: now };
    this.sandboxes.set(sandboxId, updated);
    this.daemonStore.markNodeSeen(sandboxId);
  }
}

export class LocalDaemonStore implements DaemonStore {
  private readonly nodesDir: string;
  private readonly commandsDir: string;
  private readonly runsDir: string;
  private readonly eventsDir: string;

  constructor(rootDir = DEFAULT_RELAY_DATA_DIR) {
    this.nodesDir = join(rootDir, "daemon", "nodes");
    this.commandsDir = join(rootDir, "daemon", "commands");
    this.runsDir = join(rootDir, "daemon", "runs");
    this.eventsDir = join(rootDir, "daemon", "events");
    mkdirSync(this.nodesDir, { recursive: true });
    mkdirSync(this.commandsDir, { recursive: true });
    mkdirSync(this.runsDir, { recursive: true });
    mkdirSync(this.eventsDir, { recursive: true });
  }

  registerNode(input: SandboxRecord): SandboxRecord {
    const node = { ...input, token: undefined, tokenHash: input.tokenHash ?? hashDaemonNodeToken(input.token ?? "") };
    this.writeNode(node);
    this.appendDaemonEvent(daemonEvent("daemon.node.registered", { node }));
    return node;
  }

  markNodeSeen(nodeId: string, patch: Pick<Partial<SandboxRecord>, "status" | "lastError"> = {}): SandboxRecord | undefined {
    const node = this.getNode(nodeId);
    if (!node) return undefined;
    const now = new Date().toISOString();
    const updated = {
      ...node,
      ...patch,
      updatedAt: now,
      lastSeenAt: now,
    };
    this.writeNode(updated);
    this.appendDaemonEvent(daemonEvent("daemon.node.seen", {
      nodeId,
      patch: {
        status: patch.status,
        lastError: patch.lastError,
        lastSeenAt: now,
      },
    }));
    return updated;
  }

  getNode(nodeId: string): SandboxRecord | undefined {
    const path = join(this.nodesDir, `${safeDaemonNodeFileName(nodeId)}.json`);
    if (!existsSync(path)) return undefined;
    return sandboxRecord(JSON.parse(readFileSync(path, "utf8")) as unknown);
  }

  listNodes(): SandboxRecord[] {
    if (!existsSync(this.nodesDir)) return [];
    return readdirSync(this.nodesDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .flatMap((entry) => {
        const parsed = JSON.parse(readFileSync(join(this.nodesDir, entry.name), "utf8")) as unknown;
        const sandbox = sandboxRecord(parsed);
        return sandbox ? [sandbox] : [];
      });
  }

  enqueueCommand(nodeId: string, command: DaemonNodeCommand): DaemonCommandRecord {
    const now = new Date().toISOString();
    const record: DaemonCommandRecord = {
      id: command.id,
      nodeId,
      command,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    this.writeCommand(record);
    if (command.type === "run.start") {
      this.writeRun({
        nodeId,
        commandId: command.id,
        sessionId: command.sessionId,
        runId: command.runId,
        agent: command.agent,
        mode: command.mode,
        taskGoal: command.taskGoal,
        workspacePath: command.workspacePath,
        status: "running",
        startedAt: now,
      });
    }
    this.appendDaemonEvent(daemonEvent("daemon.command.queued", { nodeId, commandId: command.id }));
    return record;
  }

  takeQueuedCommands(nodeId: string, limit = Number.MAX_SAFE_INTEGER): DaemonCommandRecord[] {
    const now = new Date().toISOString();
    const records = this.listCommands()
      .filter((record) => record.nodeId === nodeId && record.status === "queued")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit)
      .map((record) => ({
        ...record,
        status: "dispatched" as const,
        updatedAt: now,
        dispatchedAt: now,
      }));
    for (const record of records) {
      if (record.command.type === "run.start") {
        this.writeCommand(record);
        this.writeRun({ ...this.runForCommand(record), status: "running", startedAt: now });
      } else {
        this.writeCommand({ ...record, status: "completed", completedAt: now });
      }
      this.appendDaemonEvent(daemonEvent("daemon.command.dispatched", { nodeId, commandId: record.id }));
    }
    return records;
  }

  queuedCommandCount(nodeId: string): number {
    return this.listCommands().filter((record) => record.nodeId === nodeId && record.status === "queued").length;
  }

  listActiveRuns(nodeId?: string): DaemonRunRecord[] {
    if (!existsSync(this.runsDir)) return [];
    return readdirSync(this.runsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .flatMap((entry) => {
        const record = daemonRunRecord(JSON.parse(readFileSync(join(this.runsDir, entry.name), "utf8")) as unknown);
        return record && record.status === "running" && (!nodeId || record.nodeId === nodeId) ? [record] : [];
      });
  }

  markCommandCompleted(nodeId: string, event: Extract<DaemonNodeEvent, { type: "run.completed" }>): void {
    const now = new Date().toISOString();
    const command = this.getCommand(event.commandId);
    if (command) {
      this.writeCommand({ ...command, status: "completed", updatedAt: now, completedAt: now });
    }
    const run = this.getRun(event.runId) ?? daemonRunFromEvent(nodeId, event, "completed");
    this.writeRun({
      ...run,
      status: "completed",
      completedAt: now,
      exitCode: event.exitCode,
    });
    this.appendDaemonEvent(daemonEvent("daemon.command.completed", {
      nodeId,
      commandId: event.commandId,
      runId: event.runId,
      exitCode: event.exitCode,
    }));
  }

  markCommandFailed(nodeId: string, event: Extract<DaemonNodeEvent, { type: "run.failed" }>): void {
    const now = new Date().toISOString();
    const command = this.getCommand(event.commandId);
    if (command) {
      this.writeCommand({ ...command, status: "failed", updatedAt: now, completedAt: now, error: event.error });
    }
    const run = this.getRun(event.runId) ?? daemonRunFromEvent(nodeId, event, "failed");
    this.writeRun({
      ...run,
      status: "failed",
      completedAt: now,
      error: event.error,
    });
    this.appendDaemonEvent(daemonEvent("daemon.command.failed", {
      nodeId,
      commandId: event.commandId,
      runId: event.runId,
      error: event.error,
    }));
  }

  markCommandCancelled(nodeId: string, event: Extract<DaemonNodeEvent, { type: "run.cancelled" }>): void {
    const now = new Date().toISOString();
    const command = this.getCommand(event.commandId);
    if (command) {
      this.writeCommand({ ...command, status: "cancelled", updatedAt: now, completedAt: now, error: event.reason });
    }
    const run = this.getRun(event.runId) ?? daemonRunFromEvent(nodeId, event, "cancelled");
    this.writeRun({
      ...run,
      status: "cancelled",
      completedAt: now,
      error: event.reason,
    });
    this.appendDaemonEvent(daemonEvent("daemon.command.cancelled", {
      nodeId,
      commandId: event.commandId,
      runId: event.runId,
      error: event.reason,
    }));
  }

  appendDaemonEvent(event: DaemonEvent): void {
    mkdirSync(this.eventsDir, { recursive: true });
    appendFileSync(join(this.eventsDir, "events.jsonl"), `${JSON.stringify(event)}\n`);
  }

  private listCommands(): DaemonCommandRecord[] {
    if (!existsSync(this.commandsDir)) return [];
    return readdirSync(this.commandsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .flatMap((entry) => {
        const record = daemonCommandRecord(JSON.parse(readFileSync(join(this.commandsDir, entry.name), "utf8")) as unknown);
        return record ? [record] : [];
      });
  }

  private getCommand(commandId: string): DaemonCommandRecord | undefined {
    const path = join(this.commandsDir, `${safeDaemonNodeFileName(commandId)}.json`);
    if (!existsSync(path)) return undefined;
    return daemonCommandRecord(JSON.parse(readFileSync(path, "utf8")) as unknown);
  }

  private getRun(runId: string): DaemonRunRecord | undefined {
    const path = join(this.runsDir, `${safeDaemonNodeFileName(runId)}.json`);
    if (!existsSync(path)) return undefined;
    return daemonRunRecord(JSON.parse(readFileSync(path, "utf8")) as unknown);
  }

  private runForCommand(record: DaemonCommandRecord): DaemonRunRecord {
    if (record.command.type === "run.start") {
      return this.getRun(record.command.runId) ?? {
        nodeId: record.nodeId,
        commandId: record.command.id,
        sessionId: record.command.sessionId,
        runId: record.command.runId,
        agent: record.command.agent,
        mode: record.command.mode,
        taskGoal: record.command.taskGoal,
        workspacePath: record.command.workspacePath,
        status: "running",
        startedAt: record.dispatchedAt ?? record.createdAt,
      };
    }
    throw new Error(`Unsupported daemon command ${record.id}.`);
  }

  private writeNode(sandbox: SandboxRecord): void {
    mkdirSync(this.nodesDir, { recursive: true });
    const path = join(this.nodesDir, `${safeDaemonNodeFileName(sandbox.id)}.json`);
    writeFileSync(path, `${JSON.stringify(sandbox, null, 2)}\n`, { mode: 0o600 });
  }

  private writeCommand(record: DaemonCommandRecord): void {
    mkdirSync(this.commandsDir, { recursive: true });
    const path = join(this.commandsDir, `${safeDaemonNodeFileName(record.id)}.json`);
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  }

  private writeRun(record: DaemonRunRecord): void {
    mkdirSync(this.runsDir, { recursive: true });
    const path = join(this.runsDir, `${safeDaemonNodeFileName(record.runId)}.json`);
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  }
}

export const LocalDaemonNodeStorage = LocalDaemonStore;

export class ReverseDaemonNodeBackend implements SandboxBackend {
  constructor(private readonly registry: DaemonNodeRegistry) {}

  async provision(input: { employeeId: string; workspacePath?: string; token?: string }): Promise<SandboxRecord> {
    const existing = this.registry.findByEmployee(input.employeeId, input.workspacePath);
    if (existing) {
      const authError = sandboxAuthError(existing, input.token);
      if (authError) throw new Error(authError);
      return existing;
    }
    const sandboxId = newSandboxId(input.employeeId);
    const now = new Date().toISOString();
    const sandbox: SandboxRecord = {
      id: sandboxId,
      employeeId: input.employeeId,
      workspacePath: input.workspacePath,
      status: "provisioning",
      agents: { claude: "unknown", pi: "unknown", codex: "unknown" },
      token: input.token || newRelayId("tok"),
      createdAt: now,
      updatedAt: now,
      lastError: "Waiting for daemon node registration.",
    };
    this.registry.register({
      sandboxId,
      employeeId: input.employeeId,
      token: sandbox.token ?? "",
      workspacePath: input.workspacePath,
      protocolVersion: 1,
      supportedAgents: [],
      status: "stopped",
    });
    return { ...sandbox, ...(this.registry.get(sandboxId) ?? {}) };
  }

  get(sandboxId: string): SandboxRecord | undefined {
    return this.registry.get(sandboxId);
  }

  list(): SandboxRecord[] {
    return this.registry.list();
  }

  async run(sandboxId: string, request: SandboxRunRequest): Promise<RelaySession> {
    const sandbox = this.registry.get(sandboxId);
    if (!sandbox) throw new Error(`Sandbox ${sandboxId} has no registered daemon node.`);
    if (sandbox.status !== "ready") throw new Error(`Sandbox ${sandboxId} daemon node is not ready.`);
    this.registry.updateStatus(sandboxId, { status: "running", lastError: undefined });
    const controller = new SessionController(this.registry.store, {
      workspacePath: sandbox.workspacePath,
    });
    const sessionId = request.sessionId ?? controller.createSession(
      request.taskGoal,
      ["human", ...new Set(request.assignments.map((item) => item.agent))],
    ).id;
    let state: AgentState = initialAgentState(request.taskGoal);
    try {
      for (const assignment of request.assignments) {
        const mode = assignment.mode ?? "implement";
        const step: WorkflowStep = { agent: assignment.agent, mode, role: roleForAgent(assignment.agent, mode) };
        const runId = newRelayId("run");
        this.registry.store.appendEvent(sessionId, relayEvent("agent.started", sessionId, {
          runId,
          agent: step.agent,
          role: step.role ?? roleForAgent(step.agent, step.mode),
          mode: step.mode,
        }));
        const command: DaemonNodeRunCommand = {
          id: newRelayId("cmd"),
          type: "run.start",
          sessionId,
          runId,
          taskGoal: request.taskGoal,
          agent: assignment.agent,
          mode,
          workspacePath: sandbox.workspacePath,
        };
        this.registry.enqueue(sandboxId, command);
        let completed: DaemonCompletionEvent;
        try {
          completed = await this.registry.waitForCompletion(command.id);
        } catch (error) {
          const outcome = error instanceof Error ? error.message : String(error);
          this.registry.store.appendEvent(sessionId, relayEvent("agent.completed", sessionId, {
            runId,
            agent: assignment.agent,
            status: "failed",
            exitCode: 1,
          }));
          this.registry.store.appendEvent(sessionId, relayEvent("session.failed", sessionId, { outcome }));
          this.registry.updateStatus(sandboxId, { status: "failed", lastError: outcome });
          return this.registry.store.getSession(sessionId);
        }
        if (completed.type === "run.failed") {
          this.registry.store.appendEvent(sessionId, relayEvent("agent.completed", sessionId, {
            runId,
            agent: assignment.agent,
            status: "failed",
            exitCode: 1,
          }));
          this.registry.store.appendEvent(sessionId, relayEvent("session.failed", sessionId, { outcome: completed.error }));
          this.registry.updateStatus(sandboxId, { status: "ready", lastError: completed.error });
          return this.registry.store.getSession(sessionId);
        }
        if (completed.type === "run.cancelled") {
          this.registry.store.appendEvent(sessionId, relayEvent("agent.completed", sessionId, {
            runId,
            agent: assignment.agent,
            status: "cancelled",
            exitCode: 130,
          }));
          this.registry.store.appendEvent(sessionId, relayEvent("human.decision", sessionId, {
            decision: {
              id: newRelayId("dec"),
              kind: "cancel",
              createdAt: new Date().toISOString(),
              note: completed.reason,
            },
          }));
          this.registry.updateStatus(sandboxId, { status: "ready", lastError: completed.reason });
          return this.registry.store.getSession(sessionId);
        }
        state = mergeAgentState(state, {
          agent_logs: [completed.agentLog || this.registry.outputForRun(runId)],
          last_exit_code: completed.exitCode,
          codex_verdict: completed.codexVerdict ?? state.codex_verdict,
          codex_feedback: completed.codexFeedback ?? state.codex_feedback,
        });
        const artifact = this.registry.store.writeArtifact(sessionId, {
          kind: mode === "review" ? "review" : "command_log",
          title: `${assignment.agent} ${mode} output`,
          body: completed.agentLog || this.registry.outputForRun(runId),
          agentRunId: runId,
        });
        this.registry.store.appendEvent(sessionId, relayEvent("artifact.created", sessionId, { artifact }));
        this.registry.store.appendEvent(sessionId, relayEvent("agent.completed", sessionId, {
          runId,
          agent: assignment.agent,
          status: completed.exitCode === 0 ? "completed" : "failed",
          exitCode: completed.exitCode,
        }));
        if (assignment.agent === "codex" && mode === "review") {
          this.registry.store.appendEvent(sessionId, relayEvent("review.verdict", sessionId, {
            runId,
            verdict: completed.codexVerdict || "failed",
            feedback: completed.codexFeedback ?? "",
          }));
        }
        if (assignment.agent === "codex" && mode === "review" && completed.codexVerdict !== "approved") {
          const outcome = completed.codexVerdict === "rejected"
            ? "Codex rejected the work."
            : "Codex review did not approve the work.";
          this.registry.store.appendEvent(sessionId, relayEvent("session.failed", sessionId, { outcome }));
          this.registry.updateStatus(sandboxId, { status: "ready", lastError: outcome });
          return this.registry.store.getSession(sessionId);
        }
        if (completed.exitCode !== 0) {
          const outcome = assignmentFailureOutcome(step, state);
          this.registry.store.appendEvent(sessionId, relayEvent("session.failed", sessionId, { outcome }));
          this.registry.updateStatus(sandboxId, { status: "ready", lastError: outcome });
          return this.registry.store.getSession(sessionId);
        }
      }
      this.registry.store.appendEvent(sessionId, relayEvent("session.completed", sessionId, {
        outcome: "Assignments completed.",
      }));
      this.registry.updateStatus(sandboxId, { status: "ready", lastError: undefined });
      return this.registry.store.getSession(sessionId);
    } catch (error) {
      this.registry.updateStatus(sandboxId, {
        status: "failed",
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async cancelRun(sandboxId: string, sessionId: string, reason: string): Promise<RelaySession> {
    const sandbox = this.registry.get(sandboxId);
    if (!sandbox) throw new Error(`Sandbox ${sandboxId} has no registered daemon node.`);
    const active = this.registry.cancelActiveRun(sandboxId, sessionId, reason);
    if (!active) throw new Error(`Session ${sessionId} has no active daemon node run.`);
    return this.registry.store.getSession(sessionId);
  }
}

export class LocalSandboxBackend implements SandboxBackend {
  private readonly sandboxes = new Map<string, SandboxRecord>();
  private readonly store: SessionStore;

  constructor(private readonly options: Pick<RelayDaemonOptions, "store" | "sink" | "execStream"> = {}) {
    this.store = options.store ?? new LocalSessionStore();
  }

  async provision(input: { employeeId: string; workspacePath?: string; token?: string }): Promise<SandboxRecord> {
    const now = new Date().toISOString();
    const sandbox: SandboxRecord = {
      id: newSandboxId(input.employeeId),
      employeeId: input.employeeId,
      workspacePath: input.workspacePath,
      token: input.token,
      status: "ready",
      agents: {
        claude: "unknown",
        pi: "unknown",
        codex: "unknown",
      },
      createdAt: now,
      updatedAt: now,
    };
    this.sandboxes.set(sandbox.id, sandbox);
    return sandbox;
  }

  get(sandboxId: string): SandboxRecord | undefined {
    return this.sandboxes.get(sandboxId);
  }

  list(): SandboxRecord[] {
    return [...this.sandboxes.values()];
  }

  async run(sandboxId: string, request: SandboxRunRequest): Promise<RelaySession> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) throw new Error("Sandbox not found.");
    if (sandbox.status === "running") {
      throw new Error(`Sandbox ${sandboxId} is already running a task.`);
    }
    this.updateSandbox(sandboxId, { status: "running", lastError: undefined });
    const controller = new SessionController(this.store, {
      workspacePath: sandbox.workspacePath,
      sink: this.options.sink,
      execStream: this.options.execStream,
    });
    const sessionId = request.sessionId ?? controller.createSession(
      request.taskGoal,
      ["human", ...new Set(request.assignments.map((item) => item.agent))],
    ).id;
    try {
      await withOrchestratorSession(async () => {
        for (const agent of new Set(request.assignments.map((assignment) => assignment.agent))) {
          await ensureAgentReady(agent, this.options.sink);
        }
        await controller.runAssignments(sessionId, request.taskGoal, request.assignments.map((assignment) => ({
          agent: assignment.agent,
          mode: assignment.mode ?? "implement",
        })), {
          sink: this.options.sink,
          execStream: this.options.execStream,
        });
      }, this.options.sink, {
        boxName: sandboxBoxName(sandboxId),
        workspacePath: sandbox.workspacePath,
      });
      this.markAgentsReady(sandboxId, request.assignments.map((assignment) => assignment.agent));
      this.updateSandbox(sandboxId, { status: "ready" });
    } catch (error) {
      this.updateSandbox(sandboxId, {
        status: "failed",
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    return this.store.getSession(sessionId);
  }

  private markAgentsReady(sandboxId: string, agents: AgentName[]): void {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) return;
    const nextAgents = { ...sandbox.agents };
    for (const agent of agents) nextAgents[agent] = "ready";
    this.updateSandbox(sandboxId, { agents: nextAgents });
  }

  private updateSandbox(sandboxId: string, patch: Partial<SandboxRecord>): void {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) return;
    this.sandboxes.set(sandboxId, {
      ...sandbox,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of request) {
    raw += String(chunk);
  }
  if (!raw.trim()) return undefined;
  return JSON.parse(raw);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function sandboxRunRequest(value: unknown): SandboxRunRequest | undefined {
  const input = asRecord(value);
  const taskGoal = stringField(input, "taskGoal");
  if (!taskGoal) return undefined;
  const assignments = assignmentList(input.assignments);
  if (assignments.length === 0) return undefined;
  return {
    taskGoal,
    assignments,
    sessionId: stringField(input, "sessionId") || undefined,
  };
}

function assignmentList(value: unknown): SandboxRunAssignment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const agent = agentName(record.agent);
    if (!agent) return [];
    return [{
      agent,
      mode: record.mode === "review" ? "review" : "implement",
    }];
  });
}

function daemonNodeRegistration(value: unknown, authToken?: string): DaemonNodeRegistration {
  const input = asRecord(value);
  const sandboxId = stringField(input, "sandboxId");
  const employeeId = stringField(input, "employeeId");
  if (!sandboxId || !employeeId) {
    throw new Error("daemon node registration requires sandboxId and employeeId.");
  }
  return {
    sandboxId,
    employeeId,
    token: stringField(input, "token") || authToken || "",
    workspacePath: stringField(input, "workspacePath") || undefined,
    protocolVersion: 1,
    supportedAgents: Array.isArray(input.supportedAgents)
      ? input.supportedAgents.flatMap((item) => agentName(item) ?? [])
      : [],
    status: input.status === "busy" || input.status === "stopped" ? input.status : "ready",
  };
}

function daemonNodeEvent(value: unknown): DaemonNodeEvent {
  const input = asRecord(value);
  const type = stringField(input, "type");
  const commandId = stringField(input, "commandId");
  const sessionId = stringField(input, "sessionId");
  const runId = stringField(input, "runId");
  const agent = agentName(input.agent);
  if (!commandId || !sessionId || !runId || !agent) {
    throw new Error("daemon node event requires commandId, sessionId, runId, and agent.");
  }
  const mode = input.mode === "review" ? "review" : "implement";
  if (type === "run.output") {
    return {
      type,
      commandId,
      sessionId,
      runId,
      agent,
      stream: input.stream === "stderr" ? "stderr" : "stdout",
      text: stringField(input, "text"),
      sequence: typeof input.sequence === "number" ? input.sequence : 0,
    };
  }
  if (type === "run.completed") {
    return {
      type,
      commandId,
      sessionId,
      runId,
      agent,
      mode,
      exitCode: typeof input.exitCode === "number" ? input.exitCode : 0,
      agentLog: stringField(input, "agentLog"),
      codexVerdict: input.codexVerdict === "approved" || input.codexVerdict === "rejected" || input.codexVerdict === "failed"
        ? input.codexVerdict
        : "",
      codexFeedback: stringField(input, "codexFeedback"),
    };
  }
  if (type === "run.failed") {
    return {
      type,
      commandId,
      sessionId,
      runId,
      agent,
      mode,
      error: stringField(input, "error") || "Daemon node command failed.",
    };
  }
  if (type === "run.cancelled") {
    return {
      type,
      commandId,
      sessionId,
      runId,
      agent,
      mode,
      reason: stringField(input, "reason") || "Cancelled by human.",
    };
  }
  throw new Error("unknown daemon node event type.");
}

function bearerToken(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value;
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return match?.[1];
}

function sandboxAuthError(sandbox: SandboxRecord, token?: string): string | null {
  if (!sandbox.token && !sandbox.tokenHash) return null;
  if (!token) return "Sandbox token is required.";
  if (!daemonNodeTokenMatches(sandbox, token)) return "Invalid sandbox token.";
  return null;
}

function dataDirForSessionStore(store: SessionStore): string {
  return store instanceof LocalSessionStore ? store.rootDir : DEFAULT_RELAY_DATA_DIR;
}

function offlineSandboxRecord(sandbox: SandboxRecord): SandboxRecord {
  return {
    ...sandbox,
    token: undefined,
    status: "stopped",
    agents: { claude: "unknown", pi: "unknown", codex: "unknown" },
    updatedAt: new Date().toISOString(),
    lastError: "Waiting for daemon node registration.",
  };
}

function sandboxRecord(value: unknown): SandboxRecord | undefined {
  const input = asRecord(value);
  const id = stringField(input, "id");
  const employeeId = stringField(input, "employeeId");
  if (!id || !employeeId) return undefined;
  const agents = asRecord(input.agents);
  return {
    id,
    employeeId,
    workspacePath: stringField(input, "workspacePath") || undefined,
    status: sandboxStatus(input.status),
    agents: {
      claude: agentStatus(agents.claude),
      pi: agentStatus(agents.pi),
      codex: agentStatus(agents.codex),
    },
    token: stringField(input, "token") || undefined,
    tokenHash: stringField(input, "tokenHash") || undefined,
    createdAt: stringField(input, "createdAt") || new Date().toISOString(),
    updatedAt: stringField(input, "updatedAt") || new Date().toISOString(),
    lastSeenAt: stringField(input, "lastSeenAt") || undefined,
    lastError: stringField(input, "lastError") || undefined,
  };
}

function daemonCommandRecord(value: unknown): DaemonCommandRecord | undefined {
  const input = asRecord(value);
  const id = stringField(input, "id");
  const nodeId = stringField(input, "nodeId");
  const command = daemonNodeCommand(input.command);
  if (!id || !nodeId || !command) return undefined;
  const status = input.status === "queued" || input.status === "dispatched" || input.status === "completed" || input.status === "failed" || input.status === "cancelled"
    ? input.status
    : "queued";
  return {
    id,
    nodeId,
    command,
    status,
    createdAt: stringField(input, "createdAt") || new Date().toISOString(),
    updatedAt: stringField(input, "updatedAt") || new Date().toISOString(),
    dispatchedAt: stringField(input, "dispatchedAt") || undefined,
    completedAt: stringField(input, "completedAt") || undefined,
    error: stringField(input, "error") || undefined,
  };
}

function daemonNodeCommand(value: unknown): DaemonNodeCommand | undefined {
  const input = asRecord(value);
  const id = stringField(input, "id");
  const type = stringField(input, "type");
  const sessionId = stringField(input, "sessionId");
  const runId = stringField(input, "runId");
  const taskGoal = stringField(input, "taskGoal");
  const agent = agentName(input.agent);
  if (!id || !sessionId || !runId || !agent) return undefined;
  if (type === "run.cancel") {
    const commandId = stringField(input, "commandId");
    if (!commandId) return undefined;
    return {
      id,
      type,
      commandId,
      sessionId,
      runId,
      agent,
      mode: input.mode === "review" ? "review" : "implement",
      reason: stringField(input, "reason") || "Cancelled by human.",
    };
  }
  if (type !== "run.start" || !taskGoal) return undefined;
  return {
    id,
    type,
    sessionId,
    runId,
    taskGoal,
    agent,
    mode: input.mode === "review" ? "review" : "implement",
    workspacePath: stringField(input, "workspacePath") || undefined,
  };
}

function daemonRunRecord(value: unknown): DaemonRunRecord | undefined {
  const input = asRecord(value);
  const nodeId = stringField(input, "nodeId");
  const commandId = stringField(input, "commandId");
  const sessionId = stringField(input, "sessionId");
  const runId = stringField(input, "runId");
  const agent = agentName(input.agent);
  if (!nodeId || !commandId || !sessionId || !runId || !agent) return undefined;
  const status = input.status === "completed" || input.status === "failed" || input.status === "cancelled" ? input.status : "running";
  return {
    nodeId,
    commandId,
    sessionId,
    runId,
    agent,
    mode: input.mode === "review" ? "review" : "implement",
    taskGoal: stringField(input, "taskGoal"),
    workspacePath: stringField(input, "workspacePath") || undefined,
    startedAt: stringField(input, "startedAt") || new Date().toISOString(),
    status,
    completedAt: stringField(input, "completedAt") || undefined,
    exitCode: typeof input.exitCode === "number" ? input.exitCode : undefined,
    error: stringField(input, "error") || undefined,
  };
}

function daemonRunFromEvent(
  nodeId: string,
  event: DaemonCompletionEvent,
  status: DaemonRunStatus,
): DaemonRunRecord {
  return {
    nodeId,
    commandId: event.commandId,
    sessionId: event.sessionId,
    runId: event.runId,
    agent: event.agent,
    mode: event.mode,
    taskGoal: "",
    status,
    startedAt: new Date().toISOString(),
  };
}

function daemonActiveRun(run: DaemonRunRecord): DaemonNodeActiveRun {
  return {
    commandId: run.commandId,
    sessionId: run.sessionId,
    runId: run.runId,
    agent: run.agent,
    mode: run.mode,
    taskGoal: run.taskGoal,
    workspacePath: run.workspacePath,
    startedAt: run.startedAt,
  };
}

function daemonEvent(type: DaemonEvent["type"], payload: Record<string, unknown>): DaemonEvent {
  return {
    id: newRelayId("devt"),
    type,
    timestamp: new Date().toISOString(),
    ...payload,
  } as DaemonEvent;
}

function hashDaemonNodeToken(token: string): string | undefined {
  if (!token) return undefined;
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

function daemonNodeTokenMatches(sandbox: SandboxRecord, token?: string): boolean {
  if (!token) return false;
  if (sandbox.token) return sandbox.token === token;
  return sandbox.tokenHash === hashDaemonNodeToken(token);
}

function sandboxStatus(value: unknown): SandboxStatus {
  return value === "provisioning" || value === "ready" || value === "running" || value === "stopped" || value === "failed"
    ? value
    : "stopped";
}

function agentStatus(value: unknown): SandboxRecord["agents"][AgentName] {
  return value === "ready" || value === "failed" ? value : "unknown";
}

function agentName(value: unknown): AgentName | undefined {
  return value === "claude" || value === "pi" || value === "codex" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  return typeof field === "string" ? field.trim() : "";
}

function newSandboxId(employeeId: string): string {
  const safeEmployee = employeeId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "employee";
  return `sbx_${safeEmployee}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sandboxBoxName(sandboxId: string): string {
  return `relay-${sandboxId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 48)}`;
}

function safeDaemonNodeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_") || "daemon-node";
}

function htmlResponse(status: number, body: string): RelayDaemonResponse {
  return {
    status,
    contentType: "text/html; charset=utf-8",
    body,
  };
}

function jsonResponse(status: number, body: unknown): RelayDaemonResponse {
  return {
    status,
    contentType: "application/json; charset=utf-8",
    body: `${JSON.stringify(body, null, 2)}\n`,
  };
}

function daemonControlPanelHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Relay Daemon Control Panel</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
  <style>
    :root {
      color-scheme: light;
      --primary: #0052ff;
      --primary-active: #003ecc;
      --ink: #0a0b0d;
      --body: #5b616e;
      --muted: #7c828a;
      --muted-soft: #a8acb3;
      --hairline: #dee1e6;
      --hairline-soft: #eef0f3;
      --canvas: #ffffff;
      --surface-soft: #f7f7f7;
      --surface-strong: #eef0f3;
      --surface-dark: #0a0b0d;
      --surface-dark-elevated: #16181c;
      --on-dark: #ffffff;
      --on-dark-soft: #a8acb3;
      --up: #05b169;
      --down: #cf202f;
    }

    * { box-sizing: border-box; }

    html, body { margin: 0; }

    body {
      min-height: 100vh;
      background: var(--canvas);
      color: var(--ink);
      font-family: "Inter", -apple-system, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 16px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    .mono {
      font-family: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
      font-weight: 500;
      letter-spacing: 0;
    }

    /* Top nav --------------------------------------------------------- */

    .top-nav {
      height: 56px;
      padding: 0 24px;
      border-bottom: 1px solid var(--hairline);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--canvas);
    }

    .wordmark {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--ink);
      font-size: 18px;
      font-weight: 400;
      letter-spacing: -0.4px;
      line-height: 1;
    }

    .wordmark svg {
      display: block;
      width: 48px;
      height: 32px;
      flex: none;
      shape-rendering: geometricPrecision;
    }

    .nav-meta {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 500;
    }

    .nav-meta .badge {
      padding: 2px 10px;
      border-radius: 100px;
      background: var(--surface-strong);
      color: var(--ink);
      font-size: 11px;
      font-weight: 600;
    }

    /* Layout ---------------------------------------------------------- */

    main {
      width: min(1280px, calc(100% - 32px));
      margin: 0 auto;
      padding: 16px 0 20px;
    }

    .hero {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;
    }

    .hero-left {
      display: inline-flex;
      align-items: baseline;
      gap: 14px;
    }

    .eyebrow {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 100px;
      background: var(--surface-strong);
      color: var(--ink);
      font-size: 11px;
      font-weight: 600;
    }

    h1 {
      margin: 0;
      font-size: 26px;
      font-weight: 400;
      line-height: 1;
      letter-spacing: -0.6px;
      color: var(--ink);
    }

    .refresh {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 5px 12px;
      border-radius: 100px;
      background: var(--surface-strong);
      color: var(--body);
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
    }

    .refresh .dot {
      width: 6px;
      height: 6px;
      border-radius: 9999px;
      background: var(--up);
      flex: none;
    }

    .refresh.offline .dot { background: var(--down); }

    /* Metric strip ---------------------------------------------------- */

    .metrics {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 0;
      border-top: 1px solid var(--hairline);
      border-bottom: 1px solid var(--hairline);
      padding: 10px 0;
      margin-bottom: 14px;
    }

    .metric {
      display: flex;
      align-items: baseline;
      gap: 10px;
      padding: 0 16px;
      border-left: 1px solid var(--hairline);
    }

    .metric:first-child { border-left: 0; }

    .metric-label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 500;
    }

    .metric-value {
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 22px;
      font-weight: 500;
      letter-spacing: -0.2px;
      line-height: 1;
      color: var(--ink);
    }

    .metric-value.ready { color: var(--up); }
    .metric-value.running { color: var(--primary); }
    .metric-value.failed { color: var(--down); }

    /* Sections -------------------------------------------------------- */

    .columns {
      display: grid;
      grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
      gap: 14px;
      align-items: start;
    }

    .stack {
      display: flex;
      flex-direction: column;
      gap: 14px;
      min-width: 0;
    }

    section.block {
      min-width: 0;
    }

    .block-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 6px;
    }

    .block-head h2 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      line-height: 1.25;
      color: var(--ink);
    }

    .count {
      color: var(--muted);
      font-size: 11px;
      font-weight: 500;
    }

    /* Node table ------------------------------------------------------ */

    .table-card {
      border: 1px solid var(--hairline);
      border-radius: 12px;
      overflow: hidden;
      background: var(--canvas);
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    thead th {
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid var(--hairline);
      background: var(--surface-soft);
      color: var(--muted);
      font-size: 11px;
      font-weight: 600;
    }

    tbody td {
      padding: 8px 12px;
      border-bottom: 1px solid var(--hairline-soft);
      vertical-align: middle;
      font-size: 13px;
      color: var(--ink);
    }

    tbody tr:last-child td { border-bottom: 0; }

    .col-node { width: 36%; }
    .col-status { width: 18%; }
    .col-agents { width: 26%; }
    .col-meta { width: 20%; text-align: right; }

    .node-name {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: var(--ink);
      line-height: 1.25;
    }

    .node-id {
      display: block;
      margin-top: 2px;
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 11px;
      font-weight: 400;
      color: var(--muted);
      word-break: break-all;
      line-height: 1.3;
    }

    .meta-time {
      display: block;
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 12px;
      font-weight: 500;
      color: var(--ink);
      line-height: 1.2;
    }

    .meta-sub {
      display: block;
      margin-top: 2px;
      font-size: 11px;
      color: var(--muted);
    }

    /* Status pill ----------------------------------------------------- */

    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 100px;
      background: var(--surface-strong);
      color: var(--ink);
      font-size: 11px;
      font-weight: 600;
    }

    .status::before {
      content: "";
      width: 6px;
      height: 6px;
      border-radius: 9999px;
      background: var(--muted-soft);
      flex: none;
    }

    .status.ready::before { background: var(--up); }
    .status.running::before, .status.provisioning::before { background: var(--primary); }
    .status.failed::before, .status.stale::before { background: var(--down); }

    .status.running::before {
      animation: pulse 1.6s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.7); }
    }

    /* Agent chips ----------------------------------------------------- */

    .agents {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .agent {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 8px 2px 7px;
      border-radius: 100px;
      background: var(--surface-strong);
      color: var(--ink);
      font-size: 11px;
      font-weight: 600;
    }

    .agent::before {
      content: "";
      width: 5px;
      height: 5px;
      border-radius: 9999px;
      background: var(--muted-soft);
      flex: none;
    }

    .agent.ready::before { background: var(--up); }
    .agent.failed::before { background: var(--down); }

    /* Side cards (runs + attention) ---------------------------------- */

    .card-grid {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .feature-card {
      background: var(--canvas);
      border: 1px solid var(--hairline);
      border-radius: 10px;
      padding: 10px 12px;
    }

    .feature-card .row-title {
      margin: 0 0 2px;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.25;
      color: var(--ink);
    }

    .feature-card .row-meta {
      margin: 0 0 4px;
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 11px;
      font-weight: 400;
      color: var(--muted);
      word-break: break-all;
      line-height: 1.3;
    }

    .feature-card .row-body {
      margin: 0;
      color: var(--body);
      font-size: 12px;
      line-height: 1.4;
    }

    .empty {
      padding: 14px;
      border: 1px dashed var(--hairline);
      border-radius: 10px;
      color: var(--muted);
      font-size: 12px;
      text-align: center;
    }

    /* Responsive ------------------------------------------------------ */

    @media (max-width: 1024px) {
      .columns { grid-template-columns: 1fr; }
    }

    @media (max-width: 720px) {
      main { padding: 12px 0 16px; }
      .top-nav { padding: 0 16px; }
      .hero { flex-direction: column; align-items: flex-start; gap: 8px; margin-bottom: 10px; }
      .metrics { grid-template-columns: repeat(2, 1fr); row-gap: 8px; padding: 10px 0; }
      .metric { padding: 0 12px; }
      .metric:nth-child(odd) { border-left: 0; }
      thead { display: none; }
      tbody tr { display: block; padding: 8px 0; border-bottom: 1px solid var(--hairline-soft); }
      tbody tr:last-child { border-bottom: 0; }
      tbody td { display: block; width: auto !important; padding: 3px 12px; border: 0; text-align: left !important; }
      .col-meta { text-align: left; }
    }
  </style>
</head>
<body>
  <nav class="top-nav">
    <span class="wordmark">
      <svg viewBox="0 0 96 64" role="img" aria-label="Relay" xmlns="http://www.w3.org/2000/svg">
        <g fill="none" stroke="#18232d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 14 H22 L32 24 H40"/>
          <path d="M10 50 H22 L32 40 H40"/>
        </g>
        <g fill="#18232d">
          <circle cx="10" cy="14" r="4"/>
          <circle cx="10" cy="50" r="4"/>
        </g>
        <g stroke="#0052ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none">
          <line x1="32" y1="32" x2="76" y2="32"/>
          <polyline points="68,24 80,32 68,40"/>
        </g>
      </svg>
      Relay
    </span>
    <span class="nav-meta"><span class="badge">Daemon</span><span>Control panel</span></span>
  </nav>

  <main>
    <section class="hero">
      <div class="hero-left">
        <span class="eyebrow">Node operations</span>
        <h1>Control panel</h1>
      </div>
      <div class="refresh" id="refreshState"><span class="dot" aria-hidden="true"></span>waiting for nodes…</div>
    </section>

    <section class="metrics" aria-label="Daemon node metrics">
      <div class="metric"><span class="metric-label">Nodes</span><span class="metric-value" id="metricTotal">0</span></div>
      <div class="metric"><span class="metric-label">Ready</span><span class="metric-value ready" id="metricReady">0</span></div>
      <div class="metric"><span class="metric-label">Running</span><span class="metric-value running" id="metricRunning">0</span></div>
      <div class="metric"><span class="metric-label">Failed</span><span class="metric-value failed" id="metricFailed">0</span></div>
      <div class="metric"><span class="metric-label">Queued</span><span class="metric-value" id="metricQueued">0</span></div>
    </section>

    <div class="columns">
      <section class="block">
        <div class="block-head">
          <h2>Nodes</h2>
          <span class="count" id="nodeCount">0 nodes</span>
        </div>
        <div class="table-card" id="nodeTable"></div>
      </section>

      <div class="stack">
        <section class="block">
          <div class="block-head">
            <h2>Active runs</h2>
            <span class="count" id="runCount">0 running</span>
          </div>
          <div class="card-grid" id="activeRuns"></div>
        </section>

        <section class="block">
          <div class="block-head">
            <h2>Attention</h2>
            <span class="count" id="attentionCount">0 items</span>
          </div>
          <div class="card-grid" id="attention"></div>
        </section>
      </div>
    </div>
  </main>

  <script>
    const controlPanelVersion = ${JSON.stringify(CONTROL_PANEL_VERSION)};
    const staleAfterMs = 15000;
    const quietAfterMs = 10000;
    const els = {
      refreshState: document.getElementById('refreshState'),
      metricTotal: document.getElementById('metricTotal'),
      metricReady: document.getElementById('metricReady'),
      metricRunning: document.getElementById('metricRunning'),
      metricFailed: document.getElementById('metricFailed'),
      metricQueued: document.getElementById('metricQueued'),
      nodeCount: document.getElementById('nodeCount'),
      runCount: document.getElementById('runCount'),
      attentionCount: document.getElementById('attentionCount'),
      nodeTable: document.getElementById('nodeTable'),
      activeRuns: document.getElementById('activeRuns'),
      attention: document.getElementById('attention')
    };

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, function(char) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
      });
    }

    function timeAgo(value) {
      if (!value) return 'never';
      const delta = Date.now() - new Date(value).getTime();
      if (!Number.isFinite(delta)) return 'unknown';
      if (delta < 1000) return 'now';
      if (delta < 60000) return Math.floor(delta / 1000) + 's ago';
      if (delta < 3600000) return Math.floor(delta / 60000) + 'm ago';
      return Math.floor(delta / 3600000) + 'h ago';
    }

    function isStale(node) {
      if (!node.lastSeenAt) return true;
      return Date.now() - new Date(node.lastSeenAt).getTime() > staleAfterMs;
    }

    function visualStatus(node) {
      return isStale(node) && node.status !== 'running' ? 'stale' : node.status;
    }

    function renderAgents(agents) {
      return ['claude', 'pi', 'codex'].map(function(agent) {
        const state = agents && agents[agent] ? agents[agent] : 'unknown';
        return '<span class="agent ' + escapeHtml(state) + '">' + agent + '</span>';
      }).join('');
    }

    function renderNodes(nodes) {
      if (!nodes.length) {
        els.nodeTable.innerHTML = '<div class="empty">No daemon nodes have registered yet.</div>';
        return;
      }
      const rows = nodes.map(function(node) {
        const state = visualStatus(node);
        return '<tr>' +
          '<td class="col-node"><span class="node-name">' + escapeHtml(node.employeeId) + '</span><span class="node-id">' + escapeHtml(node.id) + '</span></td>' +
          '<td class="col-status"><span class="status ' + escapeHtml(state) + '">' + escapeHtml(state) + '</span></td>' +
          '<td class="col-agents"><div class="agents">' + renderAgents(node.agents) + '</div></td>' +
          '<td class="col-meta"><span class="meta-time">' + escapeHtml(timeAgo(node.lastSeenAt)) + '</span><span class="meta-sub">' + escapeHtml(node.queuedCommandCount || 0) + ' queued · ' + escapeHtml((node.activeRuns || []).length) + ' active</span></td>' +
        '</tr>';
      }).join('');
      els.nodeTable.innerHTML = '<table>' +
        '<thead><tr>' +
          '<th class="col-node">Node</th>' +
          '<th class="col-status">Status</th>' +
          '<th class="col-agents">Agents</th>' +
          '<th class="col-meta" style="text-align:right">Last seen</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';
    }

    function renderRuns(nodes) {
      const runs = nodes.flatMap(function(node) {
        return (node.activeRuns || []).map(function(run) {
          return { node: node, run: run };
        });
      });
      els.runCount.textContent = runs.length + ' running';
      if (!runs.length) {
        els.activeRuns.innerHTML = '<div class="empty">Nothing is running right now.</div>';
        return;
      }
      els.activeRuns.innerHTML = runs.map(function(item) {
        return '<div class="feature-card">' +
          '<p class="row-title">' + escapeHtml(item.run.agent) + ' · ' + escapeHtml(item.run.mode) + ' on ' + escapeHtml(item.node.employeeId) + '</p>' +
          '<p class="row-meta">' + escapeHtml(item.run.runId) + ' · started ' + escapeHtml(timeAgo(item.run.startedAt)) + '</p>' +
          '<p class="row-body">' + escapeHtml(item.run.taskGoal) + '</p>' +
        '</div>';
      }).join('');
    }

    function renderAttention(nodes) {
      const items = [];
      nodes.forEach(function(node) {
        if (node.lastError) {
          items.push({ title: node.employeeId + ' · error', body: node.lastError });
        }
        if (Date.now() - new Date(node.lastSeenAt || 0).getTime() > quietAfterMs) {
          items.push({ title: node.employeeId + ' · quiet', body: 'Last seen ' + timeAgo(node.lastSeenAt) + '.' });
        }
      });
      els.attentionCount.textContent = items.length + (items.length === 1 ? ' item' : ' items');
      if (!items.length) {
        els.attention.innerHTML = '<div class="empty">All clear.</div>';
        return;
      }
      els.attention.innerHTML = items.slice(0, 6).map(function(item) {
        return '<div class="feature-card">' +
          '<p class="row-title">' + escapeHtml(item.title) + '</p>' +
          '<p class="row-body">' + escapeHtml(item.body) + '</p>' +
        '</div>';
      }).join('');
    }

    function render(data) {
      const nodes = Array.isArray(data.nodes) ? data.nodes : [];
      const ready = nodes.filter(function(node) { return visualStatus(node) === 'ready'; }).length;
      const running = nodes.filter(function(node) { return node.status === 'running'; }).length;
      const failed = nodes.filter(function(node) { return visualStatus(node) === 'failed' || visualStatus(node) === 'stale'; }).length;
      const queued = nodes.reduce(function(total, node) { return total + (node.queuedCommandCount || 0); }, 0);
      els.metricTotal.textContent = nodes.length;
      els.metricReady.textContent = ready;
      els.metricRunning.textContent = running;
      els.metricFailed.textContent = failed;
      els.metricQueued.textContent = queued;
      els.nodeCount.textContent = nodes.length + (nodes.length === 1 ? ' node' : ' nodes');
      renderNodes(nodes);
      renderRuns(nodes);
      renderAttention(nodes);
    }

    function setRefresh(text, offline) {
      els.refreshState.classList.toggle('offline', !!offline);
      els.refreshState.innerHTML = '<span class="dot" aria-hidden="true"></span>' + escapeHtml(text);
    }

    async function refresh() {
      try {
        const response = await fetch('/daemon-nodes', { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        render(await response.json());
        setRefresh('Updated ' + new Date().toLocaleTimeString() + ' · hot reload armed', false);
      } catch (error) {
        setRefresh('Offline · ' + (error && error.message ? error.message : String(error)), true);
      }
    }

    async function checkForPanelUpdate() {
      try {
        const response = await fetch('/control/version', { cache: 'no-store' });
        if (!response.ok) return;
        const body = await response.json();
        if (body && body.version && body.version !== controlPanelVersion) {
          window.location.reload();
        }
      } catch (_error) {
        // The daemon may be restarting during a rebuild. The data poll already reports offline state.
      }
    }

    refresh();
    setInterval(refresh, 2000);
    setInterval(checkForPanelUpdate, 1000);
  </script>
</body>
</html>`;
}
