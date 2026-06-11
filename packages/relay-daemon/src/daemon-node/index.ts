import { spawn } from "node:child_process";
import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type {
  DaemonNodeCommand,
  DaemonNodeEvent,
  DaemonNodeRegistration,
  DaemonNodeRunCommand,
  AgentName,
  CodexTaskMode,
  StreamExecResult,
} from "relay-core";
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

export interface DaemonNodeRuntimeOptions {
  daemonUrl?: string;
  sandboxId?: string;
  employeeId?: string;
  workspacePath?: string;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  fetchFn?: typeof fetch;
  token?: string;
  logDir?: string;
  logger?: DaemonNodeLogger;
}

export interface DaemonNodeLogFields {
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

export interface DaemonNodeLogger {
  readonly logPath?: string;
  info(message: string, fields?: DaemonNodeLogFields): void;
  warn(message: string, fields?: DaemonNodeLogFields): void;
  error(message: string, fields?: DaemonNodeLogFields): void;
  output(fields: DaemonNodeLogFields & { text: string; stream: "stdout" | "stderr" }): void;
}

export async function runRelayDaemonNode(options: DaemonNodeRuntimeOptions = {}): Promise<void> {
  const daemonUrl = normalizeBaseUrl(options.daemonUrl ?? process.env.RELAY_DAEMON_URL ?? "http://127.0.0.1:8790");
  const sandboxId = options.sandboxId ?? process.env.RELAY_SANDBOX_ID;
  if (!sandboxId) throw new Error("RELAY_SANDBOX_ID is required for relay daemon node.");
  const employeeId = options.employeeId ?? process.env.RELAY_EMPLOYEE_ID ?? process.env.USER ?? "local";
  const workspacePath = options.workspacePath ?? process.env.RELAY_WORKSPACE ?? process.cwd();
  process.env.RELAY_AGENT_WORKSPACE = workspacePath;
  if (workspacePath !== GUEST_WORKSPACE) {
    process.env.RELAY_RUN_AS_CURRENT_USER ??= "1";
    process.env.RELAY_AGENT_HOME ??= join(workspacePath, ".relay", "daemon-node-home");
  }
  const tokenResolution = ensureDaemonNodeToken({
    workspacePath,
    employeeId,
    token: options.token ?? process.env.RELAY_DAEMON_NODE_TOKEN,
  });
  const token = tokenResolution.token;
  const fetchFn = options.fetchFn ?? fetch;
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const logger = options.logger ?? createDaemonNodeLogger({
    workspacePath,
    sandboxId,
    logDir: options.logDir,
  });
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? positiveIntEnv("RELAY_DAEMON_NODE_HEARTBEAT_MS") ?? 30_000;
  logger.info("daemon node starting", { sandboxId, employeeId, workspacePath, daemonUrl });
  const activeRuns = new Map<string, AbortController>();
  let announced = false;
  const register = async (): Promise<void> => {
    const registration: DaemonNodeRegistration = {
      sandboxId,
      employeeId,
      token,
      workspacePath,
      protocolVersion: DAEMON_NODE_PROTOCOL_VERSION,
      supportedAgents: ["claude", "pi", "codex"],
      status: activeRuns.size > 0 ? "busy" : "ready",
    };
    await postJson(fetchFn, `${daemonUrl}/daemon-nodes/register`, registration);
    if (announced) return;
    announced = true;
    logger.info("daemon node registered", { sandboxId, employeeId, workspacePath, daemonUrl, logPath: logger.logPath });
    console.log(`Relay daemon node registered sandbox ${sandboxId} at ${daemonUrl}`);
    if (logger.logPath) console.log(`Relay daemon node log: ${logger.logPath}`);
    if (tokenResolution.source === "generated" && tokenResolution.path) {
      logger.info("daemon node generated token", { sandboxId, employeeId, path: tokenResolution.path });
      console.log(`Relay daemon node generated token for ${employeeId}: ${tokenResolution.path}`);
    }
  };

  let lastRegisteredAt = 0;
  let consecutiveFailures = 0;
  while (true) {
    try {
      // Register before the first poll and re-register on a heartbeat so a
      // restarted daemon learns this node is still alive and ready.
      if (Date.now() - lastRegisteredAt >= heartbeatIntervalMs) {
        await register();
        lastRegisteredAt = Date.now();
      }
      const response = await getJson(fetchFn, `${daemonUrl}/daemon-nodes/${encodeURIComponent(sandboxId)}/commands`, token);
      if (!response.ok) {
        throw new Error(`Command poll failed: ${response.status} ${await response.text()}`);
      }
      const body = await response.json() as { commands?: DaemonNodeCommand[] };
      for (const command of body.commands ?? []) {
        if (command.type === "run.start") {
          logger.info("command received", commandLogFields(sandboxId, command));
          const controller = new AbortController();
          activeRuns.set(command.id, controller);
          void executeCommand(daemonUrl, sandboxId, token, command, fetchFn, logger, workspacePath, controller.signal).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            logger.error("command failed before completion", { ...commandLogFields(sandboxId, command), error: message });
            return postJson(fetchFn, `${daemonUrl}/daemon-nodes/${encodeURIComponent(sandboxId)}/events`, {
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
      consecutiveFailures = 0;
    } catch (error) {
      // A daemon restart or a transient network failure must not kill the
      // node; back off, then re-register and resume polling.
      consecutiveFailures += 1;
      lastRegisteredAt = 0;
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("daemon poll failed; retrying", { sandboxId, error: message, attempt: consecutiveFailures });
      await delay(Math.min(pollIntervalMs * 2 ** Math.min(consecutiveFailures, 5), MAX_POLL_BACKOFF_MS));
      continue;
    }
    await delay(pollIntervalMs);
  }
}

async function executeCommand(
  daemonUrl: string,
  sandboxId: string,
  token: string,
  command: DaemonNodeRunCommand,
  fetchFn: typeof fetch,
  logger: DaemonNodeLogger,
  nodeWorkspacePath: string,
  signal?: AbortSignal,
): Promise<void> {
  const eventUrl = `${daemonUrl}/daemon-nodes/${encodeURIComponent(sandboxId)}/events`;
  const state = initialAgentState(command.taskGoal);
  logger.info("run starting", commandLogFields(sandboxId, command));
  if (command.workspacePath && command.workspacePath !== nodeWorkspacePath) {
    throw new Error(
      `Daemon node workspace mismatch: command expects ${command.workspacePath} but this node serves ${nodeWorkspacePath}.`,
    );
  }
  ensureDaemonNodeAgentReady(command.agent);
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
    execStream: localProcessExecStream,
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
    throw new Error(`Daemon node lost agent output: ${outputPostFailure.message}`);
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

function ensureDaemonNodeAgentReady(agent: AgentName): void {
  // Auth material is written directly from this process; never pass it
  // through a shell where it would be visible in the process table.
  const home = agentHomePath();
  if (agent === "codex") {
    const apiKey = openaiApiKey();
    if (!apiKey) throw new Error("OPENAI_API_KEY or CODEX_API_KEY is required for Codex daemon node runs.");
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
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];
    let killTimer: NodeJS.Timeout | undefined;
    const abort = (): void => {
      child.kill("SIGTERM");
      // Escalate in case the agent ignores SIGTERM.
      killTimer = setTimeout(() => child.kill("SIGKILL"), SIGKILL_DELAY_MS);
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

export function createDaemonNodeLogger(input: {
  workspacePath: string;
  sandboxId: string;
  logDir?: string;
}): DaemonNodeLogger {
  const logDir = input.logDir ?? join(input.workspacePath, ".relay", "daemon-nodes", "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `${safeLogFileName(input.sandboxId)}.jsonl`);
  return new JsonlDaemonNodeLogger(logDir, logPath);
}

class JsonlDaemonNodeLogger implements DaemonNodeLogger {
  constructor(
    private readonly logDir: string,
    public readonly logPath: string,
  ) {}

  info(message: string, fields: DaemonNodeLogFields = {}): void {
    this.write("info", message, fields);
  }

  warn(message: string, fields: DaemonNodeLogFields = {}): void {
    this.write("warn", message, fields);
  }

  error(message: string, fields: DaemonNodeLogFields = {}): void {
    this.write("error", message, fields);
  }

  output(fields: DaemonNodeLogFields & { text: string; stream: "stdout" | "stderr" }): void {
    this.write("output", "agent output", fields);
  }

  private write(level: string, message: string, fields: DaemonNodeLogFields): void {
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

function commandLogFields(sandboxId: string, command: DaemonNodeRunCommand): DaemonNodeLogFields {
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

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_POLL_BACKOFF_MS = 30_000;
const SIGKILL_DELAY_MS = 5_000;

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
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
  if (!response.ok) throw new Error(`POST ${url} failed: ${response.status} ${await response.text()}`);
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
