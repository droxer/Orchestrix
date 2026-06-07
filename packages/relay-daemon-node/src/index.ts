import { spawn } from "node:child_process";
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
} from "relay-core";

export interface DaemonNodeRuntimeOptions {
  daemonUrl?: string;
  sandboxId?: string;
  employeeId?: string;
  workspacePath?: string;
  pollIntervalMs?: number;
  fetchFn?: typeof fetch;
  token?: string;
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
  const registration: DaemonNodeRegistration = {
    sandboxId,
    employeeId,
    token,
    workspacePath,
    protocolVersion: 1,
    supportedAgents: ["claude", "pi", "codex"],
    status: "ready",
  };
  await postJson(fetchFn, `${daemonUrl}/daemon-nodes/register`, registration);
  console.log(`Relay daemon node registered sandbox ${sandboxId} at ${daemonUrl}`);
  if (tokenResolution.source === "generated" && tokenResolution.path) {
    console.log(`Relay daemon node generated token for ${employeeId}: ${tokenResolution.path}`);
  }

  while (true) {
    const response = await getJson(fetchFn, `${daemonUrl}/daemon-nodes/${encodeURIComponent(sandboxId)}/commands`, token);
    if (!response.ok) throw new Error(`Command poll failed: ${response.status} ${await response.text()}`);
    const body = await response.json() as { commands?: DaemonNodeCommand[] };
    for (const command of body.commands ?? []) {
      if (command.type === "run.start") {
        await executeCommand(daemonUrl, sandboxId, token, command, fetchFn).catch((error: unknown) =>
          postJson(fetchFn, `${daemonUrl}/daemon-nodes/${encodeURIComponent(sandboxId)}/events`, {
            type: "run.failed",
            commandId: command.id,
            sessionId: command.sessionId,
            runId: command.runId,
            agent: command.agent,
            mode: command.mode,
            error: error instanceof Error ? error.message : String(error),
          } satisfies DaemonNodeEvent, token)
        );
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
): Promise<void> {
  const eventUrl = `${daemonUrl}/daemon-nodes/${encodeURIComponent(sandboxId)}/events`;
  const state = initialAgentState(command.taskGoal);
  await ensureDaemonNodeAgentReady(command.agent, localProcessExecStream);
  let outputSequence = 0;
  const orderedPosts: Promise<void>[] = [];
  const eventSink = {
    agentOutput: (_runId: string, agent: AgentName, stream: "stdout" | "stderr", text: string): void => {
      orderedPosts.push(postJson(fetchFn, eventUrl, {
        type: "run.output",
        commandId: command.id,
        sessionId: command.sessionId,
        runId: command.runId,
        agent,
        stream,
        text,
        sequence: outputSequence++,
      } satisfies DaemonNodeEvent, token));
    },
  };
  const options = {
    execStream: localProcessExecStream,
    eventSink,
    runId: command.runId,
    agent: command.agent,
  };
  const patch = command.agent === "claude"
    ? await claudeImplementNode(state, options)
    : command.agent === "pi"
      ? await piImplementNode(state, options)
      : command.mode === "review"
        ? await codexReviewNode(state, options)
        : await codexImplementNode(state, options);
  const next = mergeAgentState(state, patch);
  await Promise.all(orderedPosts);
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

async function ensureDaemonNodeAgentReady(agent: AgentName, execStream: AgentExecutor): Promise<void> {
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
  const result = await execStream("bash", ["-c", script.join("; ")]);
  if (result.exit_code !== 0) {
    throw new Error(`Daemon node auth setup failed. ${(result.stderr || result.stdout).trim()}`);
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

async function getJson(fetchFn: typeof fetch, url: string, token?: string): Promise<Response> {
  return fetchFn(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
