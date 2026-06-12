import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS } from "relay-core";
import type {
  CodexTaskMode,
  DaemonNodeEvent,
  DaemonNodeRegistration,
} from "relay-core";
import {
  DEFAULT_RELAY_DATA_DIR,
  LocalSessionStore,
  type RelaySession,
  type SessionStore,
} from "./session.js";
import { LocalTaskStore, type TaskStore } from "./task.js";
import { handleRelayApiRequest } from "./server.js";
import { createPostgresStoreSet } from "./postgres-store.js";
import type {
  RelayDaemonOptions,
  RelayDaemonResponse,
  SandboxBackend,
  SandboxRecord,
  SandboxRunAssignment,
  SandboxRunRequest,
} from "./daemon-types.js";
import {
  DaemonNodeRegistry,
  agentName,
  asRecord,
  daemonNodeTokenMatches,
  publicSandboxRecord,
  provisionedSandboxRecord,
  sandboxNodeAuthError,
  sandboxUiAuthError,
  sandboxUiTokenMatches,
  stringField,
  workspacePathsMatch,
} from "./daemon-registry.js";
import { ServerDaemonNodeBackend } from "./daemon-backends.js";
import {
  CONTROL_PANEL_VERSION,
  daemonControlPanelHtml,
  htmlResponse,
  webUiAssetResponse,
  WEB_UI_PATH,
} from "./daemon-control-panel.js";

const MAX_JSON_BODY_BYTES = 10 * 1024 * 1024;

export interface RelayDaemonRuntime {
  backend: SandboxBackend;
  daemonNodeRegistry: DaemonNodeRegistry;
  ready: Promise<void>;
  taskStore: TaskStore;
}

export async function serveRelayDaemon(options: RelayDaemonOptions = {}): Promise<Server> {
  const { backend, daemonNodeRegistry, ready, taskStore } = createRelayDaemonRuntime(options);
  await ready;
  const port = options.port ?? 8790;
  const host = options.host ?? "127.0.0.1";
  const server = createServer((request, response) => {
    void routeDaemonRequest(backend, request, response, daemonNodeRegistry, taskStore).catch((error: unknown) => {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      const baseUrl = `http://${host}:${port}`;
      console.log(`Relay backend listening on ${baseUrl}`);
      console.log(`Relay backend control panel: ${baseUrl}/cp`);
      console.log(`Relay web UI: ${baseUrl}${WEB_UI_PATH}`);
      resolve();
    });
  });
  return server;
}

export function createRelayDaemonRuntime(options: RelayDaemonOptions = {}): RelayDaemonRuntime {
  const defaults = shouldUsePostgresDefaults(options) ? createPostgresStoreSet() : undefined;
  const store = options.store ?? defaults?.sessionStore ?? new LocalSessionStore();
  const taskStore = options.taskStore ?? defaults?.taskStore ?? new LocalTaskStore();
  const daemonStore = options.daemonStore ?? defaults?.daemonStore;
  const daemonNodeRegistry = new DaemonNodeRegistry(store, daemonStore);
  const backend = options.backend ?? new ServerDaemonNodeBackend(daemonNodeRegistry);
  return { backend, daemonNodeRegistry, ready: defaults?.storage.ready ?? Promise.resolve(), taskStore };
}

// Postgres becomes the default storage only when DATABASE_URL is configured;
// otherwise the backend stays local-first with file-backed stores.
export function shouldUsePostgresDefaults(options: RelayDaemonOptions, env: NodeJS.ProcessEnv = process.env): boolean {
  return !options.store && !options.taskStore && !options.daemonStore && Boolean(env.DATABASE_URL?.trim());
}

export async function routeDaemonRequest(
  backend: SandboxBackend,
  request: IncomingMessage,
  response: ServerResponse,
  serverRegistry?: DaemonNodeRegistry,
  taskStore?: TaskStore,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://relay-daemon.local");
  const body = method === "GET" ? undefined : await readJsonBody(request);
  const authToken = bearerToken(request.headers.authorization);
  const routed = await handleRelayDaemonRequest(backend, method, url.pathname, body, serverRegistry, authToken, taskStore);
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
  taskStore?: TaskStore,
): Promise<RelayDaemonResponse> {
  const parts = pathname.split("/").filter(Boolean);
  if (method === "GET" && parts.length === 1 && parts[0] === "cp") {
    return htmlResponse(200, daemonControlPanelHtml());
  }
  if (method === "GET" && parts.length === 2 && parts[0] === "cp" && parts[1] === "version") {
    return jsonResponse(200, { version: CONTROL_PANEL_VERSION });
  }
  if (method === "GET" && parts.length === 2 && parts[0] === "cp" && parts[1] === "daemon-nodes") {
    if (!serverRegistry) return jsonResponse(404, { error: "Server mode daemon node registry is not enabled." });
    return jsonResponse(200, { nodes: await serverRegistry.controlPanelNodes() });
  }
  if (method === "GET" && parts[0] === "web") {
    return webUiAssetResponse(parts.slice(1));
  }
  if (method === "GET" && parts.length === 0) {
    return jsonResponse(200, {
      name: "Relay backend",
      ui: true,
      uiPath: "/cp",
      webUiPath: WEB_UI_PATH,
      endpoints: [
        "GET /sandboxes",
        "POST /sandboxes",
        "GET /sandboxes/:id",
        "POST /sandboxes/:id/runs",
        "GET /cp",
        "GET /cp/version",
        "GET /cp/daemon-nodes",
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
    const nodes = await serverRegistry.monitorNodesForToken(authToken);
    if (!nodes) return jsonResponse(401, { error: authToken ? "Invalid sandbox token." : "Sandbox token is required." });
    return jsonResponse(200, { nodes });
  }
  if (method === "POST" && parts.length === 2 && isDaemonNodeRoute && parts[1] === "register") {
    if (!serverRegistry) return jsonResponse(404, { error: "Server mode daemon node registry is not enabled." });
    try {
      return jsonResponse(200, await serverRegistry.register(daemonNodeRegistration(body, authToken)));
    } catch (error) {
      return daemonNodeRouteError(error);
    }
  }
  if (method === "GET" && parts.length === 3 && isDaemonNodeRoute && parts[2] === "commands") {
    if (!serverRegistry) return jsonResponse(404, { error: "Server mode daemon node registry is not enabled." });
    try {
      return jsonResponse(200, { commands: await serverRegistry.takeCommands(parts[1], authToken) });
    } catch (error) {
      return daemonNodeRouteError(error);
    }
  }
  if (method === "POST" && parts.length === 3 && isDaemonNodeRoute && parts[2] === "events") {
    if (!serverRegistry) return jsonResponse(404, { error: "Server mode daemon node registry is not enabled." });
    try {
      await serverRegistry.handleEvent(parts[1], daemonNodeEvent(body), authToken);
    } catch (error) {
      return daemonNodeRouteError(error);
    }
    return jsonResponse(202, { ok: true });
  }
  if (parts[0] === "sessions") {
    if (!serverRegistry) return jsonResponse(404, { error: "Session store is not available." });
    return handleAuthenticatedSessionRequest(serverRegistry, method, pathname, body, authToken, taskStore);
  }
  if (method === "GET" && parts.length === 1 && parts[0] === "sandboxes") {
    const sandboxes = await sandboxesForToken(backend, authToken);
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
    const sandbox = await backend.get(parts[1]);
    if (!sandbox) return jsonResponse(404, { error: "Sandbox not found." });
    const authError = sandboxUiAuthError(sandbox, authToken);
    if (authError) return jsonResponse(401, { error: authError });
    return jsonResponse(200, publicSandboxRecord(sandbox));
  }
  if (method === "POST" && parts.length === 3 && parts[0] === "sandboxes" && parts[2] === "runs") {
    const sandbox = await backend.get(parts[1]);
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
    const sandbox = await backend.get(parts[1]);
    if (!sandbox) return jsonResponse(404, { error: "Sandbox not found." });
    const authError = sandboxUiAuthError(sandbox, authToken);
    if (authError) return jsonResponse(401, { error: authError });
    if (!backend.cancelRun) return jsonResponse(400, { error: "Sandbox backend does not support cancellation." });
    const input = asRecord(body);
    return jsonResponse(202, await backend.cancelRun(parts[1], parts[3], stringField(input, "reason") || "Cancelled by human."));
  }
  return jsonResponse(404, { error: "Not found" });
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
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

export function jsonResponse(status: number, body: unknown): RelayDaemonResponse {
  return {
    status,
    contentType: "application/json; charset=utf-8",
    body: `${JSON.stringify(body, null, 2)}\n`,
  };
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

async function sandboxesForToken(backend: SandboxBackend, token?: string): Promise<SandboxRecord[] | undefined> {
  if (!token) return undefined;
  const sandboxes = (await backend.list()).filter((sandbox) => sandboxUiTokenMatches(sandbox, token));
  return sandboxes.length === 0 ? undefined : sandboxes.map(publicSandboxRecord);
}

async function handleAuthenticatedSessionRequest(
  registry: DaemonNodeRegistry,
  method: string,
  pathname: string,
  body: unknown,
  authToken?: string,
  taskStore?: TaskStore,
): Promise<RelayDaemonResponse> {
  const sandbox = await authorizedSandboxForToken(registry, authToken);
  if (!sandbox) return jsonResponse(401, { error: authToken ? "Invalid sandbox token." : "Sandbox token is required." });

  const parts = pathname.split("/").filter(Boolean);
  const effectiveTaskStore = taskStore ?? new LocalTaskStore(dataDirForSessionStore(registry.store));

  if (method === "GET" && parts.length === 1 && parts[0] === "sessions") {
    const sessions = await registry.store.listSessions();
    return jsonResponse(200, {
      sessions: sessions.filter((session) => sessionBelongsToSandbox(session, sandbox)),
    });
  }

  if (method === "POST" && parts.length === 1 && parts[0] === "sessions") {
    const input = asRecord(body);
    const requestedWorkspace = stringField(input, "workspacePath");
    if (sandbox.workspacePath && requestedWorkspace && !workspacePathsMatch(sandbox.workspacePath, requestedWorkspace)) {
      return jsonResponse(403, { error: "Session workspace does not match the authenticated sandbox." });
    }
    const scopedBody = sandbox.workspacePath && !requestedWorkspace
      ? { ...input, workspacePath: sandbox.workspacePath }
      : body;
    return handleRelayApiRequest(registry.store, effectiveTaskStore, method, pathname, scopedBody);
  }

  const sessionId = parts[0] === "sessions" ? parts[1] : undefined;
  if (sessionId) {
    let session: RelaySession;
    try {
      session = await registry.store.getSession(sessionId);
    } catch {
      return jsonResponse(404, { error: "Session not found." });
    }
    if (!sessionBelongsToSandbox(session, sandbox)) {
      return jsonResponse(403, { error: "Session does not belong to the authenticated sandbox." });
    }
  }

  return handleRelayApiRequest(registry.store, effectiveTaskStore, method, pathname, body);
}

async function authorizedSandboxForToken(registry: DaemonNodeRegistry, token?: string): Promise<SandboxRecord | undefined> {
  if (!token) return undefined;
  return (await registry.listReady()).find((sandbox) => sandboxUiTokenMatches(sandbox, token));
}

function sessionBelongsToSandbox(session: RelaySession, sandbox: SandboxRecord): boolean {
  return !sandbox.workspacePath || workspacePathsMatch(session.workspacePath, sandbox.workspacePath);
}

function dataDirForSessionStore(store: SessionStore): string {
  return store instanceof LocalSessionStore ? store.rootDir : DEFAULT_RELAY_DATA_DIR;
}
