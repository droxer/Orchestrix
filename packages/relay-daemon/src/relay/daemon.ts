import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

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
import { DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS, REPO_ROOT } from "relay-core";
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
import { defaultExecutionManager } from "./execution.js";
import { LocalTaskStore } from "./task.js";

export type SandboxStatus = "provisioning" | "ready" | "running" | "stopped" | "failed";

const CONTROL_PANEL_VERSION = process.env.RELAY_CONTROL_PANEL_VERSION ?? Date.now().toString(36);
const WEB_UI_PATH = "/web";
const WEB_UI_DIST_DIR_CANDIDATES = [
  process.env.RELAY_WEB_UI_DIST_DIR,
  resolve(process.cwd(), "packages/relay-web/out"),
  resolve(REPO_ROOT, "packages/relay-web/out"),
].filter((path): path is string => Boolean(path));

export interface SandboxRecord {
  id: string;
  employeeId: string;
  workspacePath?: string;
  status: SandboxStatus;
  agents: Record<AgentName, "unknown" | "ready" | "failed">;
  /** Plaintext UI token returned only during provisioning. */
  token?: string;
  /** Deprecated UI-token hash retained for compatibility with persisted records. */
  tokenHash?: string;
  uiTokenHash?: string;
  nodeTokenHash?: string;
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
  provision(input: { employeeId: string; workspacePath?: string; token?: string; nodeToken?: string }): Promise<SandboxRecord>;
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

export interface DaemonNodeMonitorRecord extends Omit<SandboxRecord, "token" | "tokenHash" | "uiTokenHash" | "nodeTokenHash"> {
  queuedCommandCount: number;
  activeRuns: DaemonNodeActiveRun[];
}

interface TrackedDaemonNodeActiveRun extends DaemonNodeActiveRun {
  sandboxId: string;
}

const DAEMON_RUN_TIMEOUT_MS = positiveIntEnv("RELAY_DAEMON_RUN_TIMEOUT_MS") ?? 15 * 60 * 1000;
const MAX_JSON_BODY_BYTES = 10 * 1024 * 1024;
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
  daemonNodeMode?: "server" | "local" | "reverse";
  daemonStore?: DaemonStore;
  store?: SessionStore;
  sink?: AgentOutputSink;
  execStream?: AgentExecutor;
  withOrchestratorSession?: typeof withOrchestratorSession;
  ensureAgentReady?: typeof ensureAgentReady;
}

export interface RelayDaemonResponse {
  status: number;
  contentType: string;
  body: string;
  /** Raw bytes for binary assets; takes precedence over `body` when set. */
  bodyBytes?: Buffer;
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
    : new ServerDaemonNodeBackend(daemonNodeRegistry));
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
    console.log(`Relay web UI: ${baseUrl}${WEB_UI_PATH}`);
  });
}

export async function routeDaemonRequest(
  backend: SandboxBackend,
  request: IncomingMessage,
  response: ServerResponse,
  serverRegistry?: DaemonNodeRegistry,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://relay-daemon.local");
  const body = method === "GET" ? undefined : await readJsonBody(request);
  const authToken = bearerToken(request.headers.authorization);
  const routed = await handleRelayDaemonRequest(backend, method, url.pathname, body, serverRegistry, authToken);
  response.writeHead(routed.status, { "Content-Type": routed.contentType });
  response.end(routed.bodyBytes ?? routed.body);
}

export async function handleRelayDaemonRequest(
  backend: SandboxBackend,
  method: string,
  pathname: string,
  body?: unknown,
  serverRegistry?: DaemonNodeRegistry,
  authToken?: string,
): Promise<RelayDaemonResponse> {
  const parts = pathname.split("/").filter(Boolean);
  if (method === "GET" && parts.length === 1 && parts[0] === "control") {
    return htmlResponse(200, daemonControlPanelHtml());
  }
  if (method === "GET" && parts.length === 2 && parts[0] === "control" && parts[1] === "version") {
    return jsonResponse(200, { version: CONTROL_PANEL_VERSION });
  }
  if (method === "GET" && parts[0] === "web") {
    return webUiAssetResponse(parts.slice(1));
  }
  if (method === "GET" && parts.length === 0) {
    return jsonResponse(200, {
      name: "Relay daemon",
      daemonNodeMode: daemonNodeModeForBackend(backend),
      ui: true,
      uiPath: "/control",
      webUiPath: WEB_UI_PATH,
      endpoints: [
        "GET /sandboxes",
        "POST /sandboxes",
        "GET /sandboxes/:id",
        "POST /sandboxes/:id/runs",
        "GET /control",
        "GET /control/version",
        "GET /web",
        "GET /daemon-nodes",
        "POST /daemon-nodes/register",
        "GET /daemon-nodes/:sandboxId/commands",
        "POST /daemon-nodes/:sandboxId/events",
      ],
    });
  }
  const isDaemonNodeRoute = parts[0] === "daemon-nodes";
  if (method === "GET" && parts.length === 1 && isDaemonNodeRoute) {
    if (!serverRegistry) return jsonResponse(404, { error: "Server mode daemon node registry is not enabled." });
    const nodes = serverRegistry.monitorNodesForToken(authToken);
    if (!nodes) return jsonResponse(401, { error: authToken ? "Invalid sandbox token." : "Sandbox token is required." });
    return jsonResponse(200, { nodes });
  }
  if (method === "POST" && parts.length === 2 && isDaemonNodeRoute && parts[1] === "register") {
    if (!serverRegistry) return jsonResponse(404, { error: "Server mode daemon node registry is not enabled." });
    try {
      return jsonResponse(200, serverRegistry.register(daemonNodeRegistration(body, authToken)));
    } catch (error) {
      return daemonNodeRouteError(error);
    }
  }
  if (method === "GET" && parts.length === 3 && isDaemonNodeRoute && parts[2] === "commands") {
    if (!serverRegistry) return jsonResponse(404, { error: "Server mode daemon node registry is not enabled." });
    try {
      return jsonResponse(200, { commands: serverRegistry.takeCommands(parts[1], authToken) });
    } catch (error) {
      return daemonNodeRouteError(error);
    }
  }
  if (method === "POST" && parts.length === 3 && isDaemonNodeRoute && parts[2] === "events") {
    if (!serverRegistry) return jsonResponse(404, { error: "Server mode daemon node registry is not enabled." });
    try {
      serverRegistry.handleEvent(parts[1], daemonNodeEvent(body), authToken);
    } catch (error) {
      return daemonNodeRouteError(error);
    }
    return jsonResponse(202, { ok: true });
  }
  if (parts[0] === "sessions") {
    if (!serverRegistry) return jsonResponse(404, { error: "Session store is not available." });
    return handleAuthenticatedSessionRequest(serverRegistry, method, pathname, body, authToken);
  }
  if (method === "GET" && parts.length === 1 && parts[0] === "sandboxes") {
    const sandboxes = sandboxesForToken(backend, authToken);
    if (!sandboxes) return jsonResponse(401, { error: authToken ? "Invalid sandbox token." : "Sandbox token is required." });
    return jsonResponse(200, { sandboxes });
  }
  if (method === "POST" && parts.length === 1 && parts[0] === "sandboxes") {
    const input = asRecord(body);
    const employeeId = stringField(input, "employeeId");
    if (!employeeId) return jsonResponse(400, { error: "employeeId is required." });
    try {
      const sandbox = await backend.provision({
        employeeId,
        workspacePath: stringField(input, "workspacePath") || undefined,
        token: authToken,
        nodeToken: stringField(input, "nodeToken") || undefined,
      });
      return jsonResponse(201, provisionedSandboxRecord(sandbox));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/token/i.test(message)) return jsonResponse(401, { error: message });
      throw error;
    }
  }
  if (method === "GET" && parts.length === 2 && parts[0] === "sandboxes") {
    const sandbox = backend.get(parts[1]);
    if (!sandbox) return jsonResponse(404, { error: "Sandbox not found." });
    const authError = sandboxUiAuthError(sandbox, authToken);
    if (authError) return jsonResponse(401, { error: authError });
    return jsonResponse(200, publicSandboxRecord(sandbox));
  }
  if (method === "POST" && parts.length === 3 && parts[0] === "sandboxes" && parts[2] === "runs") {
    const sandbox = backend.get(parts[1]);
    if (!sandbox) return jsonResponse(404, { error: "Sandbox not found." });
    const authError = sandboxUiAuthError(sandbox, authToken);
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
    const authError = sandboxUiAuthError(sandbox, authToken);
    if (authError) return jsonResponse(401, { error: authError });
    if (!backend.cancelRun) return jsonResponse(400, { error: "Sandbox backend does not support cancellation." });
    const input = asRecord(body);
    return jsonResponse(202, await backend.cancelRun(parts[1], parts[3], stringField(input, "reason") || "Cancelled by human."));
  }
  return jsonResponse(404, { error: "Not found" });
}

function daemonNodeModeForBackend(backend: SandboxBackend): "local" | "server" {
  return backend instanceof LocalSandboxBackend ? "local" : "server";
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

  register(input: DaemonNodeRegistration, uiToken?: string): SandboxRecord {
    const now = new Date().toISOString();
    const existing = this.sandboxes.get(input.sandboxId);
    if ((existing?.nodeTokenHash || existing?.tokenHash) && !daemonNodeTokenMatches(existing, input.token)) {
      throw new Error(
        `Unauthorized daemon node registration for ${input.sandboxId}: token does not match the token issued at provisioning.`,
      );
    }
    const nextUiTokenHash = uiToken
      ? hashDaemonNodeToken(uiToken)
      : existing?.uiTokenHash ?? existing?.tokenHash;
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
      // Plaintext tokens are intentionally NOT retained in the registry record.
      // The UI token and daemon-node token are stored as separate hashes.
      token: undefined,
      tokenHash: nextUiTokenHash,
      uiTokenHash: nextUiTokenHash,
      nodeTokenHash: hashDaemonNodeToken(input.token) ?? existing?.nodeTokenHash ?? existing?.tokenHash,
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
      const { token: _token, tokenHash: _tokenHash, uiTokenHash: _uiTokenHash, nodeTokenHash: _nodeTokenHash, ...node } = sandbox;
      return {
        ...node,
        queuedCommandCount: this.daemonStore.queuedCommandCount(sandbox.id),
        activeRuns: this.daemonStore.listActiveRuns(sandbox.id).map(daemonActiveRun),
      };
    });
  }

  monitorNodesForToken(token?: string): DaemonNodeMonitorRecord[] | undefined {
    if (!token) return undefined;
    const allowed = new Set(this.list()
      .filter((sandbox) => sandboxUiTokenMatches(sandbox, token))
      .map((sandbox) => sandbox.id));
    if (allowed.size === 0) return undefined;
    return this.monitorNodes().filter((node) => allowed.has(node.id));
  }

  findByEmployee(employeeId: string, workspacePath?: string): SandboxRecord | undefined {
    const matches = this.list().filter((sandbox) =>
      sandbox.employeeId === employeeId &&
      (!workspacePath || !sandbox.workspacePath || sandbox.workspacePath === workspacePath)
    );
    // Prefer the live daemon node over offline placeholders so re-provisioning
    // converges on whichever node actually registered for this employee.
    const rank = (sandbox: SandboxRecord): number =>
      sandbox.status === "ready" ? 0 : sandbox.status === "running" ? 1 : 2;
    return matches.sort((a, b) =>
      rank(a) - rank(b) || (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? "")
    )[0];
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
        const reason = `Daemon node command ${commandId} timed out after ${timeoutMs}ms.`;
        const active = this.activeCommands.get(commandId);
        if (active) {
          this.daemonStore.markCommandFailed(active.sandboxId, {
            type: "run.failed",
            commandId,
            sessionId: active.sessionId,
            runId: active.runId,
            agent: active.agent,
            mode: active.mode,
            error: reason,
          });
          // The node is still running the agent; tell it to abort instead of
          // letting the run burn compute until it finishes on its own.
          this.enqueue(active.sandboxId, {
            id: newRelayId("cmd"),
            type: "run.cancel",
            commandId,
            sessionId: active.sessionId,
            runId: active.runId,
            agent: active.agent,
            mode: active.mode,
            reason,
          });
          this.clearRunOutput(active.runId);
        }
        this.completions.delete(commandId);
        this.activeCommands.delete(commandId);
        reject(new Error(reason));
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
    const active = this.activeCommands.get(event.commandId);
    // Drop events for commands this daemon is not tracking (late events after a
    // timeout, or stale ids). Without an active record the event cannot be tied
    // to a sandbox, so acting on it would let one node touch another's state.
    if (!active) return;
    if (active.sandboxId !== sandboxId || active.runId !== event.runId || active.sessionId !== event.sessionId) {
      throw new Error("Unauthorized daemon node event: command belongs to a different sandbox.");
    }
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
    } else {
      // Nothing is awaiting this run (e.g. the daemon restarted mid-run), so
      // the buffered output has no consumer left.
      this.clearRunOutput(event.runId);
    }
    this.completions.delete(event.commandId);
  }

  outputForRun(runId: string): string {
    return (this.outputs.get(runId) ?? []).join("");
  }

  clearRunOutput(runId: string): void {
    this.outputs.delete(runId);
    this.outputSequences.delete(runId);
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
    // An authorized poll proves the daemon node is alive again. Offline
    // placeholders ("stopped", e.g. after a daemon restart) and stale
    // "provisioning"/"failed" records become schedulable without requiring a
    // re-registration; "running" is left to the run lifecycle.
    const revived = sandbox.status === "stopped" || sandbox.status === "provisioning" || sandbox.status === "failed";
    const patch: Pick<Partial<SandboxRecord>, "status" | "lastError"> = revived
      ? { status: "ready", lastError: undefined }
      : {};
    const updated = { ...sandbox, ...patch, updatedAt: now, lastSeenAt: now };
    this.sandboxes.set(sandboxId, updated);
    this.daemonStore.markNodeSeen(sandboxId, patch);
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
    const uiTokenHash = input.uiTokenHash ?? input.tokenHash ?? hashDaemonNodeToken(input.token ?? "");
    const node = {
      ...input,
      token: undefined,
      tokenHash: uiTokenHash,
      uiTokenHash,
      nodeTokenHash: input.nodeTokenHash,
    };
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
    return sandboxRecord(readJsonFileSafe(path));
  }

  listNodes(): SandboxRecord[] {
    if (!existsSync(this.nodesDir)) return [];
    return readdirSync(this.nodesDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .flatMap((entry) => {
        const sandbox = sandboxRecord(readJsonFileSafe(join(this.nodesDir, entry.name)));
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
        const record = daemonRunRecord(readJsonFileSafe(join(this.runsDir, entry.name)));
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
        const record = daemonCommandRecord(readJsonFileSafe(join(this.commandsDir, entry.name)));
        return record ? [record] : [];
      });
  }

  private getCommand(commandId: string): DaemonCommandRecord | undefined {
    const path = join(this.commandsDir, `${safeDaemonNodeFileName(commandId)}.json`);
    if (!existsSync(path)) return undefined;
    return daemonCommandRecord(readJsonFileSafe(path));
  }

  private getRun(runId: string): DaemonRunRecord | undefined {
    const path = join(this.runsDir, `${safeDaemonNodeFileName(runId)}.json`);
    if (!existsSync(path)) return undefined;
    return daemonRunRecord(readJsonFileSafe(path));
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
    writeJsonFileAtomic(path, sandbox, 0o600);
  }

  private writeCommand(record: DaemonCommandRecord): void {
    mkdirSync(this.commandsDir, { recursive: true });
    const path = join(this.commandsDir, `${safeDaemonNodeFileName(record.id)}.json`);
    writeJsonFileAtomic(path, record);
  }

  private writeRun(record: DaemonRunRecord): void {
    mkdirSync(this.runsDir, { recursive: true });
    const path = join(this.runsDir, `${safeDaemonNodeFileName(record.runId)}.json`);
    writeJsonFileAtomic(path, record);
  }
}

export const LocalDaemonNodeStorage = LocalDaemonStore;

export class ServerDaemonNodeBackend implements SandboxBackend {
  constructor(private readonly registry: DaemonNodeRegistry) {}

  async provision(input: { employeeId: string; workspacePath?: string; token?: string; nodeToken?: string }): Promise<SandboxRecord> {
    const existing = this.registry.findByEmployee(input.employeeId, input.workspacePath);
    if (existing) {
      const uiAuthError = sandboxUiAuthError(existing, input.token);
      if (!uiAuthError) return existing;
      const nodeAuthError = sandboxNodeAuthError(existing, input.nodeToken);
      if (!nodeAuthError && input.token) {
        return this.registry.register({
          sandboxId: existing.id,
          employeeId: existing.employeeId,
          token: input.nodeToken ?? "",
          workspacePath: existing.workspacePath,
          protocolVersion: DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS[0],
          supportedAgents: agentsReadyInSandbox(existing),
          status: existing.status === "running" ? "busy" : existing.status === "stopped" ? "stopped" : "ready",
        }, input.token);
      }
      throw new Error(nodeAuthError ?? uiAuthError);
    }
    if (!input.token) throw new Error("Sandbox token is required.");
    if (!input.nodeToken) throw new Error("Daemon node token is required.");
    const sandboxId = newSandboxId(input.employeeId);
    const now = new Date().toISOString();
    const sandbox: SandboxRecord = {
      id: sandboxId,
      employeeId: input.employeeId,
      workspacePath: input.workspacePath,
      status: "provisioning",
      agents: { claude: "unknown", pi: "unknown", codex: "unknown" },
      token: input.token,
      createdAt: now,
      updatedAt: now,
      lastError: "Waiting for daemon node registration.",
    };
    this.registry.register({
      sandboxId,
      employeeId: input.employeeId,
      token: input.nodeToken,
      workspacePath: input.workspacePath,
      protocolVersion: DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS[0],
      supportedAgents: [],
      status: "stopped",
    }, sandbox.token);
    // Return the plaintext token to the caller exactly once. The registry
    // intentionally keeps only the hash in memory.
    const stored = this.registry.get(sandboxId) ?? {};
    return { ...sandbox, ...stored, token: input.token };
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
          this.registry.clearRunOutput(runId);
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
          this.registry.clearRunOutput(runId);
          this.registry.store.appendEvent(sessionId, relayEvent("agent.completed", sessionId, {
            runId,
            agent: assignment.agent,
            status: "failed",
            exitCode: completed.exitCode ?? 1,
          }));
          this.registry.store.appendEvent(sessionId, relayEvent("session.failed", sessionId, { outcome: completed.error }));
          this.registry.updateStatus(sandboxId, { status: "ready", lastError: completed.error });
          return this.registry.store.getSession(sessionId);
        }
        if (completed.type === "run.cancelled") {
          this.registry.clearRunOutput(runId);
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
        const agentLog = completed.agentLog || this.registry.outputForRun(runId);
        this.registry.clearRunOutput(runId);
        state = mergeAgentState(state, {
          agent_logs: [agentLog],
          last_exit_code: completed.exitCode,
          codex_verdict: completed.codexVerdict ?? state.codex_verdict,
          codex_feedback: completed.codexFeedback ?? state.codex_feedback,
        });
        const artifact = this.registry.store.writeArtifact(sessionId, {
          kind: mode === "review" ? "review" : "command_log",
          title: `${assignment.agent} ${mode} output`,
          body: agentLog,
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
      failSessionIfOpen(
        this.registry.store,
        sessionId,
        error instanceof Error ? error.message : String(error),
      );
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

export { ServerDaemonNodeBackend as ReverseDaemonNodeBackend };

export class LocalSandboxBackend implements SandboxBackend {
  private readonly sandboxes = new Map<string, SandboxRecord>();
  private readonly activeRuns = new Map<string, {
    controller: AbortController;
    sessionController: SessionController;
  }>();
  private readonly store: SessionStore;

  constructor(private readonly options: Pick<RelayDaemonOptions, "store" | "sink" | "execStream" | "withOrchestratorSession" | "ensureAgentReady"> = {}) {
    this.store = options.store ?? new LocalSessionStore();
  }

  async provision(input: { employeeId: string; workspacePath?: string; token?: string }): Promise<SandboxRecord> {
    if (!input.token) throw new Error("Sandbox token is required.");
    const now = new Date().toISOString();
    const tokenHash = hashDaemonNodeToken(input.token);
    const sandbox: SandboxRecord = {
      id: newSandboxId(input.employeeId),
      employeeId: input.employeeId,
      workspacePath: input.workspacePath,
      token: undefined,
      tokenHash,
      uiTokenHash: tokenHash,
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
    return { ...sandbox, token: input.token };
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
      execStream: this.options.execStream ?? defaultExecutionManager.execStream.bind(defaultExecutionManager),
    });
    const sessionId = request.sessionId ?? controller.createSession(
      request.taskGoal,
      ["human", ...new Set(request.assignments.map((item) => item.agent))],
    ).id;
    const abortController = new AbortController();
    const runKey = localRunKey(sandboxId, sessionId);
    this.activeRuns.set(runKey, { controller: abortController, sessionController: controller });
    try {
      await (this.options.withOrchestratorSession ?? withOrchestratorSession)(async () => {
        for (const agent of new Set(request.assignments.map((assignment) => assignment.agent))) {
          await (this.options.ensureAgentReady ?? ensureAgentReady)(agent, this.options.sink, abortController.signal);
        }
        await controller.runAssignments(sessionId, request.taskGoal, request.assignments.map((assignment) => ({
          agent: assignment.agent,
          mode: assignment.mode ?? "implement",
        })), {
          sink: this.options.sink,
          execStream: this.options.execStream ?? defaultExecutionManager.execStream.bind(defaultExecutionManager),
          signal: abortController.signal,
        });
      }, this.options.sink, {
        boxName: sandboxBoxName(sandboxId),
        workspacePath: sandbox.workspacePath,
      });
      this.markAgentsReady(sandboxId, request.assignments.map((assignment) => assignment.agent));
      this.updateSandbox(sandboxId, { status: "ready" });
    } catch (error) {
      if (abortController.signal.aborted) {
        const reason = abortReason(abortController.signal);
        controller.cancelSession(sessionId, reason);
        this.updateSandbox(sandboxId, { status: "ready", lastError: reason });
        return this.store.getSession(sessionId);
      }
      const outcome = error instanceof Error ? error.message : String(error);
      failSessionIfOpen(this.store, sessionId, outcome);
      this.updateSandbox(sandboxId, {
        status: "failed",
        lastError: outcome,
      });
      throw error;
    } finally {
      this.activeRuns.delete(runKey);
    }
    return this.store.getSession(sessionId);
  }

  async cancelRun(sandboxId: string, sessionId: string, reason: string): Promise<RelaySession> {
    const active = this.activeRuns.get(localRunKey(sandboxId, sessionId));
    if (!active) throw new Error(`Session ${sessionId} has no active local sandbox run.`);
    active.controller.abort(reason);
    return active.sessionController.cancelSession(sessionId, reason);
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

function localRunKey(sandboxId: string, sessionId: string): string {
  return `${sandboxId}\0${sessionId}`;
}

function abortReason(signal: AbortSignal): string {
  return typeof signal.reason === "string" && signal.reason ? signal.reason : "Cancelled by human.";
}

function failSessionIfOpen(store: SessionStore, sessionId: string, outcome: string): void {
  try {
    const session = store.getSession(sessionId);
    if (session.status === "completed" || session.status === "failed" || session.status === "cancelled") return;
    store.appendEvent(sessionId, relayEvent("session.failed", sessionId, { outcome }));
  } catch {
    // If the session cannot be read here, preserve the original execution error.
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of request) {
    raw += String(chunk);
    if (raw.length > MAX_JSON_BODY_BYTES) {
      throw new Error(`Request body exceeds ${MAX_JSON_BODY_BYTES} bytes.`);
    }
  }
  if (!raw.trim()) return undefined;
  return JSON.parse(raw);
}

function positiveIntEnv(name: string): number | undefined {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function readJsonFileSafe(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // A torn or corrupt record must not take down every poll that lists the
    // directory; skip it and let the healthy records through.
    return undefined;
  }
}

function writeJsonFileAtomic(path: string, value: unknown, mode?: number): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, mode === undefined ? undefined : { mode });
  renameSync(tmp, path);
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
  const protocolVersion = typeof input.protocolVersion === "number" ? input.protocolVersion : NaN;
  if (!DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion)) {
    throw new Error(
      `daemon node protocolVersion ${String(input.protocolVersion)} is not supported. Supported: ${DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS.join(", ")}.`,
    );
  }
  const token = stringField(input, "token") || authToken || "";
  if (!token) throw new Error("daemon node registration requires a token.");
  return {
    sandboxId,
    employeeId,
    token,
    workspacePath: stringField(input, "workspacePath") || undefined,
    protocolVersion,
    supportedAgents: Array.isArray(input.supportedAgents)
      ? input.supportedAgents.flatMap((item) => agentName(item) ?? [])
      : [],
    status: input.status === "busy" || input.status === "stopped" ? input.status : "ready",
  };
}

function daemonNodeEvent(value: unknown): DaemonNodeEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("daemon node event must be a JSON object.");
  }
  const input = value as Record<string, unknown>;
  const type = stringField(input, "type");
  const commandId = stringField(input, "commandId");
  const sessionId = stringField(input, "sessionId");
  const runId = stringField(input, "runId");
  const agent = agentName(input.agent);
  if (!commandId || !sessionId || !runId || !agent) {
    throw new Error("daemon node event requires commandId, sessionId, runId, and agent.");
  }
  const mode = codexTaskMode(input.mode);
  if (type === "run.output") {
    const stream = input.stream;
    if (stream !== "stdout" && stream !== "stderr") {
      throw new Error(`daemon node run.output stream must be "stdout" or "stderr".`);
    }
    if (typeof input.sequence !== "number" || !Number.isFinite(input.sequence)) {
      throw new Error("daemon node run.output sequence must be a finite number.");
    }
    if (typeof input.text !== "string") {
      throw new Error("daemon node run.output text must be a string.");
    }
    return { type, commandId, sessionId, runId, agent, stream, text: input.text, sequence: input.sequence };
  }
  if (!mode) throw new Error(`daemon node event mode must be "review" or "implement".`);
  if (type === "run.completed") {
    if (typeof input.exitCode !== "number" || !Number.isFinite(input.exitCode)) {
      throw new Error("daemon node run.completed exitCode must be a finite number.");
    }
    const codexVerdictInput = input.codexVerdict;
    const codexVerdict = codexVerdictInput === "approved" || codexVerdictInput === "rejected" || codexVerdictInput === "failed" || codexVerdictInput === "" || codexVerdictInput === undefined
      ? (codexVerdictInput ?? "")
      : (() => { throw new Error(`invalid codexVerdict ${String(codexVerdictInput)}.`); })();
    return {
      type,
      commandId,
      sessionId,
      runId,
      agent,
      mode,
      exitCode: input.exitCode,
      agentLog: stringField(input, "agentLog"),
      codexVerdict,
      codexFeedback: stringField(input, "codexFeedback"),
    };
  }
  if (type === "run.failed") {
    const exitCode = typeof input.exitCode === "number" && Number.isFinite(input.exitCode) ? input.exitCode : undefined;
    return {
      type,
      commandId,
      sessionId,
      runId,
      agent,
      mode,
      error: stringField(input, "error") || "Daemon node command failed.",
      ...(exitCode !== undefined ? { exitCode } : {}),
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
  throw new Error(`unknown daemon node event type ${type}.`);
}

function codexTaskMode(value: unknown): CodexTaskMode | undefined {
  return value === "review" || value === "implement" ? value : undefined;
}

function daemonNodeRouteError(error: unknown): RelayDaemonResponse {
  const message = error instanceof Error ? error.message : String(error);
  if (/unauthorized/i.test(message)) return jsonResponse(401, { error: message });
  if (/unknown sandbox/i.test(message)) return jsonResponse(404, { error: message });
  return jsonResponse(400, { error: message });
}

function bearerToken(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value;
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return match?.[1];
}

function sandboxUiAuthError(sandbox: SandboxRecord, token?: string): string | null {
  if (!sandbox.uiTokenHash && !sandbox.tokenHash && !sandbox.token) {
    return sandbox.nodeTokenHash ? "Sandbox token is required." : null;
  }
  if (!token) return "Sandbox token is required.";
  if (!sandboxUiTokenMatches(sandbox, token)) return "Invalid sandbox token.";
  return null;
}

function sandboxNodeAuthError(sandbox: SandboxRecord, token?: string): string | null {
  if (!sandbox.nodeTokenHash && !sandbox.tokenHash && !sandbox.token) return null;
  if (!token) return "Daemon node token is required.";
  if (!daemonNodeTokenMatches(sandbox, token)) return "Invalid daemon node token.";
  return null;
}

function sandboxesForToken(backend: SandboxBackend, token?: string): SandboxRecord[] | undefined {
  if (!token) return undefined;
  const sandboxes = backend.list().filter((sandbox) => sandboxUiTokenMatches(sandbox, token));
  return sandboxes.length === 0 ? undefined : sandboxes.map(publicSandboxRecord);
}

function handleAuthenticatedSessionRequest(
  registry: DaemonNodeRegistry,
  method: string,
  pathname: string,
  body: unknown,
  authToken?: string,
): RelayDaemonResponse {
  const sandbox = authorizedSandboxForToken(registry, authToken);
  if (!sandbox) return jsonResponse(401, { error: authToken ? "Invalid sandbox token." : "Sandbox token is required." });

  const parts = pathname.split("/").filter(Boolean);
  const taskStore = new LocalTaskStore(dataDirForSessionStore(registry.store));

  if (method === "GET" && parts.length === 1 && parts[0] === "sessions") {
    return jsonResponse(200, {
      sessions: registry.store.listSessions().filter((session) => sessionBelongsToSandbox(session, sandbox)),
    });
  }

  if (method === "POST" && parts.length === 1 && parts[0] === "sessions") {
    const input = asRecord(body);
    const requestedWorkspace = stringField(input, "workspacePath");
    if (sandbox.workspacePath && requestedWorkspace && requestedWorkspace !== sandbox.workspacePath) {
      return jsonResponse(403, { error: "Session workspace does not match the authenticated sandbox." });
    }
    const scopedBody = sandbox.workspacePath && !requestedWorkspace
      ? { ...input, workspacePath: sandbox.workspacePath }
      : body;
    return handleRelayApiRequest(registry.store, method, pathname, scopedBody, taskStore);
  }

  const sessionId = parts[0] === "sessions" ? parts[1] : undefined;
  if (sessionId) {
    let session: RelaySession;
    try {
      session = registry.store.getSession(sessionId);
    } catch {
      return jsonResponse(404, { error: "Session not found." });
    }
    if (!sessionBelongsToSandbox(session, sandbox)) {
      return jsonResponse(403, { error: "Session does not belong to the authenticated sandbox." });
    }
  }

  return handleRelayApiRequest(registry.store, method, pathname, body, taskStore);
}

function authorizedSandboxForToken(registry: DaemonNodeRegistry, token?: string): SandboxRecord | undefined {
  if (!token) return undefined;
  return registry.list().find((sandbox) => sandboxUiTokenMatches(sandbox, token));
}

function sessionBelongsToSandbox(session: RelaySession, sandbox: SandboxRecord): boolean {
  return !sandbox.workspacePath || session.workspacePath === sandbox.workspacePath;
}

function agentsReadyInSandbox(sandbox: SandboxRecord): AgentName[] {
  return (["claude", "pi", "codex"] as const).filter((agent) => sandbox.agents[agent] === "ready");
}

function publicSandboxRecord(sandbox: SandboxRecord): SandboxRecord {
  const { token: _token, tokenHash: _tokenHash, uiTokenHash: _uiTokenHash, nodeTokenHash: _nodeTokenHash, ...publicSandbox } = sandbox;
  return publicSandbox;
}

function provisionedSandboxRecord(sandbox: SandboxRecord): SandboxRecord {
  return {
    ...publicSandboxRecord(sandbox),
    ...(sandbox.token ? { token: sandbox.token } : {}),
  };
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
    uiTokenHash: stringField(input, "uiTokenHash") || undefined,
    nodeTokenHash: stringField(input, "nodeTokenHash") || undefined,
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

function sandboxUiTokenMatches(sandbox: SandboxRecord, token?: string): boolean {
  return sandboxTokenHashMatches(sandbox.uiTokenHash ?? sandbox.tokenHash ?? (sandbox.token ? hashDaemonNodeToken(sandbox.token) : undefined), token);
}

function daemonNodeTokenMatches(sandbox: SandboxRecord, token?: string): boolean {
  return sandboxTokenHashMatches(sandbox.nodeTokenHash ?? sandbox.tokenHash ?? (sandbox.token ? hashDaemonNodeToken(sandbox.token) : undefined), token);
}

function sandboxTokenHashMatches(expected: string | undefined, token?: string): boolean {
  if (!token || !expected) return false;
  const provided = hashDaemonNodeToken(token);
  if (!provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
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

function webUiAssetResponse(parts: string[]): RelayDaemonResponse {
  const distDir = webUiDistDir();
  if (!distDir) {
    return htmlResponse(404, "Relay web UI has not been built. Run `npm run build -w relay-web`.\n");
  }
  const requested = parts.length === 0 ? "index.html" : parts.join("/");
  const fallback = requested.endsWith("/") || !extname(requested);
  const assetPath = safeWebUiAssetPath(distDir, fallback ? `${requested.replace(/\/+$/, "")}/index.html` : requested)
    ?? safeWebUiAssetPath(distDir, requested);
  const indexPath = safeWebUiAssetPath(distDir, "index.html");
  const selectedPath = assetPath && existsSync(assetPath) && statSync(assetPath).isFile()
    ? assetPath
    : fallback && indexPath
      ? indexPath
      : undefined;
  if (!selectedPath || !existsSync(selectedPath) || !statSync(selectedPath).isFile()) {
    return jsonResponse(404, { error: "Web UI asset not found." });
  }
  const contentType = contentTypeForPath(selectedPath);
  if (contentType.startsWith("text/") || contentType.startsWith("application/json")) {
    return {
      status: 200,
      contentType,
      body: readFileSync(selectedPath, "utf8"),
    };
  }
  const bytes = readFileSync(selectedPath);
  return {
    status: 200,
    contentType,
    body: bytes.toString("latin1"),
    bodyBytes: bytes,
  };
}

function webUiDistDir(): string | undefined {
  return WEB_UI_DIST_DIR_CANDIDATES.find((path) => existsSync(path) && statSync(path).isDirectory());
}

function safeWebUiAssetPath(distDir: string, requested: string): string | undefined {
  const assetPath = resolve(distDir, requested);
  if (assetPath !== distDir && !assetPath.startsWith(`${distDir}/`)) return undefined;
  return assetPath;
}

function contentTypeForPath(path: string): string {
  const extension = extname(path);
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".js" || extension === ".mjs") return "text/javascript; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml; charset=utf-8";
  if (extension === ".txt") return "text/plain; charset=utf-8";
  if (extension === ".png") return "image/png";
  if (extension === ".ico") return "image/x-icon";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".woff") return "font/woff";
  if (extension === ".woff2") return "font/woff2";
  return "application/octet-stream";
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
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,300..900,30..100,0..1&family=Instrument+Sans:ital,wght@0,400..700;1,400..700&family=JetBrains+Mono:wght@400;500;600&display=swap">
  <style>
    /* =====================================================================
       Daemon control panel — editorial broadsheet
       Shares the same token vocabulary as relay-web.
       ===================================================================== */
    :root {
      color-scheme: light;
      /* paper canvas */
      --paper:         #f1ebdc;
      --paper-deep:    #ebe3cf;
      --paper-soft:    #f6f1e3;
      --paper-vellum:  #faf6ed;
      /* ink */
      --ink:           #14110d;
      --ink-soft:      #3b342a;
      --ink-mute:      #6a6253;
      --ink-faint:     #95897a;
      /* rules */
      --rule:          #d6cdb5;
      --rule-soft:     #e3dbc4;
      /* accents */
      --oxblood:       #6b1f1d;
      --oxblood-deep:  #4a1614;
      --gold:          #b8821a;
      /* signal */
      --signal-live:   #d1a32c;
      --signal-good:   #2d4a3a;
      --signal-bad:    #8a2a26;
      /* agent tones */
      --tone-claude:   #2d4a3a;
      --tone-pi:       #b8552e;
      --tone-codex:    #1f3556;

      /* legacy aliases (kept for the existing markup/JS) */
      --primary:        var(--oxblood);
      --primary-active: var(--oxblood-deep);
      --body:           var(--ink-soft);
      --muted:          var(--ink-mute);
      --muted-soft:     var(--ink-faint);
      --hairline:       var(--rule);
      --hairline-soft:  var(--rule-soft);
      --canvas:         var(--paper);
      --surface-soft:   var(--paper-soft);
      --surface-strong: var(--paper-deep);
      --surface-dark:   var(--ink);
      --surface-dark-elevated: var(--ink-soft);
      --on-dark:        var(--paper);
      --on-dark-soft:   var(--paper-soft);
      --up:             var(--signal-good);
      --down:           var(--signal-bad);

      /* type stacks */
      --font-display: "Fraunces", Georgia, serif;
      --font-body:    "Instrument Sans", ui-sans-serif, system-ui, sans-serif;
      --font-num:     "JetBrains Mono", ui-monospace, monospace;
    }

    * { box-sizing: border-box; }

    html, body { margin: 0; }

    body {
      min-height: 100vh;
      background: var(--paper);
      color: var(--ink);
      font-family: var(--font-body);
      font-size: 15px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
      background-image:
        radial-gradient(1400px 700px at 6% -10%, rgba(184,130,26,0.07), transparent 60%),
        radial-gradient(1000px 600px at 110% 110%, rgba(107,31,29,0.05), transparent 60%),
        url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.08  0 0 0 0 0.07  0 0 0 0 0.05  0 0 0 .35 0'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='.16'/></svg>");
      background-attachment: fixed;
    }

    ::selection { background: var(--ink); color: var(--paper); }

    .mono {
      font-family: var(--font-num);
      font-feature-settings: "tnum" 1;
      font-weight: 500;
      letter-spacing: 0;
    }

    /* Top nav — masthead ---------------------------------------------- */

    .top-nav {
      height: 64px;
      padding: 0 32px;
      border-bottom: 1px solid var(--rule);
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      background: transparent;
    }

    .wordmark {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--ink);
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }

    .wordmark .dot {
      width: 8px;
      height: 8px;
      border-radius: 9999px;
      background: var(--primary);
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
      padding: 32px 0 40px;
    }

    .hero {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--rule);
      margin-bottom: 24px;
    }

    .hero-left {
      display: grid;
      gap: 6px;
    }

    .eyebrow {
      display: inline-block;
      font-family: var(--font-num);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      color: var(--ink-mute);
      padding: 0;
      background: transparent;
    }

    h1 {
      margin: 0;
      font-family: var(--font-display);
      font-style: italic;
      font-weight: 400;
      font-size: 56px;
      line-height: 0.92;
      letter-spacing: -0.03em;
      color: var(--ink);
      font-variation-settings: "opsz" 144, "SOFT" 80, "WONK" 1;
    }

    .refresh {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 6px 12px;
      border: 1px solid var(--rule);
      border-radius: 2px;
      background: var(--paper-vellum);
      color: var(--ink-soft);
      font-family: var(--font-num);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .refresh .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--signal-good);
      box-shadow: 0 0 0 3px rgba(45, 74, 58, 0.15);
      flex: none;
    }

    .refresh.offline .dot {
      background: var(--signal-bad);
      box-shadow: 0 0 0 3px rgba(138, 42, 38, 0.15);
    }

    /* Metric strip — broadsheet ledger ------------------------------- */

    .metrics {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 0;
      border-top: 2px solid var(--ink);
      border-bottom: 1px solid var(--rule);
      padding: 16px 0 18px;
      margin-bottom: 28px;
      position: relative;
    }
    .metrics::before {
      content: "";
      position: absolute;
      top: -6px; left: 0; right: 0;
      border-top: 1px solid var(--rule);
    }

    .metric {
      display: grid;
      gap: 6px;
      padding: 0 20px;
      border-left: 1px solid var(--rule);
    }

    .metric:first-child { border-left: 0; padding-left: 0; }

    .metric-label {
      color: var(--ink-mute);
      font-family: var(--font-num);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.22em;
      text-transform: uppercase;
    }

    .metric-value {
      font-family: var(--font-num);
      font-size: 38px;
      font-weight: 500;
      letter-spacing: -0.02em;
      line-height: 1;
      color: var(--ink);
      font-feature-settings: "tnum" 1;
    }

    .metric-value.ready   { color: var(--signal-good); }
    .metric-value.running { color: var(--oxblood); }
    .metric-value.failed  { color: var(--signal-bad); }

    /* Columns — broadsheet ------------------------------------------- */

    .columns {
      display: grid;
      grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
      gap: 32px;
      align-items: start;
    }

    .stack {
      display: flex;
      flex-direction: column;
      gap: 28px;
      min-width: 0;
    }

    section.block { min-width: 0; }

    .block-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--ink);
    }

    .block-head h2 {
      margin: 0;
      font-family: var(--font-display);
      font-style: italic;
      font-size: 22px;
      font-weight: 500;
      line-height: 1.1;
      letter-spacing: -0.015em;
      color: var(--ink);
      font-variation-settings: "opsz" 48, "SOFT" 60, "WONK" 1;
    }

    .count {
      color: var(--ink-mute);
      font-family: var(--font-num);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.22em;
      text-transform: uppercase;
    }

    /* Node table — hairline newspaper -------------------------------- */

    .table-card {
      background: transparent;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    thead th {
      padding: 6px 12px;
      text-align: left;
      border-bottom: 1px solid var(--ink);
      background: transparent;
      color: var(--ink-mute);
      font-family: var(--font-num);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.22em;
      text-transform: uppercase;
    }

    tbody td {
      padding: 14px 12px;
      border-bottom: 1px solid var(--rule-soft);
      vertical-align: middle;
      font-family: var(--font-body);
      font-size: 13px;
      color: var(--ink);
    }

    tbody tr:last-child td { border-bottom: 1px solid var(--rule); }
    tbody tr:hover { background: rgba(20, 17, 13, 0.03); }

    .col-node { width: 36%; }
    .col-status { width: 18%; }
    .col-agents { width: 26%; }
    .col-meta { width: 20%; text-align: right; }

    .node-name {
      display: block;
      font-family: var(--font-display);
      font-style: italic;
      font-size: 18px;
      font-weight: 500;
      color: var(--ink);
      line-height: 1.15;
      letter-spacing: -0.01em;
      font-variation-settings: "opsz" 24, "SOFT" 60, "WONK" 1;
    }

    .node-id {
      display: block;
      margin-top: 4px;
      font-family: var(--font-num);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.08em;
      color: var(--ink-mute);
      word-break: break-all;
      line-height: 1.3;
    }

    .meta-time {
      display: block;
      font-family: var(--font-num);
      font-size: 12px;
      font-weight: 500;
      color: var(--ink);
      line-height: 1.2;
    }

    .meta-sub {
      display: block;
      margin-top: 4px;
      font-family: var(--font-num);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--ink-mute);
    }

    /* Status pill ----------------------------------------------------- */

    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      border: 1px solid var(--rule);
      border-radius: 2px;
      background: var(--paper-vellum);
      color: var(--ink-soft);
      font-family: var(--font-num);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.2em;
      text-transform: uppercase;
    }

    .status::before {
      content: "";
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--ink-faint);
      flex: none;
    }

    .status.ready { color: var(--signal-good); border-color: rgba(45, 74, 58, 0.3); }
    .status.ready::before { background: var(--signal-good); }
    .status.running, .status.provisioning {
      color: var(--oxblood);
      border-color: rgba(107, 31, 29, 0.3);
    }
    .status.running::before, .status.provisioning::before { background: var(--oxblood); }
    .status.failed, .status.stale {
      color: var(--signal-bad);
      border-color: rgba(138, 42, 38, 0.35);
    }
    .status.failed::before, .status.stale::before { background: var(--signal-bad); }

    .status.running::before {
      animation: pulse 1.6s ease-in-out infinite;
      box-shadow: 0 0 0 3px rgba(107, 31, 29, 0.18);
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    /* Agent chips — tone-coded --------------------------------------- */

    .agents {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .agent {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      border: 1px solid var(--rule);
      border-radius: 2px;
      background: transparent;
      color: var(--ink-soft);
      font-family: var(--font-num);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }

    .agent::before {
      content: "";
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--ink-faint);
      flex: none;
    }

    .agent.ready { color: var(--ink); border-color: var(--ink); }
    .agent.ready::before  { background: var(--signal-good); }
    .agent.failed { color: var(--signal-bad); border-color: rgba(138, 42, 38, 0.35); }
    .agent.failed::before { background: var(--signal-bad); }

    /* Side cards (runs + attention) — column inches ------------------ */

    .card-grid {
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .feature-card {
      background: transparent;
      border: 0;
      border-bottom: 1px solid var(--rule-soft);
      padding: 14px 0;
      position: relative;
    }
    .feature-card:last-child { border-bottom: 1px solid var(--rule); }
    .feature-card::before {
      content: "";
      position: absolute;
      left: -10px; top: 18px;
      width: 4px; height: 4px;
      border-radius: 50%;
      background: var(--oxblood);
    }

    .feature-card .row-title {
      margin: 0 0 4px;
      font-family: var(--font-display);
      font-style: italic;
      font-size: 17px;
      font-weight: 500;
      line-height: 1.2;
      letter-spacing: -0.01em;
      color: var(--ink);
      font-variation-settings: "opsz" 24, "SOFT" 60, "WONK" 1;
    }

    .feature-card .row-meta {
      margin: 0 0 6px;
      font-family: var(--font-num);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.12em;
      color: var(--ink-mute);
      word-break: break-all;
      line-height: 1.4;
      text-transform: uppercase;
    }

    .feature-card .row-body {
      margin: 0;
      color: var(--ink-soft);
      font-family: var(--font-display);
      font-size: 14px;
      line-height: 1.5;
    }

    .empty {
      padding: 22px;
      border: 1px dashed var(--rule);
      border-radius: 2px;
      color: var(--ink-mute);
      font-family: var(--font-display);
      font-style: italic;
      font-size: 14px;
      text-align: center;
    }

    /* Responsive ------------------------------------------------------ */

    @media (max-width: 1024px) {
      .columns { grid-template-columns: 1fr; }
    }

    @media (max-width: 720px) {
      main { padding: 20px 0 24px; }
      .top-nav { padding: 0 16px; height: 56px; }
      .hero { flex-direction: column; align-items: flex-start; gap: 12px; margin-bottom: 18px; }
      h1 { font-size: 40px; }
      .metrics { grid-template-columns: repeat(2, 1fr); row-gap: 16px; padding: 14px 0; }
      .metric { padding: 0 14px; }
      .metric:nth-child(odd) { border-left: 0; padding-left: 0; }
      .metric-value { font-size: 28px; }
      thead { display: none; }
      tbody tr { display: block; padding: 12px 0; border-bottom: 1px solid var(--rule-soft); }
      tbody tr:last-child { border-bottom: 0; }
      tbody td { display: block; width: auto !important; padding: 4px 0; border: 0; text-align: left !important; }
      .col-meta { text-align: left; }
    }
  </style>
</head>
<body>
  <nav class="top-nav">
    <span class="wordmark"><span class="dot" aria-hidden="true"></span>Relay</span>
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
          <h2>The roster</h2>
          <span class="count" id="nodeCount">0 nodes</span>
        </div>
        <div class="table-card" id="nodeTable"></div>
      </section>

      <div class="stack">
        <section class="block">
          <div class="block-head">
            <h2>In progress</h2>
            <span class="count" id="runCount">0 running</span>
          </div>
          <div class="card-grid" id="activeRuns"></div>
        </section>

        <section class="block">
          <div class="block-head">
            <h2>Wants attention</h2>
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
