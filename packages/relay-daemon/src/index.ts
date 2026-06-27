import { spawn } from "node:child_process";
import { accessSync, appendFileSync, chmodSync, constants, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type {
  DaemonNodeCommand,
  DaemonNodeEvent,
  DaemonAgentHealth,
  DaemonNodeRegistration,
  DaemonNodeRunCommand,
  AgentName,
  AgentTaskMode,
  StreamExecResult,
} from "relay-core";
import { startOrchestratorSession, ensureAgentReady as ensureSandboxAgentReady, type ActiveOrchestratorSession } from "./sandbox-session.js";
import { discoverAgentInventory } from "./agent-inventory.js";
import { defaultExecutionManager } from "./execution.js";
import { hasHostKimiCodeAuth, prepareHostAgentSkills, prepareHostKimiCodeHome } from "./box.js";
import {
  AGENT_NAMES,
  getAgent,
  runAgentNode,
  initialAgentState,
  mergeAgentState,
  guestCodexAuthJson,
  guestCodexConfigToml,
  guestPiAuthJson,
  guestPiModelsJson,
  ensureDaemonNodeToken,
  GUEST_WORKSPACE,
  agentHomePath,
  kimiApiKey,
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
  signal?: AbortSignal;
  shutdownGraceMs?: number;
  environment?: DaemonExecutionEnvironment;
  preflight?: boolean;
}

export type DaemonHealthState = "starting" | "registered" | "polling" | "busy" | "stopping" | "stopped";

export interface DaemonDoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DaemonDoctorReport {
  ok: boolean;
  checks: DaemonDoctorCheck[];
}

export interface DaemonLogFields {
  sandboxId?: string;
  commandId?: string;
  sessionId?: string;
  runId?: string;
  agent?: AgentName;
  mode?: AgentTaskMode;
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
  const configuredEmployeeId = options.employeeId ?? process.env.RELAY_EMPLOYEE_ID;
  const employeeId = configuredEmployeeId ?? process.env.USER ?? "local";
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
  const environment = options.environment ?? createExecutionEnvironment(sandboxMode, sandboxId, workspacePath, logger);
  let health: DaemonHealthState | undefined;
  const setHealth = (next: DaemonHealthState, fields: DaemonLogFields = {}): void => {
    if (health === next) return;
    health = next;
    logger.info("daemon health", { sandboxId, health: next, ...fields });
  };
  logger.info("daemon starting", { sandboxId, employeeId, workspacePath, backendUrl, sandboxMode });
  setHealth("starting", { employeeId, workspacePath, backendUrl, sandboxMode });
  const activeRuns = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  const shutdownGraceMs = options.shutdownGraceMs ?? positiveIntEnv("RELAY_DAEMON_SHUTDOWN_GRACE_MS") ?? 10_000;
  const shutdownController = new AbortController();
  const runtimeSignal = options.signal
    ? AbortSignal.any([options.signal, shutdownController.signal])
    : shutdownController.signal;
  let stopping = false;
  let shutdownPromise: Promise<void> | undefined;
  if (runtimeSignal.aborted) {
    setHealth("stopping", { signal: "external" });
    await environment.close();
    setHealth("stopped");
    return;
  }
  const agentHealth = await discoverDaemonAgentHealth(environment, logger, sandboxId, options.signal);
  const supportedAgents = readyAgents(agentHealth);
  const agentInventory = await discoverAgentInventory(environment.execStream, options.signal);
  const buildRegistration = (includeEmployeeId = Boolean(configuredEmployeeId), status?: DaemonNodeRegistration["status"]): DaemonNodeRegistration => ({
    sandboxId,
    ...(includeEmployeeId ? { employeeId } : {}),
    token,
    workspacePath,
    protocolVersion: DAEMON_NODE_PROTOCOL_VERSION,
    supportedAgents,
    agentHealth,
    ...(Object.keys(agentInventory).length > 0 ? { agentInventory } : {}),
    status: status ?? (activeRuns.size > 0 ? "busy" : "ready"),
  });
  const register = async (): Promise<void> => {
    const url = `${backendUrl}/daemon-nodes/register`;
    try {
      await postJson(fetchFn, url, buildRegistration(), undefined, runtimeSignal);
    } catch (error) {
      if (
        error instanceof DaemonHttpError &&
        error.status === 400 &&
        error.message.includes("employeeId is required for unprovisioned daemon node registration")
      ) {
        await postJson(fetchFn, url, buildRegistration(true), undefined, runtimeSignal);
        return;
      }
      throw error;
    }
  };
  if (options.preflight !== false) {
    await runStartupPreflight({ backendUrl, sandboxId, token, workspacePath, fetchFn, logger, signal: runtimeSignal });
  }
  const shutdown = (signal: NodeJS.Signals | "external", exitProcess: boolean): void => {
    shutdownPromise ??= (async () => {
      stopping = true;
      if (!shutdownController.signal.aborted) shutdownController.abort(`Daemon received ${signal}.`);
      setHealth("stopping", { signal });
      logger.info("daemon stopping", { sandboxId, signal });
      for (const active of activeRuns.values()) active.controller.abort(`Daemon received ${signal}.`);
      await Promise.race([
        Promise.allSettled([...activeRuns.values()].map((active) => active.promise)),
        delay(shutdownGraceMs),
      ]);
      await postJson(
        fetchFn,
        `${backendUrl}/daemon-nodes/register`,
        buildRegistration(undefined, "stopped"),
        undefined,
        AbortSignal.timeout(SHUTDOWN_REGISTRATION_TIMEOUT_MS),
      ).catch((error: unknown) => {
        logger.warn("daemon stopped registration failed", { sandboxId, error: error instanceof Error ? error.message : String(error) });
      });
      await environment.close();
      setHealth("stopped");
      if (exitProcess) process.exit(0);
    })();
  };
  const handleSigint = (): void => shutdown("SIGINT", true);
  const handleSigterm = (): void => shutdown("SIGTERM", true);
  const handleExternalAbort = (): void => shutdown("external", false);
  const cleanupShutdownListeners = (): void => {
    process.off("SIGINT", handleSigint);
    process.off("SIGTERM", handleSigterm);
    options.signal?.removeEventListener("abort", handleExternalAbort);
  };
  process.once("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigterm);
  options.signal?.addEventListener("abort", handleExternalAbort, { once: true });
  if (options.signal?.aborted) shutdown("external", false);
  if (stopping) {
    try {
      await shutdownPromise;
    } finally {
      cleanupShutdownListeners();
    }
    return;
  }
  try {
    const reconnectControl = { signal: runtimeSignal, shouldStop: () => stopping };
    await withBackendReconnect(register, logger, { sandboxId, what: "registration" }, reconnectControl);
    let lastRegisteredAt = Date.now();
    logger.info("daemon registered", { sandboxId, employeeId, workspacePath, backendUrl, logPath: logger.logPath });
    setHealth("registered");
    console.log(`Relay daemon registered sandbox ${sandboxId} with backend at ${backendUrl} (sandbox: ${sandboxMode})`);
    if (logger.logPath) console.log(`Relay daemon log: ${logger.logPath}`);
    if (tokenResolution.source === "generated" && tokenResolution.path) {
      logger.info("daemon generated token", { sandboxId, employeeId, path: tokenResolution.path });
      console.log(`Relay daemon generated token for ${employeeId}: ${tokenResolution.path}`);
    }

    setHealth("polling");
    const cancellationTerminalEventSignal = (): AbortSignal | undefined =>
      stopping ? AbortSignal.timeout(SHUTDOWN_TERMINAL_EVENT_TIMEOUT_MS) : undefined;
    while (!stopping) {
      const body = await withBackendReconnect(async () => {
        if (stopping) return { commands: [] };
        // Heartbeat re-registration keeps a restarted backend current on this
        // node's agent roster and busy/ready status without waiting for a poll
        // rejection.
        if (Date.now() - lastRegisteredAt >= heartbeatIntervalMs) {
          await register();
          lastRegisteredAt = Date.now();
        }
        const response = await getJson(fetchFn, `${backendUrl}/daemon-nodes/${encodeURIComponent(sandboxId)}/commands`, token, runtimeSignal);
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
      }, logger, { sandboxId, what: "command poll" }, reconnectControl);
      if (stopping) break;
      for (const command of body.commands ?? []) {
        if (command.type === "run.start") {
          if (activeRuns.has(command.id)) {
            logger.warn("duplicate command ignored", commandLogFields(sandboxId, command));
            continue;
          }
          if (activeRuns.size > 0) {
            const detail = "Daemon node already has an active run; this node runs one command at a time.";
            logger.warn("command rejected while daemon busy", { ...commandLogFields(sandboxId, command), error: detail });
            await postJsonWithRetry(fetchFn, `${backendUrl}/daemon-nodes/${encodeURIComponent(sandboxId)}/events`, {
              type: "run.failed",
              commandId: command.id,
              ...commandLeaseEventFields(command),
              sessionId: command.sessionId,
              runId: command.runId,
              agent: command.agent,
              mode: command.mode,
              error: detail,
              exitCode: 1,
            } satisfies DaemonNodeEvent, token, runtimeSignal);
            continue;
          }
          logger.info("command received", commandLogFields(sandboxId, command));
          setHealth("busy", commandLogFields(sandboxId, command));
          const controller = new AbortController();
          const promise = Promise.resolve().then(() =>
            executeCommand(
              backendUrl,
              sandboxId,
              token,
              command,
              fetchFn,
              logger,
              workspacePath,
              environment,
              controller.signal,
              cancellationTerminalEventSignal,
            ),
          ).catch(async (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            logger.error("command failed before completion", { ...commandLogFields(sandboxId, command), error: message });
            const eventUrl = `${backendUrl}/daemon-nodes/${encodeURIComponent(sandboxId)}/events`;
            const event = controller.signal.aborted
              ? {
                  type: "run.cancelled",
                  commandId: command.id,
                  ...commandLeaseEventFields(command),
                  sessionId: command.sessionId,
                  runId: command.runId,
                  agent: command.agent,
                  mode: command.mode,
                  reason: typeof controller.signal.reason === "string" ? controller.signal.reason : "Daemon run cancelled.",
                } satisfies DaemonNodeEvent
              : {
                  type: "run.failed",
                  commandId: command.id,
                  ...commandLeaseEventFields(command),
                  sessionId: command.sessionId,
                  runId: command.runId,
                  agent: command.agent,
                  mode: command.mode,
                  error: message,
                } satisfies DaemonNodeEvent;
            await postJsonWithRetry(
              fetchFn,
              eventUrl,
              event,
              token,
              controller.signal.aborted ? cancellationTerminalEventSignal() : controller.signal,
            ).catch((postError: unknown) => {
              logger.error("terminal event post failed", {
                ...commandLogFields(sandboxId, command),
                error: postError instanceof Error ? postError.message : String(postError),
              });
            });
          }).finally(() => {
            activeRuns.delete(command.id);
            if (!stopping) setHealth("polling");
          });
          activeRuns.set(command.id, { controller, promise });
        } else if (command.type === "run.cancel") {
          logger.info("cancel command received", {
            sandboxId,
            commandId: command.commandId,
            sessionId: command.sessionId,
            runId: command.runId,
            agent: command.agent,
            mode: command.mode,
          });
          activeRuns.get(command.commandId)?.controller.abort(command.reason);
        }
      }
      await delay(pollIntervalMs, runtimeSignal);
    }
    await shutdownPromise;
  } catch (error) {
    if ((error instanceof DaemonStoppedError || runtimeSignal.aborted || stopping) && shutdownPromise) {
      await shutdownPromise;
      return;
    }
    throw error;
  } finally {
    cleanupShutdownListeners();
  }
}

export async function runRelayDaemonDoctor(options: DaemonRuntimeOptions = {}): Promise<DaemonDoctorReport> {
  const backendUrl = normalizeBaseUrl(options.backendUrl ?? process.env.RELAY_BACKEND_URL ?? process.env.RELAY_DAEMON_URL ?? "http://127.0.0.1:8790");
  const sandboxId = options.sandboxId ?? process.env.RELAY_SANDBOX_ID;
  const configuredEmployeeId = options.employeeId ?? process.env.RELAY_EMPLOYEE_ID;
  const employeeId = configuredEmployeeId ?? process.env.USER ?? "local";
  const workspacePath = firstNonBlank(options.workspacePath, process.env.RELAY_WORKSPACE, process.env.WORKSPACE) ?? process.cwd();
  const sandboxMode = resolveSandboxMode(options.sandbox ?? process.env.RELAY_SANDBOX_MODE);
  if (sandboxMode === "boxlite") {
    process.env.RELAY_AGENT_WORKSPACE = GUEST_WORKSPACE;
  } else {
    process.env.RELAY_AGENT_WORKSPACE = workspacePath;
  }
  const logger = options.logger ?? createDaemonLogger({ workspacePath, sandboxId: sandboxId ?? "doctor", logDir: options.logDir });
  const fetchFn = options.fetchFn ?? fetch;
  const checks: DaemonDoctorCheck[] = [];
  const add = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail });
    logger.info("daemon doctor check", { check: name, ok, detail, sandboxId });
  };
  if (!sandboxId) {
    add("sandbox-id", false, "--sandbox-id or RELAY_SANDBOX_ID is required.");
    return { ok: false, checks };
  }
  let token = "";
  try {
    token = ensureDaemonNodeToken({
      workspacePath,
      employeeId,
      token: options.token ?? process.env.RELAY_DAEMON_TOKEN ?? process.env.RELAY_DAEMON_NODE_TOKEN,
    }).token;
    add("token", true, "daemon node token resolved.");
  } catch (error) {
    add("token", false, error instanceof Error ? error.message : String(error));
  }
  await checkBackendReachable(fetchFn, backendUrl, options.signal).then(
    () => add("backend", true, `${backendUrl} is reachable.`),
    (error: unknown) => add("backend", false, error instanceof Error ? error.message : String(error)),
  );
  try {
    checkWorkspace(workspacePath);
    add("workspace", true, `${workspacePath} exists and is writable.`);
  } catch (error) {
    add("workspace", false, error instanceof Error ? error.message : String(error));
  }
  const environment = options.environment ?? createExecutionEnvironment(sandboxMode, sandboxId, workspacePath, logger);
  const agentHealth = await discoverDaemonAgentHealth(environment, logger, sandboxId, options.signal);
  if (token) {
    await postJson(fetchFn, `${backendUrl}/daemon-nodes/register`, {
      sandboxId,
      ...(configuredEmployeeId ? { employeeId } : {}),
      token,
      workspacePath,
      protocolVersion: DAEMON_NODE_PROTOCOL_VERSION,
      supportedAgents: readyAgents(agentHealth),
      agentHealth,
      status: "stopped",
    } satisfies DaemonNodeRegistration).then(
      () => add("registration", true, "backend accepted daemon node registration."),
      (error: unknown) => add("registration", false, error instanceof Error ? error.message : String(error)),
    );
  }
  for (const agent of AGENT_NAMES) {
    const health = agentHealth[agent];
    add(`agent:${agent}`, health?.status === "ready", health?.detail ?? `${getAgent(agent).displayName} preflight did not report a result.`);
  }
  await environment.close().catch(() => undefined);
  return { ok: checks.every((check) => check.ok), checks };
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value?.trim());
}

async function runStartupPreflight(input: {
  backendUrl: string;
  sandboxId: string;
  token: string;
  workspacePath: string;
  fetchFn: typeof fetch;
  logger: DaemonLogger;
  signal?: AbortSignal;
}): Promise<void> {
  if (!input.token.trim()) throw new Error("Daemon node token is required.");
  checkWorkspace(input.workspacePath);
  try {
    await checkBackendReachable(input.fetchFn, input.backendUrl, input.signal);
    input.logger.info("daemon preflight passed", { sandboxId: input.sandboxId, check: "backend" });
  } catch (error) {
    input.logger.warn("daemon backend preflight failed; registration will retry", {
      sandboxId: input.sandboxId,
      check: "backend",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function discoverDaemonAgentHealth(
  environment: DaemonExecutionEnvironment,
  logger: DaemonLogger,
  sandboxId: string,
  signal?: AbortSignal,
): Promise<Partial<Record<AgentName, DaemonAgentHealth>>> {
  const health: Partial<Record<AgentName, DaemonAgentHealth>> = {};
  for (const agent of AGENT_NAMES) {
    const def = getAgent(agent);
    try {
      await environment.ensureAgentReady(agent, signal);
      health[agent] = {
        status: "ready",
        detail: `${def.displayName} preflight passed.`,
        adapter: "cli",
      };
      logger.info("agent capability ready", { sandboxId, agent });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      health[agent] = {
        status: "failed",
        detail,
        adapter: "cli",
      };
      logger.warn("agent capability failed", { sandboxId, agent, error: detail });
    }
  }
  return health;
}

function readyAgents(health: Partial<Record<AgentName, DaemonAgentHealth>>): AgentName[] {
  return AGENT_NAMES.filter((agent) => health[agent]?.status === "ready");
}

async function checkBackendReachable(fetchFn: typeof fetch, backendUrl: string, signal?: AbortSignal): Promise<void> {
  const response = await fetchFn(`${backendUrl}/`, { signal: requestSignal(signal) });
  if (!response.ok) {
    throw new DaemonHttpError(`GET ${backendUrl}/ failed: ${response.status} ${await response.text()}`, response.status);
  }
}

function checkWorkspace(workspacePath: string): void {
  const stat = statSync(workspacePath);
  if (!stat.isDirectory()) throw new Error(`Workspace path is not a directory: ${workspacePath}`);
  accessSync(workspacePath, constants.R_OK | constants.W_OK);
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
  cancellationTerminalEventSignal?: () => AbortSignal | undefined,
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
    await postRunCancelled(fetchFn, eventUrl, command, token, signal.reason, cancellationTerminalEventSignal?.()).catch((error: unknown) => {
      logger.error("terminal event post failed", {
        ...commandLogFields(sandboxId, command),
        error: error instanceof Error ? error.message : String(error),
      });
    });
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
            ...commandLeaseEventFields(command),
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
  const patch = await runAgentNode(command.agent, command.mode, state, options);
  const next = mergeAgentState(state, patch);
  await outputPostChain;
  const agentLog = next.agent_logs.slice(-1)[0] ?? "";
  if (signal?.aborted) {
    logger.info("run cancelled", {
      ...commandLogFields(sandboxId, command),
      exitCode: next.last_exit_code,
    });
    await postRunCancelled(fetchFn, eventUrl, command, token, signal.reason, cancellationTerminalEventSignal?.()).catch((error: unknown) => {
      logger.error("terminal event post failed", {
        ...commandLogFields(sandboxId, command),
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return;
  }
  if (outputPostFailure) {
    await postJsonWithRetry(fetchFn, eventUrl, {
      type: "run.failed",
      commandId: command.id,
      ...commandLeaseEventFields(command),
      sessionId: command.sessionId,
      runId: command.runId,
      agent: command.agent,
      mode: command.mode,
      error: `Daemon lost agent output: ${outputPostFailure.message}`,
      agentLog,
      exitCode: next.last_exit_code || 1,
    } satisfies DaemonNodeEvent, token, signal);
    return;
  }
  logger.info("run completed", {
    ...commandLogFields(sandboxId, command),
    exitCode: next.last_exit_code,
    agentLogBytes: agentLog.length,
  });
  await postJsonWithRetry(fetchFn, eventUrl, {
    type: "run.completed",
    commandId: command.id,
    ...commandLeaseEventFields(command),
    sessionId: command.sessionId,
    runId: command.runId,
    agent: command.agent,
    mode: command.mode,
    exitCode: next.last_exit_code,
    agentLog,
    tokenUsage: next.token_usage,
  } satisfies DaemonNodeEvent, token, signal);
}

async function postRunCancelled(
  fetchFn: typeof fetch,
  eventUrl: string,
  command: DaemonNodeRunCommand,
  token: string,
  reason: unknown,
  signal?: AbortSignal,
): Promise<void> {
  await postJsonWithRetry(fetchFn, eventUrl, {
    type: "run.cancelled",
    commandId: command.id,
    ...commandLeaseEventFields(command),
    sessionId: command.sessionId,
    runId: command.runId,
    agent: command.agent,
    mode: command.mode,
    reason: typeof reason === "string" && reason ? reason : "Cancelled by human.",
  } satisfies DaemonNodeEvent, token, signal);
}

function commandLeaseEventFields(command: DaemonNodeRunCommand): { leaseId?: string } {
  return command.leaseId ? { leaseId: command.leaseId } : {};
}

function ensureHostAgentReady(agent: AgentName): void {
  // Auth material is written directly from this process; never pass it
  // through a shell where it would be visible in the process table.
  const home = agentHomePath();
  // Skills are shared across every agent under ~/.claude/skills.
  prepareHostAgentSkills(join(home, ".claude", "skills"));
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
  if (agent === "kimi") {
    if (hasHostKimiCodeAuth()) {
      prepareHostKimiCodeHome(join(home, ".kimi-code"));
    } else if (!kimiApiKey()) {
      throw new Error("Kimi requires a host Kimi Code login, KIMI_API_KEY, or MOONSHOT_API_KEY.");
    }
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
    ensureAgentReady: async (agent, signal) => ensureLocalAgentReady(agent, signal),
    execStream: localProcessExecStream,
    close: async () => undefined,
  };
}

async function ensureLocalAgentReady(agent: AgentName, signal?: AbortSignal): Promise<void> {
  ensureHostAgentReady(agent);
  const def = getAgent(agent);
  const result = await localProcessExecStream("bash", ["-c", def.preflight.command()], { signal });
  if (result.exit_code !== 0) {
    const detail = (result.stderr || result.stdout || result.error_message || "").trim();
    throw new Error(`${def.preflight.label} preflight failed.${detail ? ` ${detail}` : ""}`);
  }
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

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Delay aborted."));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Delay aborted."));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
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
const SHUTDOWN_REGISTRATION_TIMEOUT_MS = 250;
const SHUTDOWN_TERMINAL_EVENT_TIMEOUT_MS = 500;
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

class DaemonStoppedError extends Error {
  constructor() {
    super("Relay daemon stopped.");
    this.name = "DaemonStoppedError";
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
  control: { signal?: AbortSignal; shouldStop?: () => boolean } = {},
): Promise<T> {
  let attempt = 0;
  while (true) {
    if (control.signal?.aborted || control.shouldStop?.()) throw new DaemonStoppedError();
    try {
      return await action();
    } catch (error) {
      if (control.signal?.aborted || control.shouldStop?.()) throw new DaemonStoppedError();
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
      try {
        await delay(backoff, control.signal);
      } catch (delayError) {
        if (control.signal?.aborted || control.shouldStop?.()) throw new DaemonStoppedError();
        throw delayError;
      }
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

const EVENT_POST_RETRY_INITIAL_DELAY_MS = 200;
const EVENT_POST_RETRY_MAX_DELAY_MS = 10_000;

async function postJsonWithRetry(
  fetchFn: typeof fetch,
  url: string,
  body: unknown,
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  let attempt = 0;
  while (true) {
    if (signal?.aborted) throw new Error("Aborted before event post.");
    try {
      await postJson(fetchFn, url, body, token, signal);
      return;
    } catch (error) {
      if (error instanceof DaemonHttpError && error.status < 500) throw error;
      const backoff = Math.min(EVENT_POST_RETRY_INITIAL_DELAY_MS * 2 ** Math.min(attempt, 5), EVENT_POST_RETRY_MAX_DELAY_MS);
      attempt += 1;
      await delay(backoff, signal);
    }
  }
}

async function getJson(fetchFn: typeof fetch, url: string, token?: string, signal?: AbortSignal): Promise<Response> {
  return fetchFn(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal: requestSignal(signal),
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
  hasHostKimiCodeAuth,
  importBoxLite,
  hostKimiCodeHomePath,
  hostAgentSkillsDir,
  prepareGuestAgentAuth,
  prepareGuestAgentSkills,
  prepareHostAgentSkills,
  prepareHostKimiCodeHome,
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

export { discoverAgentInventory, parseInventoryOutput } from "./agent-inventory.js";
