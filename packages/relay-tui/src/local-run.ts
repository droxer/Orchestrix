#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { hostWorkspacePath, normalizeBaseUrl } from "relay-backend";

const DEFAULT_DAEMON_URL = "http://127.0.0.1:8790";
const STARTUP_TIMEOUT_MS = 15_000;
const CHILD_LOG_LIMIT = 64_000;

interface ManagedChild {
  name: string;
  child: ChildProcess;
  log: () => string;
}

export interface LocalRunConfig {
  daemonUrl: string;
  daemonEndpoint: URL;
  workspacePath: string;
  employeeId: string;
  token: string;
  uiToken: string;
  sandboxId: string;
  childEnv: NodeJS.ProcessEnv;
}

export interface DaemonStatus {
  responding: boolean;
  daemonNodeMode?: string;
}

const currentFile = fileURLToPath(import.meta.url);
const distDir = dirname(currentFile);
const backendCli = resolve(distDir, "../../relay-backend/dist/backend-cli.js");
const tuiCli = resolve(distDir, "cli.js");

async function main(): Promise<void> {
  const { daemonUrl, daemonEndpoint, childEnv } = resolveLocalRunConfig();

  const children: ManagedChild[] = [];
  let ownsDaemon = false;
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
    const initialStatus = await daemonStatus(daemonUrl);
    const initialCompatibilityError = localDaemonCompatibilityError(initialStatus, daemonUrl);
    if (!initialStatus.responding) {
      const daemon = startChild("backend", backendCli, daemonArgs(daemonEndpoint), childEnv);
      children.push(daemon);
      ownsDaemon = true;
      await waitFor(async () => {
        const status = await daemonStatus(daemonUrl);
        return status.responding && status.daemonNodeMode === "local";
      }, "Relay daemon", [daemon]);
    } else if (initialCompatibilityError) {
      throw new Error(initialCompatibilityError);
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
    if (!ownsDaemon) {
      console.error(`A daemon is already listening at ${daemonUrl}; check its /cp page or run make stop before retrying.`);
    }
    process.exitCode = 1;
  }
}

export function resolveLocalRunConfig(env: NodeJS.ProcessEnv = process.env): LocalRunConfig {
  const daemonUrl = normalizeBaseUrl(envValue(env, "RELAY_BACKEND_URL") ?? envValue(env, "RELAY_DAEMON_URL") ?? DEFAULT_DAEMON_URL);
  const daemonEndpoint = new URL(daemonUrl);
  const workspacePath = hostWorkspacePath(envValue(env, "RELAY_WORKSPACE") ?? envValue(env, "WORKSPACE"));
  const employeeId = envValue(env, "RELAY_EMPLOYEE_ID") ?? envValue(env, "EMPLOYEE_ID") ?? envValue(env, "USER") ?? "local";
  const token = envValue(env, "RELAY_DAEMON_TOKEN") ?? envValue(env, "RELAY_DAEMON_NODE_TOKEN") ?? `tok_${randomBytes(24).toString("base64url")}`;
  const uiToken = envValue(env, "RELAY_DAEMON_UI_TOKEN") ?? `tok_${randomBytes(24).toString("base64url")}`;
  const sandboxId = envValue(env, "RELAY_SANDBOX_ID") ?? envValue(env, "SANDBOX_ID") ?? `sbx_${safeId(employeeId)}`;
  return {
    daemonUrl,
    daemonEndpoint,
    workspacePath,
    employeeId,
    token,
    uiToken,
    sandboxId,
    childEnv: {
      ...env,
      RELAY_BACKEND_URL: daemonUrl,
      RELAY_DAEMON_URL: daemonUrl,
      RELAY_EMPLOYEE_ID: employeeId,
      RELAY_DAEMON_TOKEN: token,
      RELAY_DAEMON_NODE_TOKEN: token,
      RELAY_DAEMON_UI_TOKEN: uiToken,
      RELAY_WORKSPACE: workspacePath,
    },
  };
}

export function daemonArgs(daemonEndpoint: URL): string[] {
  const port = daemonEndpoint.port || (daemonEndpoint.protocol === "https:" ? "443" : "80");
  return ["--port", port, "--daemon-node-mode", "local"];
}

export function localDaemonCompatibilityError(status: DaemonStatus, daemonUrl: string): string | undefined {
  if (!status.responding) return undefined;
  if (status.daemonNodeMode === "local") return undefined;
  const mode = status.daemonNodeMode ?? "unknown";
  return `Relay daemon at ${daemonUrl} is running in ${mode} mode, but the local TUI requires local mode. Run make stop, then make tui-local.`;
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_") || "local";
}

function startChild(name: string, script: string, args: string[], env: NodeJS.ProcessEnv): ManagedChild {
  const child = spawn(process.execPath, [script, ...args], {
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

async function daemonStatus(daemonUrl: string): Promise<DaemonStatus> {
  try {
    const response = await fetch(daemonUrl, { signal: AbortSignal.timeout(500) });
    if (!response.ok) return { responding: false };
    const body = await response.json() as { daemonNodeMode?: unknown };
    return {
      responding: true,
      daemonNodeMode: typeof body.daemonNodeMode === "string" ? body.daemonNodeMode : undefined,
    };
  } catch {
    return { responding: false };
  }
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
