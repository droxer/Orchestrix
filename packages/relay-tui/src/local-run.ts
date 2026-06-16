#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { hostWorkspacePath, loadPackageEnv, normalizeBaseUrl } from "relay-core";
import { ensureDaemonNodeToken } from "relay-core";

loadPackageEnv("relay-tui");

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8790";
const STARTUP_TIMEOUT_MS = 15_000;
const CHILD_LOG_LIMIT = 64_000;

interface ManagedChild {
  name: string;
  child: ChildProcess;
  log: () => string;
}

export interface LocalRunConfig {
  backendUrl: string;
  backendEndpoint: URL;
  workspacePath: string;
  employeeId: string;
  token: string;
  uiToken: string;
  sandboxId: string;
  sandboxMode: string;
  childEnv: NodeJS.ProcessEnv;
}

export interface BackendStatus {
  responding: boolean;
}

const currentFile = fileURLToPath(import.meta.url);
const distDir = dirname(currentFile);
const repoRoot = resolveRepoRootFromDist(distDir);
const pythonBackendProject = repoRoot;
const daemonCli = resolve(distDir, "../../relay-daemon/dist/cli.js");
const tuiCli = resolve(distDir, "cli.js");

async function main(): Promise<void> {
  const { backendUrl, backendEndpoint, workspacePath, employeeId, sandboxId, sandboxMode, childEnv } = resolveLocalRunConfig();

  const children: ManagedChild[] = [];
  let ownsBackend = false;
  let shuttingDown = false;
  const cleanup = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const managed of children.toReversed()) {
      if (!managed.child.killed) managed.child.kill("SIGTERM");
    }
  };

  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
  process.once("exit", cleanup);

  try {
    const initialStatus = await backendStatus(backendUrl);
    if (!initialStatus.responding) {
      const backend = startChild("backend", "uv", ["run", "--project", pythonBackendProject, "backend", "backend", ...backendArgs(backendEndpoint)], childEnv);
      children.push(backend);
      ownsBackend = true;
      await waitFor(async () => (await backendStatus(backendUrl)).responding, "Relay backend", [backend]);
    }

    // The daemon owns the sandbox and runs the agent CLIs. Skip starting one
    // when a live daemon for this employee is already registered (e.g. from a
    // previous local run or a remote sandbox) so two pollers never compete
    // for the same command queue.
    if (!(await liveDaemonExists(backendUrl, employeeId, workspacePath))) {
      children.push(startChild("daemon", process.execPath, [daemonCli, ...daemonArgs(sandboxId, sandboxMode)], childEnv));
    }

    const tui = spawn(process.execPath, [tuiCli], {
      env: childEnv,
      stdio: "inherit",
    });
    const exitCode = await waitForExit(tui);
    cleanup();
    process.exitCode = exitCode ?? 0;
  } catch (error) {
    cleanup();
    const detail = error instanceof Error ? error.message : String(error);
    console.error(detail);
    if (!ownsBackend) {
      console.error(`A backend is already listening at ${backendUrl}; check its /cp page or run make stop before retrying.`);
    }
    process.exitCode = 1;
  }
}

export function resolveLocalRunConfig(env: NodeJS.ProcessEnv = process.env): LocalRunConfig {
  const backendUrl = normalizeBaseUrl(envValue(env, "RELAY_BACKEND_URL") ?? envValue(env, "RELAY_DAEMON_URL") ?? DEFAULT_BACKEND_URL);
  const backendEndpoint = new URL(backendUrl);
  const workspacePath = hostWorkspacePath(envValue(env, "RELAY_WORKSPACE") ?? envValue(env, "WORKSPACE"));
  const employeeId = envValue(env, "RELAY_EMPLOYEE_ID") ?? envValue(env, "EMPLOYEE_ID") ?? envValue(env, "USER") ?? "local";
  // Prefer the durable per-employee token file over a random token so a
  // restarted daemon re-registers with the hash the backend already persisted.
  const token = ensureDaemonNodeToken({
    workspacePath,
    employeeId,
    token: envValue(env, "RELAY_DAEMON_TOKEN") ?? envValue(env, "RELAY_DAEMON_NODE_TOKEN"),
  }).token;
  const uiToken = ensureDaemonNodeToken({
    workspacePath,
    employeeId: `${employeeId}.ui`,
    token: envValue(env, "RELAY_DAEMON_UI_TOKEN"),
  }).token;
  const sandboxId = envValue(env, "RELAY_SANDBOX_ID") ?? envValue(env, "SANDBOX_ID") ?? `sbx_${safeId(employeeId)}`;
  const sandboxMode = envValue(env, "RELAY_SANDBOX_MODE") ?? "boxlite";
  return {
    backendUrl,
    backendEndpoint,
    workspacePath,
    employeeId,
    token,
    uiToken,
    sandboxId,
    sandboxMode,
    childEnv: {
      ...env,
      RELAY_BACKEND_URL: backendUrl,
      RELAY_DAEMON_URL: backendUrl,
      RELAY_EMPLOYEE_ID: employeeId,
      RELAY_DAEMON_TOKEN: token,
      RELAY_DAEMON_NODE_TOKEN: token,
      RELAY_DAEMON_UI_TOKEN: uiToken,
      RELAY_SANDBOX_ID: sandboxId,
      RELAY_SANDBOX_MODE: sandboxMode,
      RELAY_WORKSPACE: workspacePath,
    },
  };
}

export function resolveRepoRootFromDist(distDirectory: string = distDir): string {
  return resolve(distDirectory, "../../..");
}

export function backendArgs(backendEndpoint: URL): string[] {
  const port = backendEndpoint.port || (backendEndpoint.protocol === "https:" ? "443" : "80");
  return ["--port", port];
}

export function daemonArgs(sandboxId: string, sandboxMode: string): string[] {
  return ["--sandbox-id", sandboxId, "--sandbox", sandboxMode];
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_") || "local";
}

function startChild(name: string, command: string, args: string[], env: NodeJS.ProcessEnv): ManagedChild {
  const child = spawn(command, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  const append = (chunk: Buffer): void => {
    log = `${log}${chunk.toString("utf8")}`;
    if (log.length > CHILD_LOG_LIMIT) log = log.slice(-CHILD_LOG_LIMIT);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  return { name, child, log: () => log.trim() };
}

async function backendStatus(backendUrl: string): Promise<BackendStatus> {
  try {
    const response = await fetch(backendUrl, { signal: AbortSignal.timeout(500) });
    return { responding: response.ok };
  } catch {
    return { responding: false };
  }
}

export async function liveDaemonExists(backendUrl: string, employeeId: string, workspacePath: string): Promise<boolean> {
  try {
    const response = await fetch(`${backendUrl}/cp/daemon-nodes`, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return false;
    const body = await response.json() as { nodes?: Array<{ employeeId?: string; online?: boolean; stale?: boolean; workspacePath?: string }> };
    return (body.nodes ?? []).some((node) =>
      node.employeeId === employeeId &&
      node.online !== false &&
      node.stale !== true &&
      (!node.workspacePath || workspacePathsMatch(node.workspacePath, workspacePath))
    );
  } catch {
    return false;
  }
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

async function waitFor(check: () => Promise<boolean>, label: string, children: ManagedChild[]): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < STARTUP_TIMEOUT_MS) {
    for (const managed of children) {
      if (managed.child.exitCode !== null) {
        throw new Error(`${managed.name} exited during startup.${formatChildLog(managed)}`);
      }
    }
    if (await check()) return;
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${label}.${children.map(formatChildLog).join("")}`);
}

function formatChildLog(managed: ManagedChild): string {
  const log = managed.log();
  return log ? `\n\n${managed.name} output:\n${log}` : "";
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    child.once("exit", (code) => resolve(code));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  void main();
}
