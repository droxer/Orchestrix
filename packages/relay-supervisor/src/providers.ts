import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import type { EnsureManagedNodeInput, ManagedNodeProvider, ProviderInstance, SupervisorLogger } from "./types.js";

export interface LocalProcessProviderOptions {
  command?: string;
  logger?: SupervisorLogger;
}

export class LocalProcessProvider implements ManagedNodeProvider {
  readonly name = "local-process";
  private readonly command: string;
  private readonly logger?: SupervisorLogger;
  private readonly children = new Map<string, ChildProcess>();

  constructor(options: LocalProcessProviderOptions = {}) {
    this.command = options.command ?? "relay-daemon";
    this.logger = options.logger;
  }

  async ensure(input: EnsureManagedNodeInput): Promise<ProviderInstance> {
    const instanceId = `${input.node.id}:${input.node.generation}`;
    const current = this.children.get(instanceId);
    if (current && current.exitCode === null && !current.signalCode) return { id: instanceId, child: current };
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
    this.children.set(instanceId, child);
    child.once("exit", (code, signal) => {
      this.children.delete(instanceId);
      this.logger?.warn("managed local process exited", { instanceId, code, signal });
    });
    return { id: instanceId, child };
  }

  async inspect(instanceId: string): Promise<"running" | "stopped" | "unknown"> {
    const child = this.children.get(instanceId);
    if (!child) return "unknown";
    return child.exitCode === null && !child.signalCode ? "running" : "stopped";
  }

  async stop(instanceId: string): Promise<void> {
    const child = this.children.get(instanceId);
    if (!child || child.exitCode !== null || child.signalCode) return;
    child.kill("SIGTERM");
  }

  async delete(instanceId: string): Promise<void> {
    await this.stop(instanceId);
    this.children.delete(instanceId);
  }
}
