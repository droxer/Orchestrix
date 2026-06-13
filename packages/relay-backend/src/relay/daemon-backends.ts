import { AGENT_NAMES, DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS } from "relay-core";
import type { AgentName, AgentState } from "relay-core";
import { initialAgentState } from "relay-core";
import { assignmentFailureOutcome, isReviewAssignment, SessionController, type WorkflowStep } from "./controller.js";
import {
  newRelayId,
  relayEvent,
  roleForAgent,
  type RelaySession,
  type SessionStore,
} from "./session.js";
import type { SandboxBackend, SandboxRecord, SandboxRunRequest } from "./daemon-types.js";
import {
  DaemonNodeRegistry,
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
      agents: Object.fromEntries(AGENT_NAMES.map((agent) => [agent, "unknown"])) as SandboxRecord["agents"],
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
        if (isReviewAssignment(assignment.agent, mode) && completed.codexVerdict !== "approved") {
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
  return AGENT_NAMES.filter((agent) => sandbox.agents[agent] === "ready");
}

