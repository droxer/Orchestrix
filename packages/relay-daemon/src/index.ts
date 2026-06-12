import { spawn } from "node:child_process";
import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type {
  DaemonNodeCommand,
  DaemonNodeEvent,
  DaemonNodeRegistration,
  DaemonNodeRunCommand,
  AgentName,
  CodexTaskMode,
  StreamExecResult,
} from "relay-core";
import { startOrchestratorSession, ensureAgentReady as ensureSandboxAgentReady, type ActiveOrchestratorSession } from "./sandbox-session.js";
import { defaultExecutionManager } from "./execution.js";
import {
  claudeImplementNode,
  codexImplementNode,
  codexReviewNode,
  piImplementNode,
  initialAgentState,
  mergeAgentState,
  guestCodexAuthJson,
  guestCodexConfigToml,
  guestPiAuthJson,
  guestPiModelsJson,
  ensureDaemonNodeToken,
  GUEST_WORKSPACE,
  agentHomePath,
  openaiApiKey,
  DAEMON_NODE_PROTOCOL_VERSION,
} from "relay-core";

export type DaemonSandboxMode = "none" | "boxlite";

export interface DaemonRuntimeOptions {
  backendUrl?: string;
  sandboxId?: string;
  /**
   * How agent CLIs are executed: "boxlite" boots a BoxLite VM owned by this
   * daemon and runs agents inside the guest; "none" runs them as local
   * processes (for daemons that already live inside a sandbox).
   */
  sandbox?: DaemonSandboxMode;
  employeeId?: string;
  workspacePath?: string;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  fetchFn?: typeof fetch;
  token?: string;
  logDir?: string;
  logger?: DaemonLogger;
}

export interface DaemonLogFields {
  sandboxId?: string;
  commandId?: string;
  sessionId?: string;
  runId?: string;
  agent?: AgentName;
  mode?: CodexTaskMode;
  stream?: "stdout" | "stderr";
  sequence?: number;
  exitCode?: number;
  text?: string;
  error?: string;
  [key: string]: unknown;
}

export interface DaemonLogger {
  readonly logPath?: string;
  info(message: string, fields?: DaemonLogFields): void;
  warn(message: string, fields?: DaemonLogFields): void;
  error(message: string, fields?: DaemonLogFields): void;
  output(fields: DaemonLogFields & { text: string; stream: "stdout" | "stderr" }): void;
}

export async function runRelayDaemon(options: DaemonRuntimeOptions = {}): Promise<void> {
  const backendUrl = normalizeBaseUrl(options.backendUrl ?? process.env.RELAY_BACKEND_URL ?? process.env.RELAY_DAEMON_URL ?? "http://127.0.0.1:8790");
  const sandboxId = options.sandboxId ?? process.env.RELAY_SANDBOX_ID;
  if (!sandboxId) throw new Error("RELAY_SANDBOX_ID is required for the relay daemon.");
  const employeeId = options.employeeId ?? process.env.RELAY_EMPLOYEE_ID ?? process.env.USER ?? "local";
  const workspacePath = firstNonBlank(options.workspacePath, process.env.RELAY_WORKSPACE, process.env.WORKSPACE) ?? process.cwd();
  const sandboxMode = resolveSandboxMode(options.sandbox ?? process.env.RELAY_SANDBOX_MODE);
  if (sandboxMode === "boxlite") {
    // Agent commands run inside the BoxLite guest, where the host workspace
    // is mounted at GUEST_WORKSPACE.
    process.env.RELAY_AGENT_WORKSPACE = GUEST_WORKSPACE;
  } else {
    process.env.RELAY_AGENT_WORKSPACE = workspacePath;
    if (workspacePath !== GUEST_WORKSPACE) {
      process.env.RELAY_RUN_AS_CURRENT_USER ??= "1";
      process.env.RELAY_AGENT_HOME ??= join(workspacePath, ".relay", "daemon-node-home");
    }
  }
  const tokenResolution = ensureDaemonNodeToken({
    workspacePath,
    employeeId,
    token: options.token ?? process.env.RELAY_DAEMON_TOKEN ?? process.env.RELAY_DAEMON_NODE_TOKEN,
  });
  const token = tokenResolution.token;
  const fetchFn = options.fetchFn ?? fetch;
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const logger = options.logger ?? createDaemonLogger({
    workspacePath,
    sandboxId,
    logDir: options.logDir,
  });
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? positiveIntEnv("RELAY_DAEMON_HEARTBEAT_MS") ?? positiveIntEnv("RELAY_DAEMON_NODE_HEARTBEAT_MS") ?? 30_000;
  const environment = createExecutionEnvironment(sandboxMode, sandboxId, workspacePath, logger);
  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info("daemon stopping", { sandboxId, signal });
    void environment.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  logger.info("daemon starting", { sandboxId, employeeId, workspacePath, backendUrl, sandboxMode });
  const activeRuns = new Map<string, AbortController>();
  const buildRegistration = (): DaemonNodeRegistration => ({
    sandboxId,
    employeeId,
    token,
    workspacePath,
    protocolVersion: DAEMON_NODE_PROTOCOL_VERSION,
    supportedAgents: ["claude", "pi", "codex"],
    status: activeRuns.size > 0 ? "busy" : "ready",
  });
  const register = (): Promise<void> =>
    postJson(fetchFn, `${backendUrl}/daemon-nodes/register`, buildRegistration());
  await withBackendReconnect(register, logger, { sandboxId, what: "registration" });
  let lastRegisteredAt = Date.now();
  logger.info("daemon registered", { sandboxId, employeeId, workspacePath, backendUrl, logPath: logger.logPath });
  console.log(`Relay daemon registered sandbox ${sandboxId} with backend at ${backendUrl} (sandbox: ${sandboxMode})`);
  if (logger.logPath) console.log(`Relay daemon log: ${logger.logPath}`);
  if (tokenResolution.source === "generated" && tokenResolution.path) {
    logger.info("daemon generated token", { sandboxId, employeeId, path: tokenResolution.path });
    console.log(`Relay daemon generated token for ${employeeId}: ${tokenResolution.path}`);
  }

  while (true) {
    const body = await withBackendReconnect(async () => {
      // Heartbeat re-registration keeps a restarted backend current on this
      // node's agent roster and busy/ready status without waiting for a poll
      // rejection.
      if (Date.now() - lastRegisteredAt >= heartbeatIntervalMs) {
        await register();
        lastRegisteredAt = Date.now();
      }
      const response = await getJson(fetchFn, `${backendUrl}/daemon-nodes/${encodeURIComponent(sandboxId)}/commands`, token);
      if (!response.ok) {
        // The backend may have restarted with fresh state or demoted this node;
        // re-register before treating the rejection as fatal.
        const detail = `Command poll failed: ${response.status} ${await response.text()}`;
        logger.warn("command poll rejected; re-registering", { sandboxId, error: detail });
        await register();
        lastRegisteredAt = Date.now();
        logger.info("daemon re-registered", { sandboxId });
        return { commands: [] };
      }
      return await response.json() as { commands?: DaemonNodeCommand[] };
    }, logger, { sandboxId, what: "command poll" });
    for (const command of body.commands ?? []) {
      if (command.type === "run.start") {
        logger.info("command received", commandLogFields(sandboxId, command));
        const controller = new AbortController();
        activeRuns.set(command.id, controller);
        void executeCommand(backendUrl, sandboxId, token, command, fetchFn, logger, workspacePath, environment, controller.signal).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          logger.error("command failed before completion", { ...commandLogFields(sandboxId, command), error: message });
          return postJson(fetchFn, `${backendUrl}/daemon-nodes/${encodeURIComponent(sandboxId)}/events`, {
            type: "run.failed",
            commandId: command.id,
            sessionId: command.sessionId,
            runId: command.runId,
            agent: command.agent,
            mode: command.mode,
            error: message,
          } satisfies DaemonNodeEvent, token);
        }).finally(() => {
          activeRuns.delete(command.id);
        });
      } else if (command.type === "run.cancel") {
        logger.info("cancel command received", {
          sandboxId,
          commandId: command.commandId,
          sessionId: command.sessionId,
          runId: command.runId,
          agent: command.agent,
          mode: command.mode,
        });
        activeRuns.get(command.commandId)?.abort(command.reason);
      }
    }
    await delay(pollIntervalMs);
  }
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value?.trim());
}

async function executeCommand(
  backendUrl: string,
  sandboxId: string,
  token: string,
  command: DaemonNodeRunCommand,
  fetchFn: typeof fetch,
  logger: DaemonLogger,
  nodeWorkspacePath: string,
  environment: DaemonExecutionEnvironment,
  signal?: AbortSignal,
): Promise<void> {
  const eventUrl = `${backendUrl}/daemon-nodes/${encodeURIComponent(sandboxId)}/events`;
  const state = command.state ?? initialAgentState(command.taskGoal);
  logger.info("run starting", commandLogFields(sandboxId, command));
  if (command.workspacePath && !workspacePathsMatch(command.workspacePath, nodeWorkspacePath)) {
    throw new Error(
      `Daemon workspace mismatch: command expects ${command.workspacePath} but this daemon serves ${nodeWorkspacePath}.`,
    );
  }
  await environment.ensureAgentReady(command.agent, signal);
  if (signal?.aborted) {
    await postRunCancelled(fetchFn, eventUrl, command, token, signal.reason);
    return;
  }
  logger.info("agent ready", commandLogFields(sandboxId, command));
  let outputSequence = 0;
  let outputPostChain: Promise<void> = Promise.resolve();
  let outputPostFailure: Error | undefined;
  const eventSink = {
    agentOutput: (_runId: string, agent: AgentName, stream: "stdout" | "stderr", text: string): void => {
      const sequence = outputSequence++;
      logger.output({
        ...commandLogFields(sandboxId, command),
        agent,
        stream,
        text,
        sequence,
      });
      outputPostChain = outputPostChain.then(async () => {
        if (outputPostFailure) return;
        try {
          await postJsonWithRetry(fetchFn, eventUrl, {
            type: "run.output",
            commandId: command.id,
            sessionId: command.sessionId,
            runId: command.runId,
            agent,
            stream,
            text,
            sequence,
          } satisfies DaemonNodeEvent, token, signal);
        } catch (error) {
          outputPostFailure = error instanceof Error ? error : new Error(String(error));
          logger.error("event post exhausted retries", {
            ...commandLogFields(sandboxId, command),
            agent,
            stream,
            sequence,
            error: outputPostFailure.message,
          });
        }
      });
    },
  };
  const options = {
    execStream: environment.execStream,
    eventSink,
    runId: command.runId,
    agent: command.agent,
    signal,
  };
  const patch = command.agent === "claude"
    ? await claudeImplementNode(state, options)
    : command.agent === "pi"
      ? await piImplementNode(state, options)
      : command.mode === "review"
        ? await codexReviewNode(state, options)
        : await codexImplementNode(state, options);
  const next = mergeAgentState(state, patch);
  await outputPostChain;
  if (signal?.aborted) {
    logger.info("run cancelled", {
      ...commandLogFields(sandboxId, command),
      exitCode: next.last_exit_code,
    });
    await postRunCancelled(fetchFn, eventUrl, command, token, signal.reason);
    return;
  }
  if (outputPostFailure) {
    throw new Error(`Daemon lost agent output: ${outputPostFailure.message}`);
  }
  logger.info("run completed", {
    ...commandLogFields(sandboxId, command),
    exitCode: next.last_exit_code,
    codexVerdict: next.codex_verdict,
    agentLogBytes: next.agent_logs.slice(-1)[0]?.length ?? 0,
  });
  await postJson(fetchFn, eventUrl, {
    type: "run.completed",
    commandId: command.id,
    sessionId: command.sessionId,
    runId: command.runId,
    agent: command.agent,
    mode: command.mode,
    exitCode: next.last_exit_code,
    agentLog: next.agent_logs.slice(-1)[0] ?? "",
    codexVerdict: next.codex_verdict,
    codexFeedback: next.codex_feedback,
  } satisfies DaemonNodeEvent, token);
}

async function postRunCancelled(
  fetchFn: typeof fetch,
  eventUrl: string,
  command: DaemonNodeRunCommand,
  token: string,
  reason: unknown,
): Promise<void> {
  await postJson(fetchFn, eventUrl, {
    type: "run.cancelled",
    commandId: command.id,
    sessionId: command.sessionId,
    runId: command.runId,
    agent: command.agent,
    mode: command.mode,
    reason: typeof reason === "string" && reason ? reason : "Cancelled by human.",
  } satisfies DaemonNodeEvent, token);
}

function ensureHostAgentReady(agent: AgentName): void {
  // Auth material is written directly from this process; never pass it
  // through a shell where it would be visible in the process table.
  const home = agentHomePath();
  if (agent === "codex") {
    const apiKey = openaiApiKey();
    if (!apiKey) throw new Error("OPENAI_API_KEY or CODEX_API_KEY is required for Codex daemon runs.");
    const codexHome = join(home, ".codex");
    mkdirSync(codexHome, { recursive: true });
    writeSecretFile(join(codexHome, "auth.json"), guestCodexAuthJson(apiKey));
    writeFileSync(join(codexHome, "config.toml"), guestCodexConfigToml());
  }
  if (agent === "pi") {
    const piHome = join(home, ".pi", "agent");
    mkdirSync(piHome, { recursive: true });
    writeSecretFile(join(piHome, "auth.json"), guestPiAuthJson());
    writeFileSync(join(piHome, "models.json"), guestPiModelsJson());
  }
}

function writeSecretFile(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export interface DaemonExecutionEnvironment {
  readonly sandboxMode: DaemonSandboxMode;
  ensureAgentReady(agent: AgentName, signal?: AbortSignal): Promise<void>;
  execStream: typeof localProcessExecStream;
  close(): Promise<void>;
}

export function resolveSandboxMode(value: string | undefined): DaemonSandboxMode {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "none") return "none";
  if (trimmed === "boxlite") return "boxlite";
  throw new Error(`Unknown sandbox mode ${JSON.stringify(trimmed)}. Use "boxlite" or "none".`);
}

function createExecutionEnvironment(
  mode: DaemonSandboxMode,
  sandboxId: string,
  workspacePath: string,
  logger: DaemonLogger,
): DaemonExecutionEnvironment {
  if (mode === "boxlite") return createBoxliteEnvironment(sandboxId, workspacePath, logger);
  return {
    sandboxMode: "none",
    ensureAgentReady: async (agent) => ensureHostAgentReady(agent),
    execStream: localProcessExecStream,
    close: async () => undefined,
  };
}

function createBoxliteEnvironment(
  sandboxId: string,
  workspacePath: string,
  logger: DaemonLogger,
): DaemonExecutionEnvironment {
  let starting: Promise<ActiveOrchestratorSession> | undefined;
  // The sandbox boots lazily on the first run command and stays up for the
  // daemon's lifetime so consecutive agent runs share one VM.
  const start = (): Promise<ActiveOrchestratorSession> => {
    starting ??= startOrchestratorSession((text) => {
      logger.info("sandbox", { sandboxId, text: text.trimEnd() });
    }, {
      boxName: boxNameForSandbox(sandboxId),
      workspacePath,
      // The backend and TUI run beside this daemon; only refuse to start when
      // another daemon or BoxLite shim already owns the runtime.
      singleInstancePattern: "relay-daemon/dist/cli\\.js|boxlite-shim",
    }).catch((error: unknown) => {
      starting = undefined;
      throw error;
    });
    return starting;
  };
  return {
    sandboxMode: "boxlite",
    async ensureAgentReady(agent, signal) {
      await start();
      await ensureSandboxAgentReady(agent, undefined, signal);
    },
    execStream: async (cmd, args = [], options = {}) => {
      await start();
      return defaultExecutionManager.execStream(cmd, args, options);
    },
    async close() {
      if (!starting) return;
      const pending = starting;
      starting = undefined;
      try {
        const active = await pending;
        await active.close();
      } catch {
        // The sandbox never came up; nothing to tear down.
      }
    },
  };
}

function boxNameForSandbox(sandboxId: string): string {
  return `relay-${sandboxId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 48)}`;
}

export async function localProcessExecStream(
  cmd: string,
  args: string[] = [],
  options: {
    cwd?: string;
    stdoutRenderer?: (chunk: string) => string;
    stderrRenderer?: (chunk: string) => string;
    sink?: (text: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<StreamExecResult> {
  if (options.signal?.aborted) {
    return {
      exit_code: -1,
      stdout: "",
      stderr: "",
      error_message: "Execution cancelled before start.",
    };
  }
  return new Promise((resolve) => {
    const detached = process.platform !== "win32";
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached,
    });
    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];
    let killTimer: NodeJS.Timeout | undefined;
    const terminate = (signal: NodeJS.Signals): void => {
      if (detached && child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // Fall back to the direct child below if the process group is gone.
        }
      }
      child.kill(signal);
    };
    const abort = (): void => {
      terminate("SIGTERM");
      // Escalate in case the agent ignores SIGTERM.
      killTimer = setTimeout(() => terminate("SIGKILL"), SIGKILL_DELAY_MS);
      killTimer.unref?.();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdoutParts.push(text);
      const rendered = options.stdoutRenderer ? options.stdoutRenderer(text) : text;
      if (rendered) options.sink?.(rendered);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderrParts.push(text);
      const rendered = options.stderrRenderer ? options.stderrRenderer(text) : text;
      if (rendered) options.sink?.(rendered);
    });
    child.on("close", (code) => {
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", abort);
      resolve({
        exit_code: code ?? -1,
        stdout: stdoutParts.join(""),
        stderr: stderrParts.join(""),
      });
    });
    child.on("error", (error) => {
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", abort);
      resolve({
        exit_code: -1,
        stdout: stdoutParts.join(""),
        stderr: stderrParts.join(""),
        error_message: error.message,
      });
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveIntEnv(name: string): number | undefined {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

export function createDaemonLogger(input: {
  workspacePath: string;
  sandboxId: string;
  logDir?: string;
}): DaemonLogger {
  const logDir = input.logDir ?? join(input.workspacePath, ".relay", "daemon-nodes", "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `${safeLogFileName(input.sandboxId)}.jsonl`);
  return new JsonlDaemonLogger(logDir, logPath);
}

class JsonlDaemonLogger implements DaemonLogger {
  constructor(
    private readonly logDir: string,
    public readonly logPath: string,
  ) {}

  info(message: string, fields: DaemonLogFields = {}): void {
    this.write("info", message, fields);
  }

  warn(message: string, fields: DaemonLogFields = {}): void {
    this.write("warn", message, fields);
  }

  error(message: string, fields: DaemonLogFields = {}): void {
    this.write("error", message, fields);
  }

  output(fields: DaemonLogFields & { text: string; stream: "stdout" | "stderr" }): void {
    this.write("output", "agent output", fields);
  }

  private write(level: string, message: string, fields: DaemonLogFields): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...fields,
    };
    const line = `${JSON.stringify(entry)}\n`;
    appendFileSync(this.logPath, line);
    if (typeof fields.runId === "string" && fields.runId) {
      appendFileSync(join(this.logDir, `${safeLogFileName(fields.runId)}.jsonl`), line);
    }
  }
}

function commandLogFields(sandboxId: string, command: DaemonNodeRunCommand): DaemonLogFields {
  return {
    sandboxId,
    commandId: command.id,
    sessionId: command.sessionId,
    runId: command.runId,
    agent: command.agent,
    mode: command.mode,
  };
}

function safeLogFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_") || "daemon-node";
}

function workspacePathsMatch(a?: string, b?: string): boolean {
  const left = normalizeWorkspacePath(a);
  const right = normalizeWorkspacePath(b);
  return Boolean(left && right && left === right);
}

function normalizeWorkspacePath(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? resolve(trimmed) : undefined;
}

const REQUEST_TIMEOUT_MS = 30_000;
const SIGKILL_DELAY_MS = 5_000;

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export class DaemonHttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "DaemonHttpError";
  }
}

// Retries `action` while the backend is unreachable (network errors) or
// answering with 5xx, with capped exponential backoff. Client errors (4xx,
// e.g. a rejected token) are fatal and propagate immediately.
const BACKEND_RECONNECT_MAX_DELAY_MS = 10_000;

async function withBackendReconnect<T>(
  action: () => Promise<T>,
  logger: DaemonLogger,
  context: { sandboxId: string; what: string },
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await action();
    } catch (error) {
      if (error instanceof DaemonHttpError && error.status < 500) throw error;
      attempt += 1;
      const message = error instanceof Error ? error.message : String(error);
      const backoff = Math.min(1000 * 2 ** Math.min(attempt - 1, 4), BACKEND_RECONNECT_MAX_DELAY_MS);
      logger.warn(`${context.what} failed; retrying`, {
        sandboxId: context.sandboxId,
        error: message,
        attempt,
        backoffMs: backoff,
      });
      await delay(backoff);
    }
  }
}

async function postJson(fetchFn: typeof fetch, url: string, body: unknown, token?: string, signal?: AbortSignal): Promise<void> {
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: requestSignal(signal),
  });
  if (!response.ok) {
    throw new DaemonHttpError(`POST ${url} failed: ${response.status} ${await response.text()}`, response.status);
  }
}

const EVENT_POST_RETRY_DELAYS_MS = [200, 400, 800, 1600, 3200] as const;

async function postJsonWithRetry(
  fetchFn: typeof fetch,
  url: string,
  body: unknown,
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= EVENT_POST_RETRY_DELAYS_MS.length; attempt += 1) {
    if (signal?.aborted) throw new Error("Aborted before event post.");
    try {
      await postJson(fetchFn, url, body, token, signal);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === EVENT_POST_RETRY_DELAYS_MS.length) break;
      await delay(EVENT_POST_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function getJson(fetchFn: typeof fetch, url: string, token?: string): Promise<Response> {
  return fetchFn(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal: requestSignal(),
  });
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export {
  activeBox,
  collectExecution,
  dockerImageId,
  ensureLocalDevboxOci,
  ensureSingleOrchestrator,
  execStream,
  importBoxLite,
  prepareGuestAgentAuth,
  prepareGuestWorkspace,
  setSessionBox,
  stopSessionBox,
  type BoxLiteModule,
  type DevboxOciOptions,
} from "./box.js";

export {
  BoxLiteExecutionManager,
  defaultExecutionManager,
  type CreateSandboxInput,
  type ExecutionManager,
  type ExecutionSandbox,
  type SandboxMount,
} from "./execution.js";

export {
  ensureAgentReady,
  resetAgentReadiness,
  startOrchestratorSession,
  withOrchestratorSession,
  type ActiveOrchestratorSession,
  type OrchestratorSession,
  type OrchestratorSessionOptions,
} from "./sandbox-session.js";
