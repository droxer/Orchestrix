import { DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS } from "relay-core";
import type { AgentName, AgentState, CodexTaskMode } from "relay-core";
import { initialAgentState } from "relay-core";
import { assignmentFailureOutcome, SessionController, type WorkflowStep } from "./controller.js";
import {
  LocalSessionStore,
  newRelayId,
  relayEvent,
  roleForAgent,
  type RelaySession,
  type SessionStore,
} from "./session.js";
import { ensureAgentReady, withOrchestratorSession } from "./workflow.js";
import { defaultExecutionManager } from "./execution.js";
import type { SandboxBackend, SandboxRecord, SandboxRunRequest } from "./daemon-types.js";
import {
  DaemonNodeRegistry,
  hashDaemonNodeToken,
  newSandboxId,
  sandboxNodeAuthError,
  sandboxUiAuthError,
} from "./daemon-registry.js";

export class ServerDaemonNodeBackend implements SandboxBackend {
  constructor(private readonly registry: DaemonNodeRegistry) {}

  async provision(input: { employeeId: string; workspacePath?: string; token?: string; nodeToken?: string }): Promise<SandboxRecord> {
    const existing = await this.registry.findByEmployee(input.employeeId, input.workspacePath) ??
      await this.registry.findLiveAuthenticatedNode(input.employeeId, input.nodeToken);
    if (existing) {
      const uiAuthError = sandboxUiAuthError(existing, input.token);
      if (!uiAuthError) return existing;
      const nodeAuthError = sandboxNodeAuthError(existing, input.nodeToken);
      if (!nodeAuthError && input.token) {
        return this.registry.register({
          sandboxId: existing.id,
          employeeId: existing.employeeId,
          token: input.nodeToken ?? "",
          workspacePath: existing.workspacePath,
          protocolVersion: DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS[0],
          supportedAgents: agentsReadyInSandbox(existing),
          status: existing.status === "running" ? "busy" : existing.status === "stopped" ? "stopped" : "ready",
        }, input.token);
      }
      throw new Error(nodeAuthError ?? uiAuthError);
    }
    if (!input.token) throw new Error("Sandbox token is required.");
    if (!input.nodeToken) throw new Error("Daemon node token is required.");
    const sandboxId = newSandboxId(input.employeeId);
    const now = new Date().toISOString();
    const sandbox: SandboxRecord = {
      id: sandboxId,
      employeeId: input.employeeId,
      workspacePath: input.workspacePath,
      status: "provisioning",
      agents: { claude: "unknown", pi: "unknown", codex: "unknown" },
      token: input.token,
      createdAt: now,
      updatedAt: now,
      lastError: "Waiting for daemon node registration.",
    };
    await this.registry.register({
      sandboxId,
      employeeId: input.employeeId,
      token: input.nodeToken,
      workspacePath: input.workspacePath,
      protocolVersion: DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS[0],
      supportedAgents: [],
      status: "stopped",
    }, sandbox.token);
    // Return the plaintext token to the caller exactly once. The registry
    // intentionally keeps only the hash in memory.
    const stored = this.registry.get(sandboxId) ?? {};
    return { ...sandbox, ...stored, token: input.token };
  }

  async get(sandboxId: string): Promise<SandboxRecord | undefined> {
    await this.registry.listReady();
    return this.registry.get(sandboxId);
  }

  async list(): Promise<SandboxRecord[]> {
    return this.registry.listReady();
  }

  async run(sandboxId: string, request: SandboxRunRequest): Promise<RelaySession> {
    await this.registry.listReady();
    const sandbox = this.registry.get(sandboxId);
    if (!sandbox) throw new Error(`Sandbox ${sandboxId} has no registered daemon node.`);
    if (sandbox.status !== "ready") throw new Error(`Sandbox ${sandboxId} daemon node is not ready.`);
    if (!await this.registry.isLive(sandboxId)) throw new Error(`Sandbox ${sandboxId} daemon node heartbeat expired.`);
    await this.registry.updateStatus(sandboxId, { status: "running", lastError: undefined });
    const controller = new SessionController(this.registry.store, {
      workspacePath: sandbox.workspacePath,
    });
    const resolvedSessionId = request.sessionId ?? (await controller.createSession(
      request.taskGoal,
      ["human", ...new Set(request.assignments.map((item) => item.agent))],
    )).id;
    let state: AgentState = initialAgentState(request.taskGoal);
    try {
      for (const assignment of request.assignments) {
        const mode = assignment.mode ?? "implement";
        const step: WorkflowStep = { agent: assignment.agent, mode, role: roleForAgent(assignment.agent, mode) };
        const runId = newRelayId("run");
        await controller.recordAgentStarted(resolvedSessionId, {
          runId,
          agent: step.agent,
          role: step.role,
          mode: step.mode,
        });
        const command: import("relay-core").DaemonNodeRunCommand = {
          id: newRelayId("cmd"),
          type: "run.start",
          sessionId: resolvedSessionId,
          runId,
          taskGoal: request.taskGoal,
          agent: assignment.agent,
          mode,
          workspacePath: sandbox.workspacePath,
          state,
        };
        let completed: import("./daemon-types.js").DaemonCompletionEvent;
        try {
          await this.registry.enqueue(sandboxId, command, controller);
          completed = await this.registry.waitForCompletion(command.id);
        } catch (error) {
          const outcome = error instanceof Error ? error.message : String(error);
          this.registry.clearRunOutput(runId);
          state = await controller.recordAgentCompleted(resolvedSessionId, state, {
            runId,
            agent: assignment.agent,
            mode,
            status: "failed",
            exitCode: 1,
            agentLog: "",
          });
          await controller.failSession(resolvedSessionId, outcome);
          await this.registry.updateStatus(sandboxId, { status: "failed", lastError: outcome });
          return this.registry.store.getSession(resolvedSessionId);
        }
        if (completed.type === "run.failed") {
          this.registry.clearRunOutput(runId);
          state = await controller.recordAgentCompleted(resolvedSessionId, state, {
            runId,
            agent: assignment.agent,
            mode,
            status: "failed",
            exitCode: completed.exitCode ?? 1,
            agentLog: completed.error,
          });
          await controller.failSession(resolvedSessionId, completed.error);
          await this.registry.updateStatus(sandboxId, { status: "ready", lastError: completed.error });
          return this.registry.store.getSession(resolvedSessionId);
        }
        if (completed.type === "run.cancelled") {
          this.registry.clearRunOutput(runId);
          state = await controller.recordAgentCompleted(resolvedSessionId, state, {
            runId,
            agent: assignment.agent,
            mode,
            status: "cancelled",
            exitCode: 130,
            agentLog: "",
          });
          await controller.cancelSession(resolvedSessionId, completed.reason);
          await this.registry.updateStatus(sandboxId, { status: "ready", lastError: completed.reason });
          return this.registry.store.getSession(resolvedSessionId);
        }
        const agentLog = completed.agentLog || this.registry.outputForRun(runId);
        this.registry.clearRunOutput(runId);
        state = await controller.recordAgentCompleted(resolvedSessionId, state, {
          runId,
          agent: assignment.agent,
          mode,
          status: completed.exitCode === 0 ? "completed" : "failed",
          exitCode: completed.exitCode,
          agentLog,
          codexVerdict: completed.codexVerdict,
          codexFeedback: completed.codexFeedback,
        });
        if (assignment.agent === "codex" && mode === "review" && completed.codexVerdict !== "approved") {
          const outcome = completed.codexVerdict === "rejected"
            ? "Codex rejected the work."
            : "Codex review did not approve the work.";
          await controller.failSession(resolvedSessionId, outcome);
          await this.registry.updateStatus(sandboxId, { status: "ready", lastError: outcome });
          return this.registry.store.getSession(resolvedSessionId);
        }
        if (completed.exitCode !== 0) {
          const outcome = assignmentFailureOutcome(step, state);
          await controller.failSession(resolvedSessionId, outcome);
          await this.registry.updateStatus(sandboxId, { status: "ready", lastError: outcome });
          return this.registry.store.getSession(resolvedSessionId);
        }
      }
      await controller.completeSession(resolvedSessionId, "Assignments completed.");
      await this.registry.updateStatus(sandboxId, { status: "ready", lastError: undefined });
      return this.registry.store.getSession(resolvedSessionId);
    } catch (error) {
      const outcome = error instanceof Error ? error.message : String(error);
      await failSessionIfOpen(this.registry.store, resolvedSessionId, outcome);
      await this.registry.updateStatus(sandboxId, {
        status: "failed",
        lastError: outcome,
      });
      throw error;
    }
  }

  async cancelRun(sandboxId: string, sessionId: string, reason: string): Promise<RelaySession> {
    await this.registry.listReady();
    const sandbox = this.registry.get(sandboxId);
    if (!sandbox) throw new Error(`Sandbox ${sandboxId} has no registered daemon node.`);
    const active = await this.registry.cancelActiveRun(sandboxId, sessionId, reason);
    if (!active) throw new Error(`Session ${sessionId} has no active daemon node run.`);
    return this.registry.store.getSession(sessionId);
  }
}

export class LocalSandboxBackend implements SandboxBackend {
  private readonly sandboxes = new Map<string, SandboxRecord>();
  private readonly activeRuns = new Map<string, {
    controller: AbortController;
    sessionController: SessionController;
  }>();
  private readonly store: SessionStore;

  constructor(private readonly options: Pick<import("./daemon-types.js").RelayDaemonOptions, "store" | "sink" | "execStream" | "withOrchestratorSession" | "ensureAgentReady"> = {}) {
    this.store = options.store ?? new LocalSessionStore();
  }

  async provision(input: { employeeId: string; workspacePath?: string; token?: string }): Promise<SandboxRecord> {
    if (!input.token) throw new Error("Sandbox token is required.");
    const now = new Date().toISOString();
    const tokenHash = hashDaemonNodeToken(input.token);
    const sandbox: SandboxRecord = {
      id: newSandboxId(input.employeeId),
      employeeId: input.employeeId,
      workspacePath: input.workspacePath,
      token: undefined,
      tokenHash,
      uiTokenHash: tokenHash,
      status: "ready",
      agents: {
        claude: "unknown",
        pi: "unknown",
        codex: "unknown",
      },
      createdAt: now,
      updatedAt: now,
    };
    this.sandboxes.set(sandbox.id, sandbox);
    return { ...sandbox, token: input.token };
  }

  async get(sandboxId: string): Promise<SandboxRecord | undefined> {
    return this.sandboxes.get(sandboxId);
  }

  async list(): Promise<SandboxRecord[]> {
    return [...this.sandboxes.values()];
  }

  async run(sandboxId: string, request: SandboxRunRequest): Promise<RelaySession> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) throw new Error("Sandbox not found.");
    if (sandbox.status === "running") {
      throw new Error(`Sandbox ${sandboxId} is already running a task.`);
    }
    this.updateSandbox(sandboxId, { status: "running", lastError: undefined });
    const controller = new SessionController(this.store, {
      workspacePath: sandbox.workspacePath,
      sink: this.options.sink,
      execStream: this.options.execStream ?? defaultExecutionManager.execStream.bind(defaultExecutionManager),
    });
    const sessionId = request.sessionId ?? (await controller.createSession(
      request.taskGoal,
      ["human", ...new Set(request.assignments.map((item) => item.agent))],
    )).id;
    const abortController = new AbortController();
    const runKey = localRunKey(sandboxId, sessionId);
    this.activeRuns.set(runKey, { controller: abortController, sessionController: controller });
    try {
      await (this.options.withOrchestratorSession ?? withOrchestratorSession)(async () => {
        for (const agent of new Set(request.assignments.map((assignment) => assignment.agent))) {
          await (this.options.ensureAgentReady ?? ensureAgentReady)(agent, this.options.sink, abortController.signal);
        }
        await controller.runAssignments(sessionId, request.taskGoal, request.assignments.map((assignment) => ({
          agent: assignment.agent,
          mode: assignment.mode ?? "implement",
        })), {
          sink: this.options.sink,
          execStream: this.options.execStream ?? defaultExecutionManager.execStream.bind(defaultExecutionManager),
          signal: abortController.signal,
        });
      }, this.options.sink, {
        boxName: sandboxBoxName(sandboxId),
        workspacePath: sandbox.workspacePath,
      });
      this.markAgentsReady(sandboxId, request.assignments.map((assignment) => assignment.agent));
      this.updateSandbox(sandboxId, { status: "ready" });
    } catch (error) {
      if (abortController.signal.aborted) {
        const reason = abortReason(abortController.signal);
        await controller.cancelSession(sessionId, reason);
        this.updateSandbox(sandboxId, { status: "ready", lastError: reason });
        return this.store.getSession(sessionId);
      }
      const outcome = error instanceof Error ? error.message : String(error);
      await failSessionIfOpen(this.store, sessionId, outcome);
      this.updateSandbox(sandboxId, {
        status: "failed",
        lastError: outcome,
      });
      throw error;
    } finally {
      this.activeRuns.delete(runKey);
    }
    return this.store.getSession(sessionId);
  }

  async cancelRun(sandboxId: string, sessionId: string, reason: string): Promise<RelaySession> {
    const active = this.activeRuns.get(localRunKey(sandboxId, sessionId));
    if (!active) throw new Error(`Session ${sessionId} has no active local sandbox run.`);
    active.controller.abort(reason);
    return active.sessionController.cancelSession(sessionId, reason);
  }

  private markAgentsReady(sandboxId: string, agents: AgentName[]): void {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) return;
    const nextAgents = { ...sandbox.agents };
    for (const agent of agents) nextAgents[agent] = "ready";
    this.updateSandbox(sandboxId, { agents: nextAgents });
  }

  private updateSandbox(sandboxId: string, patch: Partial<SandboxRecord>): void {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) return;
    this.sandboxes.set(sandboxId, {
      ...sandbox,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }
}

function localRunKey(sandboxId: string, sessionId: string): string {
  return `${sandboxId}\0${sessionId}`;
}

function abortReason(signal: AbortSignal): string {
  return typeof signal.reason === "string" && signal.reason ? signal.reason : "Cancelled by human.";
}

async function failSessionIfOpen(store: SessionStore, sessionId: string, outcome: string): Promise<void> {
  try {
    const session = await store.getSession(sessionId);
    if (session.status === "completed" || session.status === "failed" || session.status === "cancelled") return;
    await store.appendEvent(sessionId, relayEvent("session.failed", sessionId, { outcome }));
  } catch {
    // If the session cannot be read here, preserve the original execution error.
  }
}

function agentsReadyInSandbox(sandbox: SandboxRecord): AgentName[] {
  return (["claude", "pi", "codex"] as const).filter((agent) => sandbox.agents[agent] === "ready");
}

function sandboxBoxName(sandboxId: string): string {
  return `relay-${sandboxId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 48)}`;
}
