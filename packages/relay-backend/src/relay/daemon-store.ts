import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { DaemonNodeEvent } from "relay-core";
import { DEFAULT_RELAY_DATA_DIR } from "./session.js";
import type {
  DaemonCommandRecord,
  DaemonEvent,
  DaemonRunRecord,
  DaemonStore,
  SandboxRecord,
} from "./daemon-types.js";
import {
  daemonCommandRecord,
  daemonEvent,
  daemonRunFromEvent,
  daemonRunRecord,
  hashDaemonNodeToken,
  sandboxRecord,
} from "./daemon-registry.js";

export class LocalDaemonStore implements DaemonStore {
  private readonly nodesDir: string;
  private readonly commandsDir: string;
  private readonly runsDir: string;
  private readonly eventsDir: string;

  constructor(rootDir = DEFAULT_RELAY_DATA_DIR) {
    this.nodesDir = join(rootDir, "daemon", "nodes");
    this.commandsDir = join(rootDir, "daemon", "commands");
    this.runsDir = join(rootDir, "daemon", "runs");
    this.eventsDir = join(rootDir, "daemon", "events");
    mkdirSync(this.nodesDir, { recursive: true });
    mkdirSync(this.commandsDir, { recursive: true });
    mkdirSync(this.runsDir, { recursive: true });
    mkdirSync(this.eventsDir, { recursive: true });
  }

  async registerNode(input: SandboxRecord): Promise<SandboxRecord> {
    const uiTokenHash = input.uiTokenHash ?? input.tokenHash ?? hashDaemonNodeToken(input.token ?? "");
    const node = {
      ...input,
      token: undefined,
      tokenHash: uiTokenHash,
      uiTokenHash,
      nodeTokenHash: input.nodeTokenHash,
    };
    this.writeNode(node);
    await this.appendDaemonEvent(daemonEvent("daemon.node.registered", { node }));
    return node;
  }

  async markNodeSeen(nodeId: string, patch: Pick<Partial<SandboxRecord>, "status" | "lastError"> = {}): Promise<SandboxRecord | undefined> {
    const node = await this.getNode(nodeId);
    if (!node) return undefined;
    const now = new Date().toISOString();
    const updated = {
      ...node,
      ...patch,
      updatedAt: now,
      lastSeenAt: now,
    };
    this.writeNode(updated);
    await this.appendDaemonEvent(daemonEvent("daemon.node.seen", {
      nodeId,
      patch: {
        status: patch.status,
        lastError: patch.lastError,
        lastSeenAt: now,
      },
    }));
    return updated;
  }

  async getNode(nodeId: string): Promise<SandboxRecord | undefined> {
    const path = join(this.nodesDir, `${safeDaemonNodeFileName(nodeId)}.json`);
    if (!existsSync(path)) return undefined;
    return sandboxRecord(readJsonFileSafe(path));
  }

  async listNodes(): Promise<SandboxRecord[]> {
    if (!existsSync(this.nodesDir)) return [];
    return readdirSync(this.nodesDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .flatMap((entry) => {
        const sandbox = sandboxRecord(readJsonFileSafe(join(this.nodesDir, entry.name)));
        return sandbox ? [sandbox] : [];
      });
  }

  async enqueueCommand(nodeId: string, command: import("relay-core").DaemonNodeCommand): Promise<DaemonCommandRecord> {
    const now = new Date().toISOString();
    const record: DaemonCommandRecord = {
      id: command.id,
      nodeId,
      command,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    this.writeCommand(record);
    if (command.type === "run.start") {
      this.writeRun({
        nodeId,
        commandId: command.id,
        sessionId: command.sessionId,
        runId: command.runId,
        agent: command.agent,
        mode: command.mode,
        taskGoal: command.taskGoal,
        workspacePath: command.workspacePath,
        status: "running",
        startedAt: now,
      });
    }
    await this.appendDaemonEvent(daemonEvent("daemon.command.queued", { nodeId, commandId: command.id }));
    return record;
  }

  async takeQueuedCommands(nodeId: string, limit = Number.MAX_SAFE_INTEGER): Promise<DaemonCommandRecord[]> {
    const now = new Date().toISOString();
    const records = this.listCommands()
      .filter((record) => record.nodeId === nodeId && record.status === "queued")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit)
      .map((record) => ({
        ...record,
        status: "dispatched" as const,
        updatedAt: now,
        dispatchedAt: now,
      }));
    for (const record of records) {
      if (record.command.type === "run.start") {
        this.writeCommand(record);
        this.writeRun({ ...this.runForCommand(record), status: "running", startedAt: now });
      } else {
        this.writeCommand({ ...record, status: "completed", completedAt: now });
      }
      await this.appendDaemonEvent(daemonEvent("daemon.command.dispatched", { nodeId, commandId: record.id }));
    }
    return records;
  }

  async queuedCommandCount(nodeId: string): Promise<number> {
    return this.listCommands().filter((record) => record.nodeId === nodeId && record.status === "queued").length;
  }

  async listActiveRuns(nodeId?: string): Promise<DaemonRunRecord[]> {
    if (!existsSync(this.runsDir)) return [];
    return readdirSync(this.runsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .flatMap((entry) => {
        const record = daemonRunRecord(readJsonFileSafe(join(this.runsDir, entry.name)));
        return record && record.status === "running" && (!nodeId || record.nodeId === nodeId) ? [record] : [];
      });
  }

  async markCommandCompleted(nodeId: string, event: Extract<DaemonNodeEvent, { type: "run.completed" }>): Promise<void> {
    const now = new Date().toISOString();
    const command = this.getCommand(event.commandId);
    if (command) {
      this.writeCommand({ ...command, status: "completed", updatedAt: now, completedAt: now });
    }
    const run = this.getRun(event.runId) ?? daemonRunFromEvent(nodeId, event, "completed");
    this.writeRun({
      ...run,
      status: "completed",
      completedAt: now,
      exitCode: event.exitCode,
    });
    await this.appendDaemonEvent(daemonEvent("daemon.command.completed", {
      nodeId,
      commandId: event.commandId,
      runId: event.runId,
      exitCode: event.exitCode,
    }));
  }

  async markCommandFailed(nodeId: string, event: Extract<DaemonNodeEvent, { type: "run.failed" }>): Promise<void> {
    const now = new Date().toISOString();
    const command = this.getCommand(event.commandId);
    if (command) {
      this.writeCommand({ ...command, status: "failed", updatedAt: now, completedAt: now, error: event.error });
    }
    const run = this.getRun(event.runId) ?? daemonRunFromEvent(nodeId, event, "failed");
    this.writeRun({
      ...run,
      status: "failed",
      completedAt: now,
      error: event.error,
    });
    await this.appendDaemonEvent(daemonEvent("daemon.command.failed", {
      nodeId,
      commandId: event.commandId,
      runId: event.runId,
      error: event.error,
    }));
  }

  async markCommandCancelled(nodeId: string, event: Extract<DaemonNodeEvent, { type: "run.cancelled" }>): Promise<void> {
    const now = new Date().toISOString();
    const command = this.getCommand(event.commandId);
    if (command) {
      this.writeCommand({ ...command, status: "cancelled", updatedAt: now, completedAt: now, error: event.reason });
    }
    const run = this.getRun(event.runId) ?? daemonRunFromEvent(nodeId, event, "cancelled");
    this.writeRun({
      ...run,
      status: "cancelled",
      completedAt: now,
      error: event.reason,
    });
    await this.appendDaemonEvent(daemonEvent("daemon.command.cancelled", {
      nodeId,
      commandId: event.commandId,
      runId: event.runId,
      error: event.reason,
    }));
  }

  async appendDaemonEvent(event: DaemonEvent): Promise<void> {
    mkdirSync(this.eventsDir, { recursive: true });
    appendFileSync(join(this.eventsDir, "events.jsonl"), `${JSON.stringify(event)}\n`);
  }

  private listCommands(): DaemonCommandRecord[] {
    if (!existsSync(this.commandsDir)) return [];
    return readdirSync(this.commandsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .flatMap((entry) => {
        const record = daemonCommandRecord(readJsonFileSafe(join(this.commandsDir, entry.name)));
        return record ? [record] : [];
      });
  }

  private getCommand(commandId: string): DaemonCommandRecord | undefined {
    const path = join(this.commandsDir, `${safeDaemonNodeFileName(commandId)}.json`);
    if (!existsSync(path)) return undefined;
    return daemonCommandRecord(readJsonFileSafe(path));
  }

  private getRun(runId: string): DaemonRunRecord | undefined {
    const path = join(this.runsDir, `${safeDaemonNodeFileName(runId)}.json`);
    if (!existsSync(path)) return undefined;
    return daemonRunRecord(readJsonFileSafe(path));
  }

  private runForCommand(record: DaemonCommandRecord): DaemonRunRecord {
    if (record.command.type === "run.start") {
      return this.getRun(record.command.runId) ?? {
        nodeId: record.nodeId,
        commandId: record.command.id,
        sessionId: record.command.sessionId,
        runId: record.command.runId,
        agent: record.command.agent,
        mode: record.command.mode,
        taskGoal: record.command.taskGoal,
        workspacePath: record.command.workspacePath,
        status: "running",
        startedAt: record.dispatchedAt ?? record.createdAt,
      };
    }
    throw new Error(`Unsupported daemon command ${record.id}.`);
  }

  private writeNode(sandbox: SandboxRecord): void {
    mkdirSync(this.nodesDir, { recursive: true });
    const path = join(this.nodesDir, `${safeDaemonNodeFileName(sandbox.id)}.json`);
    writeJsonFileAtomic(path, sandbox, 0o600);
  }

  private writeCommand(record: DaemonCommandRecord): void {
    mkdirSync(this.commandsDir, { recursive: true });
    const path = join(this.commandsDir, `${safeDaemonNodeFileName(record.id)}.json`);
    writeJsonFileAtomic(path, record);
  }

  private writeRun(record: DaemonRunRecord): void {
    mkdirSync(this.runsDir, { recursive: true });
    const path = join(this.runsDir, `${safeDaemonNodeFileName(record.runId)}.json`);
    writeJsonFileAtomic(path, record);
  }
}

export const LocalDaemonNodeStorage = LocalDaemonStore;

export function readJsonFileSafe(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // A torn or corrupt record must not take down every poll that lists the
    // directory; skip it and let the healthy records through.
    return undefined;
  }
}

export function writeJsonFileAtomic(path: string, value: unknown, mode?: number): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, mode === undefined ? undefined : { mode });
  renameSync(tmp, path);
}

function safeDaemonNodeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_") || "daemon-node";
}
