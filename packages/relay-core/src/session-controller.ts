import { getAgent } from "./agents.js";
import { runAgentNode } from "./nodes.js";
import { routeClaudeHandoff, routeCodexHandoff, routePiHandoff, type Route } from "./routing.js";
import {
  GUEST_WORKSPACE,
  initialAgentState,
  mergeAgentState,
  type AgentName,
  type AgentRunOptions,
  type AgentState,
  type CodexReviewVerdict,
  type CodexTaskMode,
} from "./state.js";
import type { AgentOutputSink } from "./format.js";
import {
  LocalSessionStore,
  newRelayId,
  relayEvent,
  roleForAgent,
  type AgentEventSink,
  type AgentRole,
  type HumanDecisionKind,
  type RelayArtifact,
  type RelayArtifactKind,
  type RelaySession,
  type SessionStore,
} from "./session-store.js";
import { relayTaskEvent, type TaskStore } from "./task-store.js";

export interface WorkflowStep {
  agent: AgentName;
  mode: CodexTaskMode;
  role?: ReturnType<typeof roleForAgent>;
}

export interface SessionControllerOptions {
  store?: SessionStore;
  taskStore?: TaskStore;
  taskId?: string;
  workspacePath?: string;
  ownerEmployeeId?: string;
  sink?: AgentOutputSink;
  signal?: AbortSignal;
  execStream?: AgentRunOptions["execStream"];
  onUpdate?: (session: RelaySession) => void;
}

/** A review-mode assignment given to a review-capable agent (today only Codex). */
export function isReviewAssignment(agent: AgentName, mode: CodexTaskMode): boolean {
  return mode === "review" && getAgent(agent).capabilities.review;
}

export function assignmentSucceeded(step: WorkflowStep, state: AgentState): boolean {
  if (state.last_exit_code !== 0) return false;
  if (isReviewAssignment(step.agent, step.mode)) return state.codex_verdict === "approved";
  return true;
}

export function assignmentFailureOutcome(step: WorkflowStep, state: AgentState): string {
  if (state.last_exit_code !== 0) {
    return `${step.agent} ${step.mode} failed with exit code ${state.last_exit_code}.`;
  }
  if (isReviewAssignment(step.agent, step.mode)) {
    if (state.codex_verdict === "rejected") return "Codex rejected the work.";
    return "Codex review did not approve the work.";
  }
  return `${step.agent} ${step.mode} failed.`;
}

export class SessionController implements AgentEventSink {
  private activeSessionId = "";
  private readonly pendingOutputWrites = new Set<Promise<void>>();

  constructor(
    public readonly store: SessionStore = new LocalSessionStore(),
    private readonly options: Omit<SessionControllerOptions, "store"> = {},
  ) {}

  async createSession(taskGoal: string, participants: string[] = ["human"], pendingStart = false): Promise<RelaySession> {
    const session = await this.store.createSession({
      workspacePath: this.options.workspacePath ?? GUEST_WORKSPACE,
      ownerEmployeeId: this.options.ownerEmployeeId,
      taskGoal,
      participants,
      status: pendingStart ? "pending_approval" : "running",
      pendingDecision: pendingStart ? "start" : undefined,
    });
    this.activeSessionId = session.id;
    this.linkTaskSession(session.id);
    this.emitUpdate(session);
    return session;
  }

  async getSession(sessionId = this.activeSessionId): Promise<RelaySession> {
    return this.store.getSession(sessionId);
  }

  async completeSession(sessionId: string, outcome: string): Promise<RelaySession> {
    const session = await this.append(sessionId, relayEvent("session.completed", sessionId, { outcome }));
    await this.updateTaskStatus("done", outcome, { sessionId });
    return session;
  }

  async failSession(sessionId: string, outcome: string): Promise<RelaySession> {
    const session = await this.append(sessionId, relayEvent("session.failed", sessionId, { outcome }));
    await this.updateTaskStatus("blocked", outcome, { sessionId });
    return session;
  }

  async cancelSession(sessionId: string, note = "Cancelled by human."): Promise<RelaySession> {
    const current = await this.store.getSession(sessionId);
    if (current.status === "cancelled") return current;
    const session = await this.append(sessionId, relayEvent("human.decision", sessionId, {
      decision: {
        id: newRelayId("dec"),
        kind: "cancel",
        createdAt: new Date().toISOString(),
        note,
        ...(this.options.ownerEmployeeId ? { actorEmployeeId: this.options.ownerEmployeeId } : {}),
      },
    }));
    await this.updateTaskStatus("blocked", note, { sessionId });
    return session;
  }

  async recordDecision(sessionId: string, kind: HumanDecisionKind, note?: string, targetAgent?: AgentName): Promise<RelaySession> {
    const decision = {
      id: newRelayId("dec"),
      kind,
      createdAt: new Date().toISOString(),
      note,
      targetAgent,
      ...(this.options.ownerEmployeeId ? { actorEmployeeId: this.options.ownerEmployeeId } : {}),
    };
    await this.append(sessionId, relayEvent("human.decision", sessionId, { decision }));
    if (kind === "approve") {
      return this.append(sessionId, relayEvent("session.status", sessionId, {
        status: "running",
        phase: "approved",
      }));
    }
    if (kind === "reject") {
      return this.append(sessionId, relayEvent("session.status", sessionId, {
        status: "waiting_for_human",
        phase: "feedback",
        pendingDecision: "feedback",
      }));
    }
    if (kind === "cancel") {
      return this.cancelSession(sessionId, note);
    }
    if (kind === "mark_done") {
      return this.completeSession(sessionId, note || "Marked done from Relay API.");
    }
    if (kind === "rerun") {
      return this.append(sessionId, relayEvent("session.status", sessionId, {
        status: "pending_approval",
        phase: targetAgent ? `rerun:${targetAgent}` : "rerun",
        pendingDecision: "start",
      }));
    }
    if (kind === "handoff" && targetAgent) {
      return this.append(sessionId, relayEvent("session.status", sessionId, {
        status: "running",
        phase: `handoff:${targetAgent}`,
      }));
    }
    return this.getSession(sessionId);
  }

  async handoffSession(sessionId: string, targetAgent: AgentName, assignments: WorkflowStep[] = [{ agent: targetAgent, mode: "implement" }], note?: string): Promise<RelaySession> {
    const decision = {
      id: newRelayId("dec"),
      kind: "handoff" as const,
      createdAt: new Date().toISOString(),
      note,
      targetAgent,
      ...(this.options.ownerEmployeeId ? { actorEmployeeId: this.options.ownerEmployeeId } : {}),
    };
    await this.append(sessionId, relayEvent("human.decision", sessionId, { decision }));
    await this.assignSession(sessionId, assignments);
    return this.append(sessionId, relayEvent("session.status", sessionId, {
      status: "pending_approval",
      phase: `handoff:${targetAgent}`,
      pendingDecision: "start",
    }));
  }

  async assignSession(sessionId: string, assignments: WorkflowStep[]): Promise<RelaySession> {
    const body = JSON.stringify({ assignments }, null, 2);
    await this.createArtifact(sessionId, {
      kind: "plan",
      title: "Assignment plan",
      body,
      extension: "json",
    });
    return this.append(sessionId, relayEvent("session.status", sessionId, {
      status: "pending_approval",
      phase: "waiting:start",
      pendingDecision: "start",
    }));
  }

  async setPendingStart(sessionId: string): Promise<RelaySession> {
    return this.append(sessionId, relayEvent("session.status", sessionId, {
      status: "pending_approval",
      phase: "waiting:start",
      pendingDecision: "start",
    }));
  }

  async createArtifact(
    sessionId: string,
    input: {
      kind: RelayArtifactKind;
      title: string;
      body: string;
      extension?: string;
      agentRunId?: string;
    },
  ): Promise<RelayArtifact> {
    const artifact = await this.store.writeArtifact(sessionId, input);
    await this.append(sessionId, relayEvent("artifact.created", sessionId, { artifact }));
    return artifact;
  }

  async recordAgentStarted(sessionId: string, step: { runId: string; agent: AgentName; role?: AgentRole; mode: CodexTaskMode }): Promise<RelaySession> {
    this.activeSessionId = sessionId;
    await this.linkTaskSession(sessionId);
    const role = step.role ?? roleForAgent(step.agent, step.mode);
    const session = await this.append(sessionId, relayEvent("agent.started", sessionId, {
      runId: step.runId,
      agent: step.agent,
      role,
      mode: step.mode,
    }));
    await this.updateTaskStatus(step.mode === "review" ? "review" : "running", `${step.agent} ${step.mode} started.`, {
      agent: step.agent,
      sessionId,
    });
    return session;
  }

  async recordAgentOutput(sessionId: string, runId: string, agent: AgentName, stream: "stdout" | "stderr", text: string): Promise<void> {
    await this.append(sessionId, relayEvent("agent.output", sessionId, {
      runId,
      agent,
      stream,
      text,
    }));
  }

  async recordAgentCompleted(
    sessionId: string,
    state: AgentState,
    input: {
      runId: string;
      agent: AgentName;
      mode: CodexTaskMode;
      status: "completed" | "failed" | "cancelled";
      exitCode: number;
      agentLog: string;
      codexVerdict?: CodexReviewVerdict | "";
      codexFeedback?: string;
    },
  ): Promise<AgentState> {
    this.activeSessionId = sessionId;
    const statePatch: Partial<AgentState> = {
      agent_logs: [input.agentLog],
      last_exit_code: input.exitCode,
    };
    if (isReviewAssignment(input.agent, input.mode)) {
      statePatch.codex_verdict = input.codexVerdict ?? "";
      statePatch.codex_feedback = input.codexFeedback ?? "";
    }
    await this.waitForPendingOutputWrites();
    await this.createArtifact(sessionId, {
      kind: input.mode === "review" ? "review" : "command_log",
      title: `${input.agent} ${input.mode} output`,
      body: input.agentLog,
      agentRunId: input.runId,
    });
    await this.append(sessionId, relayEvent("agent.completed", sessionId, {
      runId: input.runId,
      agent: input.agent,
      status: input.status,
      exitCode: input.exitCode,
    }));
    if (input.status === "failed") {
      await this.updateTaskStatus("blocked", `${input.agent} ${input.mode} failed with exit code ${input.exitCode}.`, {
        agent: input.agent,
        sessionId,
      });
    } else if (input.mode === "review") {
      await this.updateTaskStatus("review", `${input.agent} review completed.`, { agent: input.agent, sessionId });
    } else {
      await this.updateTaskStatus("waiting_for_human", `${input.agent} ${input.mode} completed.`, {
        agent: input.agent,
        sessionId,
      });
    }
    if (isReviewAssignment(input.agent, input.mode)) {
      const verdict = input.codexVerdict || "failed";
      await this.append(sessionId, relayEvent("review.verdict", sessionId, {
        runId: input.runId,
        verdict,
        feedback: input.codexFeedback ?? "",
      }));
      if (verdict === "approved") {
        await this.updateTaskStatus("done", "Codex approved the work.", { agent: input.agent, sessionId });
      } else if (verdict === "rejected") {
        await this.updateTaskStatus("blocked", "Codex rejected the work.", { agent: input.agent, sessionId });
      }
    }
    return mergeAgentState(state, statePatch);
  }

  async runStep(
    sessionId: string,
    state: AgentState,
    step: WorkflowStep,
    options: Pick<AgentRunOptions, "signal" | "sink" | "execStream"> = {},
  ): Promise<AgentState> {
    this.activeSessionId = sessionId;
    await this.linkTaskSession(sessionId);
    const runId = newRelayId("run");
    const role = step.role ?? roleForAgent(step.agent, step.mode);
    await this.append(sessionId, relayEvent("agent.started", sessionId, {
      runId,
      agent: step.agent,
      role,
      mode: step.mode,
    }));
    await this.updateTaskStatus(step.mode === "review" ? "review" : "running", `${step.agent} ${step.mode} started.`, {
      agent: step.agent,
      sessionId,
    });

    const runOptions: AgentRunOptions = {
      sink: options.sink ?? this.options.sink,
      signal: options.signal ?? this.options.signal,
      execStream: options.execStream ?? this.options.execStream,
      eventSink: this,
      runId,
      agent: step.agent,
    };

    let patch: Partial<AgentState>;
    try {
      patch = await runAgentNode(step.agent, step.mode, state, runOptions);
    } catch (error) {
      const status = runOptions.signal?.aborted ? "cancelled" : "failed";
      await this.waitForPendingOutputWrites();
      await this.append(sessionId, relayEvent("agent.completed", sessionId, {
        runId,
        agent: step.agent,
        status,
        exitCode: status === "cancelled" ? 130 : 1,
      }));
      const message = error instanceof Error ? error.message : String(error);
      await this.updateTaskStatus("blocked", message, {
        agent: step.agent,
        sessionId,
      });
      throw error;
    }

    const next = mergeAgentState(state, patch);
    const status = runOptions.signal?.aborted ? "cancelled" : next.last_exit_code === 0 ? "completed" : "failed";
    await this.waitForPendingOutputWrites();
    const artifact = await this.store.writeArtifact(sessionId, {
      kind: step.mode === "review" ? "review" : "command_log",
      title: `${step.agent} ${step.mode} output`,
      body: next.agent_logs.slice(-1)[0] ?? "",
      agentRunId: runId,
    });
    await this.append(sessionId, relayEvent("artifact.created", sessionId, { artifact }));
    await this.append(sessionId, relayEvent("agent.completed", sessionId, {
      runId,
      agent: step.agent,
      status,
      exitCode: next.last_exit_code,
    }));
    if (status === "failed") {
      await this.updateTaskStatus("blocked", `${step.agent} ${step.mode} failed with exit code ${next.last_exit_code}.`, {
        agent: step.agent,
        sessionId,
      });
    } else if (step.mode === "review") {
      await this.updateTaskStatus("review", `${step.agent} review completed.`, { agent: step.agent, sessionId });
    } else {
      await this.updateTaskStatus("waiting_for_human", `${step.agent} ${step.mode} completed.`, {
        agent: step.agent,
        sessionId,
      });
    }
    if (isReviewAssignment(step.agent, step.mode)) {
      await this.append(sessionId, relayEvent("review.verdict", sessionId, {
        runId,
        verdict: next.codex_verdict || "failed",
        feedback: next.codex_feedback,
      }));
      if (next.codex_verdict === "approved") {
        await this.updateTaskStatus("done", "Codex approved the work.", { agent: step.agent, sessionId });
      } else if (next.codex_verdict === "rejected") {
        await this.updateTaskStatus("blocked", "Codex rejected the work.", { agent: step.agent, sessionId });
      }
    }
    return next;
  }

  async runAssignments(sessionId: string, taskGoal: string, assignments: WorkflowStep[], options: Pick<AgentRunOptions, "signal" | "sink" | "execStream"> = {}): Promise<AgentState> {
    let state = initialAgentState(taskGoal);
    for (const assignment of assignments) {
      if (options.signal?.aborted) {
        await this.cancelSession(sessionId, abortReason(options.signal) ?? "Task cancelled before the next agent started.");
        return state;
      }
      state = await this.runStep(sessionId, state, assignment, options);
      if (options.signal?.aborted) {
        await this.cancelSession(sessionId, abortReason(options.signal) ?? "Task cancelled during agent execution.");
        return state;
      }
      if (!assignmentSucceeded(assignment, state)) {
        await this.failSession(sessionId, assignmentFailureOutcome(assignment, state));
        return state;
      }
    }
    await this.completeSession(sessionId, "Assignments completed.");
    return state;
  }

  async runDefaultWorkflow(sessionId: string, initialState: AgentState, options: Pick<AgentRunOptions, "signal" | "sink" | "execStream"> = {}): Promise<AgentState> {
    let state = initialState;
    let next: Route = "claude_implement";
    while (next !== "__end__") {
      if (next === "claude_implement") {
        state = await this.runStep(sessionId, state, { agent: "claude", mode: "implement", role: "implementer" }, options);
        next = routeClaudeHandoff(state, options.sink);
      } else if (next === "pi_implement") {
        state = await this.runStep(sessionId, state, { agent: "pi", mode: "implement", role: "tester" }, options);
        next = routePiHandoff(state, options.sink);
      } else {
        state = await this.runStep(sessionId, state, { agent: "codex", mode: "review", role: "reviewer" }, options);
        next = routeCodexHandoff(state, options.sink);
      }
    }
    const outcome = state.codex_verdict === "approved" ? "Default workflow completed and Codex approved." : "Default workflow halted.";
    if (state.codex_verdict === "approved") {
      await this.completeSession(sessionId, outcome);
    } else {
      await this.failSession(sessionId, outcome);
    }
    return state;
  }

  agentOutput(runId: string, agent: AgentName, stream: "stdout" | "stderr", text: string): void {
    if (!this.activeSessionId) return;
    const pending = this.recordAgentOutput(this.activeSessionId, runId, agent, stream, text);
    this.pendingOutputWrites.add(pending);
    pending.finally(() => this.pendingOutputWrites.delete(pending));
  }

  private async append(sessionId: string, event: Parameters<SessionStore["appendEvent"]>[1]): Promise<RelaySession> {
    const session = await this.store.appendEvent(sessionId, event);
    this.emitUpdate(session);
    return session;
  }

  private emitUpdate(session: RelaySession): void {
    this.options.onUpdate?.(session);
  }

  private async linkTaskSession(sessionId: string): Promise<void> {
    if (!this.options.taskStore || !this.options.taskId) return;
    const task = await this.options.taskStore.getTask(this.options.taskId);
    if (task.linkedSessionIds.includes(sessionId)) return;
    await this.options.taskStore.linkSession(this.options.taskId, sessionId);
  }

  private async updateTaskStatus(
    status: "assigned" | "running" | "waiting_for_human" | "review" | "done" | "blocked",
    message: string,
    input: { agent?: AgentName; sessionId?: string } = {},
  ): Promise<void> {
    if (!this.options.taskStore || !this.options.taskId) return;
    await this.options.taskStore.appendEvent(this.options.taskId, relayTaskEvent("task.status", this.options.taskId, { status }));
    await this.options.taskStore.recordActivity(this.options.taskId, message, input);
  }

  private async waitForPendingOutputWrites(): Promise<void> {
    if (this.pendingOutputWrites.size === 0) return;
    await Promise.all([...this.pendingOutputWrites]);
  }
}

function abortReason(signal: AbortSignal): string | undefined {
  return typeof signal.reason === "string" && signal.reason ? signal.reason : undefined;
}
