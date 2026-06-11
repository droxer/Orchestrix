import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type {
  DaemonNodeCommand,
  DaemonNodeEvent,
  DaemonNodeRegistration,
  DaemonNodeRunCommand,
  AgentExecutor,
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
  encodeBase64,
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
  logger.info("daemon node starting", { sandboxId, employeeId, workspacePath, daemonUrl });
  const registration: DaemonNodeRegistration = {
    sandboxId,
    employeeId,
    token,
    workspacePath,
    protocolVersion: DAEMON_NODE_PROTOCOL_VERSION,
    supportedAgents: ["claude", "pi", "codex"],
    status: "ready",
  };
  await postJson(fetchFn, `${daemonUrl}/daemon-nodes/register`, registration);
  logger.info("daemon node registered", { sandboxId, employeeId, workspacePath, daemonUrl, logPath: logger.logPath });
  console.log(`Relay daemon node registered sandbox ${sandboxId} at ${daemonUrl}`);
  if (logger.logPath) console.log(`Relay daemon node log: ${logger.logPath}`);
  if (tokenResolution.source === "generated" && tokenResolution.path) {
    logger.info("daemon node generated token", { sandboxId, employeeId, path: tokenResolution.path });
    console.log(`Relay daemon node generated token for ${employeeId}: ${tokenResolution.path}`);
  }
  const activeRuns = new Map<string, AbortController>();

  while (true) {
    const response = await getJson(fetchFn, `${daemonUrl}/daemon-nodes/${encodeURIComponent(sandboxId)}/commands`, token);
    if (!response.ok) {
      const detail = `Command poll failed: ${response.status} ${await response.text()}`;
      logger.error("command poll failed", { sandboxId, error: detail });
      throw new Error(detail);
    }
    const body = await response.json() as { commands?: DaemonNodeCommand[] };
    for (const command of body.commands ?? []) {
      if (command.type === "run.start") {
        logger.info("command received", commandLogFields(sandboxId, command));
        const controller = new AbortController();
        activeRuns.set(command.id, controller);
        void executeCommand(daemonUrl, sandboxId, token, command, fetchFn, logger, controller.signal).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          const exitCode = error instanceof DaemonNodeAgentReadyError ? error.exitCode : undefined;
          logger.error("command failed before completion", { ...commandLogFields(sandboxId, command), error: message, exitCode });
          return postJson(fetchFn, `${daemonUrl}/daemon-nodes/${encodeURIComponent(sandboxId)}/events`, {
            type: "run.failed",
            commandId: command.id,
            sessionId: command.sessionId,
            runId: command.runId,
            agent: command.agent,
            mode: command.mode,
            error: message,
            ...(exitCode !== undefined ? { exitCode } : {}),
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

async function executeCommand(
  daemonUrl: string,
  sandboxId: string,
  token: string,
  command: DaemonNodeRunCommand,
  fetchFn: typeof fetch,
  logger: DaemonNodeLogger,
  signal?: AbortSignal,
): Promise<void> {
  const eventUrl = `${daemonUrl}/daemon-nodes/${encodeURIComponent(sandboxId)}/events`;
  const state = initialAgentState(command.taskGoal);
  logger.info("run starting", commandLogFields(sandboxId, command));
  await ensureDaemonNodeAgentReady(command.agent, localProcessExecStream, signal);
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
  if (outputPostFailure) {
    throw new Error(`Daemon node lost agent output: ${outputPostFailure.message}`);
  }
  if (signal?.aborted) {
    logger.info("run cancelled", {
      ...commandLogFields(sandboxId, command),
      exitCode: next.last_exit_code,
    });
    await postRunCancelled(fetchFn, eventUrl, command, token, signal.reason);
    return;
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
    mode: command.mode as CodexTaskMode,
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

class DaemonNodeAgentReadyError extends Error {
  constructor(message: string, public readonly exitCode: number) {
    super(message);
    this.name = "DaemonNodeAgentReadyError";
  }
}

async function ensureDaemonNodeAgentReady(agent: AgentName, execStream: AgentExecutor, signal?: AbortSignal): Promise<void> {
  const script = ["set -eu"];
  const home = agentHomePath();
  const codexHome = `${home}/.codex`;
  const piHome = `${home}/.pi/agent`;
  if (agent === "codex") {
    const apiKey = openaiApiKey();
    if (!apiKey) throw new Error("OPENAI_API_KEY or CODEX_API_KEY is required for Codex daemon node runs.");
    script.push(
      `mkdir -p ${shellArg(codexHome)}`,
      `printf %s ${shellArg(encodeBase64(guestCodexAuthJson(apiKey)))} | base64 -d > ${shellArg(`${codexHome}/auth.json`)}`,
      `printf %s ${shellArg(encodeBase64(guestCodexConfigToml()))} | base64 -d > ${shellArg(`${codexHome}/config.toml`)}`,
      `chmod 600 ${shellArg(`${codexHome}/auth.json`)}`,
    );
  }
  if (agent === "pi") {
    script.push(
      `mkdir -p ${shellArg(piHome)}`,
      `printf %s ${shellArg(encodeBase64(guestPiAuthJson()))} | base64 -d > ${shellArg(`${piHome}/auth.json`)}`,
      `printf %s ${shellArg(encodeBase64(guestPiModelsJson()))} | base64 -d > ${shellArg(`${piHome}/models.json`)}`,
      `chmod 600 ${shellArg(`${piHome}/auth.json`)}`,
    );
  }
  if (script.length === 1) return;
  const result = await execStream("bash", ["-c", script.join("; ")], { signal });
  if (signal?.aborted) return;
  if (result.exit_code !== 0) {
    throw new DaemonNodeAgentReadyError(
      `Daemon node auth setup failed. ${(result.stderr || result.stdout).trim()}`,
      result.exit_code,
    );
  }
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
    const abort = (): void => {
      child.kill("SIGTERM");
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
      options.signal?.removeEventListener("abort", abort);
      resolve({
        exit_code: code ?? -1,
        stdout: stdoutParts.join(""),
        stderr: stderrParts.join(""),
      });
    });
    child.on("error", (error) => {
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

function shellArg(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
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

async function postJson(fetchFn: typeof fetch, url: string, body: unknown, token?: string): Promise<void> {
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
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
      await postJson(fetchFn, url, body, token);
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
  });
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
