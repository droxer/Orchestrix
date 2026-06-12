import { createHash, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";

import { DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS } from "relay-core";
import type { AgentName, CodexTaskMode, DaemonNodeCommand, DaemonNodeEvent, DaemonNodeRegistration } from "relay-core";
import {
  DEFAULT_RELAY_DATA_DIR,
  LocalSessionStore,
  newRelayId,
  relayEvent,
  type AgentEventSink,
  type RelaySession,
  type SessionStore,
} from "./session.js";
import { LocalDaemonStore } from "./daemon-store.js";
import type {
  ControlPanelDaemonNodeRecord,
  DaemonCommandRecord,
  DaemonCompletionEvent,
  DaemonEvent,
  DaemonNodeActiveRun,
  DaemonNodeMonitorRecord,
  DaemonNodeRegistryOptions,
  DaemonRunRecord,
  DaemonRunStatus,
  SandboxRecord,
  SandboxStatus,
  TrackedDaemonNodeActiveRun,
} from "./daemon-types.js";

export const DAEMON_RUN_TIMEOUT_MS = positiveIntEnv("RELAY_DAEMON_RUN_TIMEOUT_MS") ?? 15 * 60 * 1000;
export const DAEMON_NODE_LIVENESS_TIMEOUT_MS = positiveIntEnv("RELAY_DAEMON_NODE_LIVENESS_TIMEOUT_MS") ?? 15_000;

export class DaemonNodeRegistry {
  private readonly sandboxes = new Map<string, SandboxRecord>();
  private readonly activeCommands = new Map<string, TrackedDaemonNodeActiveRun>();
  private readonly completions = new Map<string, {
    resolve: (event: DaemonCompletionEvent) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private readonly outputs = new Map<string, string[]>();
  private readonly outputSequences = new Map<string, Set<number>>();
  private readonly outputSinks = new Map<string, AgentEventSink>();
  private readonly ready: Promise<void>;

  constructor(
    public readonly store: SessionStore = new LocalSessionStore(),
    private readonly daemonStore: import("./daemon-types.js").DaemonStore = new LocalDaemonStore(dataDirForSessionStore(store)),
    private readonly options: DaemonNodeRegistryOptions = {},
  ) {
    this.ready = this.loadPersistedState();
  }

  async register(input: DaemonNodeRegistration, uiToken?: string): Promise<SandboxRecord> {
    await this.ready;
    const now = new Date().toISOString();
    const existing = this.sandboxes.get(input.sandboxId);
    if ((existing?.nodeTokenHash || existing?.tokenHash) && !daemonNodeTokenMatches(existing, input.token)) {
      throw new Error(
        `Unauthorized daemon node registration for ${input.sandboxId}: token does not match the token issued at provisioning.`,
      );
    }
    const nextUiTokenHash = uiToken
      ? hashDaemonNodeToken(uiToken)
      : existing?.uiTokenHash ?? existing?.tokenHash;
    const agents: SandboxRecord["agents"] = {
      claude: input.supportedAgents.includes("claude") ? "ready" : "unknown",
      pi: input.supportedAgents.includes("pi") ? "ready" : "unknown",
      codex: input.supportedAgents.includes("codex") ? "ready" : "unknown",
    };
    const sandbox: SandboxRecord = {
      id: input.sandboxId,
      employeeId: input.employeeId,
      workspacePath: input.workspacePath,
      status: input.status === "busy" ? "running" : input.status === "stopped" ? "stopped" : "ready",
      agents,
      // Plaintext UI tokens are intentionally NOT retained in the registry record.
      // The daemon-node token is retained for the local control panel only.
      token: undefined,
      tokenHash: nextUiTokenHash,
      uiTokenHash: nextUiTokenHash,
      nodeTokenHash: hashDaemonNodeToken(input.token) ?? existing?.nodeTokenHash ?? existing?.tokenHash,
      nodeToken: input.token || existing?.nodeToken,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastSeenAt: now,
    };
    this.sandboxes.set(sandbox.id, sandbox);
    await this.daemonStore.registerNode(sandbox);
    return sandbox;
  }

  async updateStatus(sandboxId: string, patch: Pick<Partial<SandboxRecord>, "status" | "lastError">): Promise<void> {
    await this.ready;
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) return;
    const updated = {
      ...sandbox,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.sandboxes.set(sandboxId, updated);
    await this.daemonStore.markNodeSeen(sandboxId, patch);
  }

  get(sandboxId: string): SandboxRecord | undefined {
    return this.sandboxes.get(sandboxId);
  }

  list(): SandboxRecord[] {
    return [...this.sandboxes.values()];
  }

  async listReady(): Promise<SandboxRecord[]> {
    await this.ready;
    return this.list();
  }

  async monitorNodes(): Promise<DaemonNodeMonitorRecord[]> {
    await this.ready;
    const nodes: DaemonNodeMonitorRecord[] = [];
    for (const sandbox of this.list()) {
      const {
        token: _token,
        tokenHash: _tokenHash,
        uiTokenHash: _uiTokenHash,
        nodeTokenHash: _nodeTokenHash,
        nodeToken: _nodeToken,
        ...node
      } = sandbox;
      const liveness = this.liveness(sandbox);
      nodes.push({
        ...node,
        queuedCommandCount: await this.daemonStore.queuedCommandCount(sandbox.id),
        activeRuns: (await this.daemonStore.listActiveRuns(sandbox.id)).map(daemonActiveRun),
        online: liveness.online,
        stale: liveness.stale,
        ...(liveness.lastSeenAgeMs === undefined ? {} : { lastSeenAgeMs: liveness.lastSeenAgeMs }),
      });
    }
    return nodes;
  }

  async isLive(sandboxId: string): Promise<boolean> {
    await this.ready;
    const sandbox = this.sandboxes.get(sandboxId);
    return sandbox ? this.liveness(sandbox).online : false;
  }

  async monitorNodesForToken(token?: string): Promise<DaemonNodeMonitorRecord[] | undefined> {
    await this.ready;
    if (!token) return undefined;
    const allowed = new Set(this.list()
      .filter((sandbox) => sandboxUiTokenMatches(sandbox, token))
      .map((sandbox) => sandbox.id));
    if (allowed.size === 0) return undefined;
    return (await this.monitorNodes()).filter((node) => allowed.has(node.id));
  }

  async controlPanelNodes(): Promise<ControlPanelDaemonNodeRecord[]> {
    await this.ready;
    const tokens = new Map(this.list().map((sandbox) => [sandbox.id, sandbox.nodeToken]));
    return (await this.monitorNodes()).map((node) => ({
      ...node,
      nodeToken: tokens.get(node.id),
    }));
  }

  async findLiveAuthenticatedNode(employeeId: string, nodeToken?: string): Promise<SandboxRecord | undefined> {
    await this.ready;
    if (!nodeToken) return undefined;
    const matches = this.list().filter((sandbox) =>
      sandbox.employeeId === employeeId &&
      this.liveness(sandbox).online &&
      daemonNodeTokenMatches(sandbox, nodeToken)
    );
    const rank = (sandbox: SandboxRecord): number =>
      sandbox.status === "ready" ? 0 : sandbox.status === "running" ? 1 : 2;
    return matches.sort((a, b) =>
      rank(a) - rank(b) || (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? "")
    )[0];
  }

  async findByEmployee(employeeId: string, workspacePath?: string): Promise<SandboxRecord | undefined> {
    await this.ready;
    const matches = this.list().filter((sandbox) =>
      sandbox.employeeId === employeeId &&
      (!workspacePath || !sandbox.workspacePath || workspacePathsMatch(sandbox.workspacePath, workspacePath))
    );
    // Prefer the live daemon node over offline placeholders so re-provisioning
    // converges on whichever node actually registered for this employee.
    const rank = (sandbox: SandboxRecord): number => {
      const live = this.liveness(sandbox).online;
      if (live && sandbox.status === "ready") return 0;
      if (live && sandbox.status === "running") return 1;
      if (sandbox.status === "stopped") return 3;
      return 2;
    };
    return matches.sort((a, b) =>
      rank(a) - rank(b) || (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? "")
    )[0];
  }

  async enqueue(sandboxId: string, command: DaemonNodeCommand, eventSink?: AgentEventSink): Promise<void> {
    await this.ready;
    await this.daemonStore.enqueueCommand(sandboxId, command);
    if (command.type === "run.start") {
      this.activeCommands.set(command.id, {
        sandboxId,
        commandId: command.id,
        sessionId: command.sessionId,
        runId: command.runId,
        agent: command.agent,
        mode: command.mode,
        taskGoal: command.taskGoal,
        workspacePath: command.workspacePath,
        startedAt: new Date().toISOString(),
      });
      if (eventSink) {
        this.outputSinks.set(command.id, eventSink);
      }
    }
  }

  async takeCommands(sandboxId: string, token?: string): Promise<DaemonNodeCommand[]> {
    await this.ready;
    this.assertAuthorized(sandboxId, token);
    await this.markSeen(sandboxId);
    const records = await this.daemonStore.takeQueuedCommands(sandboxId);
    for (const record of records) {
      const command = record.command;
      if (command.type === "run.start") {
        this.activeCommands.set(command.id, {
          sandboxId,
          commandId: command.id,
          sessionId: command.sessionId,
          runId: command.runId,
          agent: command.agent,
          mode: command.mode,
          taskGoal: command.taskGoal,
          workspacePath: command.workspacePath,
          startedAt: record.dispatchedAt ?? new Date().toISOString(),
        });
      }
    }
    return records.map((record) => record.command);
  }

  waitForCompletion(commandId: string, timeoutMs = DAEMON_RUN_TIMEOUT_MS): Promise<DaemonCompletionEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const reason = `Daemon node command ${commandId} timed out after ${timeoutMs}ms.`;
        const active = this.activeCommands.get(commandId);
        if (active) {
          void this.daemonStore.markCommandFailed(active.sandboxId, {
            type: "run.failed",
            commandId,
            sessionId: active.sessionId,
            runId: active.runId,
            agent: active.agent,
            mode: active.mode,
            error: reason,
          });
          // The node is still running the agent; tell it to abort instead of
          // letting the run burn compute until it finishes on its own.
          void this.enqueue(active.sandboxId, {
            id: newRelayId("cmd"),
            type: "run.cancel",
            commandId,
            sessionId: active.sessionId,
            runId: active.runId,
            agent: active.agent,
            mode: active.mode,
            reason,
          });
          this.clearRunOutput(active.runId);
        }
        this.completions.delete(commandId);
        this.activeCommands.delete(commandId);
        reject(new Error(reason));
      }, timeoutMs);
      this.completions.set(commandId, { resolve, reject, timer });
    });
  }

  async cancelActiveRun(sandboxId: string, sessionId: string, reason: string): Promise<TrackedDaemonNodeActiveRun | undefined> {
    await this.ready;
    const active = [...this.activeCommands.values()].find((run) =>
      run.sandboxId === sandboxId && run.sessionId === sessionId
    );
    if (!active) return undefined;
    await this.enqueue(sandboxId, {
      id: newRelayId("cmd"),
      type: "run.cancel",
      commandId: active.commandId,
      sessionId: active.sessionId,
      runId: active.runId,
      agent: active.agent,
      mode: active.mode,
      reason,
    });
    return active;
  }

  async handleEvent(sandboxId: string, event: DaemonNodeEvent, token?: string, eventSink?: AgentEventSink): Promise<void> {
    await this.ready;
    this.assertAuthorized(sandboxId, token);
    await this.markSeen(sandboxId);
    const active = this.activeCommands.get(event.commandId);
    // Drop events for commands this daemon is not tracking (late events after a
    // timeout, or stale ids). Without an active record the event cannot be tied
    // to a sandbox, so acting on it would let one node touch another's state.
    if (!active) return;
    if (active.sandboxId !== sandboxId || active.runId !== event.runId || active.sessionId !== event.sessionId) {
      throw new Error("Unauthorized daemon node event: command belongs to a different sandbox.");
    }
    if (event.type === "run.output") {
      const seen = this.outputSequences.get(event.runId) ?? new Set<number>();
      if (seen.has(event.sequence)) return;
      seen.add(event.sequence);
      this.outputSequences.set(event.runId, seen);
      this.outputs.set(event.runId, [...(this.outputs.get(event.runId) ?? []), event.text]);
      const sink = eventSink ?? this.outputSinks.get(event.commandId);
      if (sink) {
        await sink.agentOutput(event.runId, event.agent, event.stream, event.text);
      } else {
        await this.store.appendEvent(event.sessionId, relayEvent("agent.output", event.sessionId, {
          runId: event.runId,
          agent: event.agent,
          stream: event.stream,
          text: event.text,
        }));
      }
      return;
    }
    this.outputSinks.delete(event.commandId);
    this.activeCommands.delete(event.commandId);
    if (event.type === "run.completed") {
      await this.daemonStore.markCommandCompleted(sandboxId, event);
    } else if (event.type === "run.cancelled") {
      await this.daemonStore.markCommandCancelled(sandboxId, event);
    } else {
      await this.daemonStore.markCommandFailed(sandboxId, event);
    }
    const completion = this.completions.get(event.commandId);
    if (completion) {
      clearTimeout(completion.timer);
      completion.resolve(event);
    } else {
      // Nothing is awaiting this run (e.g. the daemon restarted mid-run), so
      // the buffered output has no consumer left.
      this.clearRunOutput(event.runId);
    }
    this.completions.delete(event.commandId);
  }

  outputForRun(runId: string): string {
    return (this.outputs.get(runId) ?? []).join("");
  }

  clearRunOutput(runId: string): void {
    this.outputs.delete(runId);
    this.outputSequences.delete(runId);
  }

  private assertAuthorized(sandboxId: string, token?: string): void {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) throw new Error(`Unknown sandbox ${sandboxId}.`);
    if (!daemonNodeTokenMatches(sandbox, token)) throw new Error("Unauthorized daemon node request.");
  }

  private async markSeen(sandboxId: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) return;
    const now = new Date().toISOString();
    // An authorized poll proves the daemon node is alive again. Offline
    // placeholders ("stopped", e.g. after a daemon restart) and stale
    // "provisioning"/"failed" records become schedulable without requiring a
    // re-registration; "running" is left to the run lifecycle.
    const revived = sandbox.status === "stopped" || sandbox.status === "provisioning" || sandbox.status === "failed";
    const patch: Pick<Partial<SandboxRecord>, "status" | "lastError"> = revived
      ? { status: "ready", lastError: undefined }
      : {};
    const updated = { ...sandbox, ...patch, updatedAt: now, lastSeenAt: now };
    this.sandboxes.set(sandboxId, updated);
    await this.daemonStore.markNodeSeen(sandboxId, patch);
  }

  private async loadPersistedState(): Promise<void> {
    for (const sandbox of await this.daemonStore.listNodes()) {
      this.sandboxes.set(sandbox.id, offlineSandboxRecord(sandbox));
    }
    for (const run of await this.daemonStore.listActiveRuns()) {
      this.activeCommands.set(run.commandId, { ...run, sandboxId: run.nodeId });
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private livenessTimeoutMs(): number {
    return this.options.livenessTimeoutMs ?? DAEMON_NODE_LIVENESS_TIMEOUT_MS;
  }

  private liveness(sandbox: SandboxRecord): { online: boolean; stale: boolean; lastSeenAgeMs?: number } {
    if (sandbox.status === "stopped") return { online: false, stale: true };
    if (!sandbox.lastSeenAt) return { online: false, stale: true };
    const seenAt = new Date(sandbox.lastSeenAt).getTime();
    if (!Number.isFinite(seenAt)) return { online: false, stale: true };
    const lastSeenAgeMs = Math.max(0, this.now() - seenAt);
    const online = lastSeenAgeMs <= this.livenessTimeoutMs();
    return { online, stale: !online, lastSeenAgeMs };
  }
}

export function hashDaemonNodeToken(token: string): string | undefined {
  if (!token) return undefined;
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

export function sandboxUiTokenMatches(sandbox: SandboxRecord, token?: string): boolean {
  return sandboxTokenHashMatches(sandbox.uiTokenHash ?? sandbox.tokenHash ?? (sandbox.token ? hashDaemonNodeToken(sandbox.token) : undefined), token);
}

export function daemonNodeTokenMatches(sandbox: SandboxRecord, token?: string): boolean {
  return sandboxTokenHashMatches(sandbox.nodeTokenHash ?? sandbox.tokenHash ?? (sandbox.token ? hashDaemonNodeToken(sandbox.token) : undefined), token);
}

export function sandboxTokenHashMatches(expected: string | undefined, token?: string): boolean {
  if (!token || !expected) return false;
  const provided = hashDaemonNodeToken(token);
  if (!provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sandboxUiAuthError(sandbox: SandboxRecord, token?: string): string | null {
  if (!sandbox.uiTokenHash && !sandbox.tokenHash && !sandbox.token) {
    return sandbox.nodeTokenHash ? "Sandbox token is required." : null;
  }
  if (!token) return "Sandbox token is required.";
  if (!sandboxUiTokenMatches(sandbox, token)) return "Invalid sandbox token.";
  return null;
}

export function sandboxNodeAuthError(sandbox: SandboxRecord, token?: string): string | null {
  if (!sandbox.nodeTokenHash && !sandbox.tokenHash && !sandbox.token) return null;
  if (!token) return "Daemon node token is required.";
  if (!daemonNodeTokenMatches(sandbox, token)) return "Invalid daemon node token.";
  return null;
}

export function newSandboxId(employeeId: string): string {
  const safeEmployee = employeeId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "employee";
  return `sbx_${safeEmployee}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function daemonRunFromEvent(
  nodeId: string,
  event: DaemonCompletionEvent,
  status: DaemonRunStatus,
): DaemonRunRecord {
  return {
    nodeId,
    commandId: event.commandId,
    sessionId: event.sessionId,
    runId: event.runId,
    agent: event.agent,
    mode: event.mode,
    taskGoal: "",
    status,
    startedAt: new Date().toISOString(),
  };
}

export function daemonActiveRun(run: DaemonRunRecord): DaemonNodeActiveRun {
  return {
    commandId: run.commandId,
    sessionId: run.sessionId,
    runId: run.runId,
    agent: run.agent,
    mode: run.mode,
    taskGoal: run.taskGoal,
    workspacePath: run.workspacePath,
    startedAt: run.startedAt,
  };
}

export function daemonEvent(type: DaemonEvent["type"], payload: Record<string, unknown>): DaemonEvent {
  return {
    id: newRelayId("devt"),
    type,
    timestamp: new Date().toISOString(),
    ...payload,
  } as DaemonEvent;
}

export function daemonRunRecord(value: unknown): DaemonRunRecord | undefined {
  const input = asRecord(value);
  const nodeId = stringField(input, "nodeId");
  const commandId = stringField(input, "commandId");
  const sessionId = stringField(input, "sessionId");
  const runId = stringField(input, "runId");
  const agent = agentName(input.agent);
  if (!nodeId || !commandId || !sessionId || !runId || !agent) return undefined;
  const status = input.status === "completed" || input.status === "failed" || input.status === "cancelled" ? input.status : "running";
  return {
    nodeId,
    commandId,
    sessionId,
    runId,
    agent,
    mode: input.mode === "review" ? "review" : "implement",
    taskGoal: stringField(input, "taskGoal"),
    workspacePath: stringField(input, "workspacePath") || undefined,
    startedAt: stringField(input, "startedAt") || new Date().toISOString(),
    status,
    completedAt: stringField(input, "completedAt") || undefined,
    exitCode: typeof input.exitCode === "number" ? input.exitCode : undefined,
    error: stringField(input, "error") || undefined,
  };
}

export function daemonCommandRecord(value: unknown): DaemonCommandRecord | undefined {
  const input = asRecord(value);
  const id = stringField(input, "id");
  const nodeId = stringField(input, "nodeId");
  const command = daemonNodeCommand(input.command);
  if (!id || !nodeId || !command) return undefined;
  const status = input.status === "queued" || input.status === "dispatched" || input.status === "completed" || input.status === "failed" || input.status === "cancelled"
    ? input.status
    : "queued";
  return {
    id,
    nodeId,
    command,
    status,
    createdAt: stringField(input, "createdAt") || new Date().toISOString(),
    updatedAt: stringField(input, "updatedAt") || new Date().toISOString(),
    dispatchedAt: stringField(input, "dispatchedAt") || undefined,
    completedAt: stringField(input, "completedAt") || undefined,
    error: stringField(input, "error") || undefined,
  };
}

export function sandboxRecord(value: unknown): SandboxRecord | undefined {
  const input = asRecord(value);
  const id = stringField(input, "id");
  const employeeId = stringField(input, "employeeId");
  if (!id || !employeeId) return undefined;
  const agents = asRecord(input.agents);
  return {
    id,
    employeeId,
    workspacePath: stringField(input, "workspacePath") || undefined,
    status: sandboxStatus(input.status),
    agents: {
      claude: agentStatus(agents.claude),
      pi: agentStatus(agents.pi),
      codex: agentStatus(agents.codex),
    },
    token: stringField(input, "token") || undefined,
    tokenHash: stringField(input, "tokenHash") || undefined,
    uiTokenHash: stringField(input, "uiTokenHash") || undefined,
    nodeTokenHash: stringField(input, "nodeTokenHash") || undefined,
    nodeToken: stringField(input, "nodeToken") || undefined,
    createdAt: stringField(input, "createdAt") || new Date().toISOString(),
    updatedAt: stringField(input, "updatedAt") || new Date().toISOString(),
    lastSeenAt: stringField(input, "lastSeenAt") || undefined,
    lastError: stringField(input, "lastError") || undefined,
  };
}

export function agentsReadyInSandbox(sandbox: SandboxRecord): AgentName[] {
  return (["claude", "pi", "codex"] as const).filter((agent) => sandbox.agents[agent] === "ready");
}

export function publicSandboxRecord(sandbox: SandboxRecord): SandboxRecord {
  const {
    token: _token,
    tokenHash: _tokenHash,
    uiTokenHash: _uiTokenHash,
    nodeTokenHash: _nodeTokenHash,
    nodeToken: _nodeToken,
    ...publicSandbox
  } = sandbox;
  return publicSandbox;
}

export function provisionedSandboxRecord(sandbox: SandboxRecord): SandboxRecord {
  return {
    ...publicSandboxRecord(sandbox),
    ...(sandbox.token ? { token: sandbox.token } : {}),
  };
}

export function offlineSandboxRecord(sandbox: SandboxRecord): SandboxRecord {
  return {
    ...sandbox,
    token: undefined,
    status: "stopped",
    agents: { claude: "unknown", pi: "unknown", codex: "unknown" },
    updatedAt: new Date().toISOString(),
    lastError: "Waiting for daemon node registration.",
  };
}

export function workspacePathsMatch(a?: string, b?: string): boolean {
  const left = normalizeWorkspacePath(a);
  const right = normalizeWorkspacePath(b);
  return Boolean(left && right && left === right);
}

export function normalizeWorkspacePath(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? resolve(trimmed) : undefined;
}

export function agentName(value: unknown): AgentName | undefined {
  return value === "claude" || value === "pi" || value === "codex" ? value : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  return typeof field === "string" ? field.trim() : "";
}

function daemonNodeCommand(value: unknown): DaemonNodeCommand | undefined {
  const input = asRecord(value);
  const id = stringField(input, "id");
  const type = stringField(input, "type");
  const sessionId = stringField(input, "sessionId");
  const runId = stringField(input, "runId");
  const taskGoal = stringField(input, "taskGoal");
  const agent = agentName(input.agent);
  if (!id || !sessionId || !runId || !agent) return undefined;
  if (type === "run.cancel") {
    const commandId = stringField(input, "commandId");
    if (!commandId) return undefined;
    return {
      id,
      type,
      commandId,
      sessionId,
      runId,
      agent,
      mode: input.mode === "review" ? "review" : "implement",
      reason: stringField(input, "reason") || "Cancelled by human.",
    };
  }
  if (type !== "run.start" || !taskGoal) return undefined;
  return {
    id,
    type,
    sessionId,
    runId,
    taskGoal,
    agent,
    mode: input.mode === "review" ? "review" : "implement",
    workspacePath: stringField(input, "workspacePath") || undefined,
  };
}

function sandboxStatus(value: unknown): SandboxStatus {
  return value === "provisioning" || value === "ready" || value === "running" || value === "stopped" || value === "failed"
    ? value
    : "stopped";
}

function agentStatus(value: unknown): SandboxRecord["agents"][AgentName] {
  return value === "ready" || value === "failed" ? value : "unknown";
}

function positiveIntEnv(name: string): number | undefined {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function dataDirForSessionStore(store: SessionStore): string {
  return store instanceof LocalSessionStore ? store.rootDir : DEFAULT_RELAY_DATA_DIR;
}
