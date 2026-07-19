import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { promisify } from "node:util";
import type { EnsureManagedNodeInput, ManagedNodeProvider, ProviderInstance, SupervisorLogger } from "./types.js";

export interface LocalProcessProviderOptions {
  command?: string;
  logger?: SupervisorLogger;
  signalProcess?: (pid: number, signal: NodeJS.Signals) => void;
  readProcessCommand?: (pid: number) => Promise<string | undefined>;
  readProcessStart?: (pid: number) => Promise<string | undefined>;
  stopTimeoutMs?: number;
  stopPollIntervalMs?: number;
}

const execFileAsync = promisify(execFile);

export class LocalProcessProvider implements ManagedNodeProvider {
  readonly name = "local-process";
  private readonly command: string;
  private readonly logger?: SupervisorLogger;
  private readonly children = new Map<string, ChildProcess>();
  private readonly signalProcess: (pid: number, signal: NodeJS.Signals) => void;
  private readonly readProcessCommand: (pid: number) => Promise<string | undefined>;
  private readonly readProcessStart: (pid: number) => Promise<string | undefined>;
  private readonly stopTimeoutMs: number;
  private readonly stopPollIntervalMs: number;

  constructor(options: LocalProcessProviderOptions = {}) {
    this.command = options.command ?? "relay-daemon";
    this.logger = options.logger;
    this.signalProcess = options.signalProcess ?? ((pid, signal) => { process.kill(pid, signal); });
    this.readProcessCommand = options.readProcessCommand ?? readProcessCommand;
    this.readProcessStart = options.readProcessStart ?? readProcessStart;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 5_000;
    this.stopPollIntervalMs = options.stopPollIntervalMs ?? 50;
  }

  async ensure(input: EnsureManagedNodeInput): Promise<ProviderInstance> {
    mkdirSync(input.workspacePath, { recursive: true });
    const child = spawn(this.command, [
      "--backend-url", input.backendUrl,
      "--enrollment-token", input.enrollmentCredential,
      "--workspace", input.workspacePath,
      "--workspace-id", input.workspaceId,
      "--sandbox", input.node.sandboxMode,
    ], {
      cwd: input.workspacePath,
      env: {
        ...process.env,
        RELAY_BACKEND_URL: input.backendUrl,
        RELAY_ENROLLMENT_TOKEN: input.enrollmentCredential,
        RELAY_WORKSPACE: input.workspacePath,
        RELAY_WORKSPACE_ID: input.workspaceId,
        RELAY_SANDBOX_MODE: input.node.sandboxMode,
      },
      stdio: "inherit",
    });
    await waitForSpawn(child);
    child.on("error", (error) => {
      this.logger?.warn("managed local process error", {
        pid: child.pid,
        error: error.message,
      });
    });
    if (!child.pid) {
      await terminateChild(child, this.stopTimeoutMs);
      throw new Error("Managed daemon process started without a pid.");
    }
    let processStart: string | undefined;
    try {
      processStart = await this.readProcessStart(child.pid);
      if (!processStart) {
        throw new Error("Managed daemon process start identity could not be read.");
      }
    } catch (error) {
      try {
        await terminateChild(child, this.stopTimeoutMs);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Managed daemon initialization failed and its process could not be terminated.",
        );
      }
      throw error;
    }
    const workspaceIdentity = encodeIdentity(input.workspaceId);
    const processIdentity = encodeIdentity(processStart);
    const instanceId = `local-process:${child.pid}:${workspaceIdentity}:${processIdentity}`;
    this.children.set(instanceId, child);
    child.once("exit", (code, signal) => {
      this.children.delete(instanceId);
      this.logger?.warn("managed local process exited", { instanceId, code, signal });
    });
    return { id: instanceId, child };
  }

  async inspect(instanceId: string): Promise<"running" | "stopped" | "unknown"> {
    const child = this.children.get(instanceId);
    if (child) return child.exitCode === null && !child.signalCode ? "running" : "stopped";
    const identity = localProcessIdentity(instanceId);
    if (!identity) return "unknown";
    const [command, processStart] = await Promise.all([
      this.readProcessCommand(identity.pid),
      this.readProcessStart(identity.pid),
    ]);
    if (!command || !processStart) return "stopped";
    return command.includes("relay-daemon")
      && command.includes(identity.workspaceId)
      && processStart === identity.processStart
      ? "running"
      : "unknown";
  }

  async stop(instanceId: string): Promise<void> {
    const child = this.children.get(instanceId);
    if (child) {
      await terminateChild(child, this.stopTimeoutMs, instanceId);
      return;
    }
    const identity = localProcessIdentity(instanceId);
    if (!identity || await this.inspect(instanceId) !== "running") return;
    try {
      this.signalProcess(identity.pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    if (await this.waitUntilStopped(instanceId)) return;
    this.signalProcess(identity.pid, "SIGKILL");
    if (!await this.waitUntilStopped(instanceId)) {
      throw new Error(`Managed daemon ${instanceId} did not exit.`);
    }
  }

  async delete(instanceId: string): Promise<void> {
    await this.stop(instanceId);
    this.children.delete(instanceId);
  }

  private async waitUntilStopped(instanceId: string): Promise<boolean> {
    const deadline = Date.now() + this.stopTimeoutMs;
    do {
      if (await this.inspect(instanceId) !== "running") return true;
      if (Date.now() >= deadline) return false;
      await delay(this.stopPollIntervalMs);
    } while (true);
  }
}

function localProcessIdentity(instanceId: string): { pid: number; workspaceId: string; processStart: string } | undefined {
  const match = /^local-process:(\d+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/.exec(instanceId);
  if (!match) return undefined;
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  try {
    return {
      pid,
      workspaceId: Buffer.from(match[2], "base64url").toString("utf8"),
      processStart: Buffer.from(match[3], "base64url").toString("utf8"),
    };
  } catch {
    return undefined;
  }
}

function encodeIdentity(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

async function waitForSpawn(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onSpawn = () => {
      child.off("error", onError);
      resolve();
    };
    const onError = (error: Error) => {
      child.off("spawn", onSpawn);
      reject(error);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function terminateChild(
  child: ChildProcess,
  timeoutMs: number,
  instanceId = `pid:${child.pid ?? "unknown"}`,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode) return;
  child.kill("SIGTERM");
  await waitForChildExit(child, timeoutMs);
  if (child.exitCode === null && !child.signalCode) {
    child.kill("SIGKILL");
    await waitForChildExit(child, timeoutMs);
  }
  if (child.exitCode === null && !child.signalCode) {
    throw new Error(`Managed daemon ${instanceId} did not exit.`);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readProcessCommand(pid: number): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="]);
    const command = stdout.trim();
    return command || undefined;
  } catch (error) {
    const code = (error as { code?: string | number }).code;
    if (code === 1 || code === "ESRCH") return undefined;
    throw error;
  }
}

async function readProcessStart(pid: number): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "lstart="]);
    const start = stdout.trim();
    return start || undefined;
  } catch (error) {
    const code = (error as { code?: string | number }).code;
    if (code === 1 || code === "ESRCH") return undefined;
    throw error;
  }
}
