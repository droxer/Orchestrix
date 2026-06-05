import {
  claudeImplementNode,
  codexImplementNode,
  codexReviewNode,
  piImplementNode,
} from "./nodes.js";
import { routeClaudeHandoff, routeCodexHandoff, routePiHandoff, type Route } from "./routing.js";
import {
  GUEST_WORKSPACE,
  initialAgentState,
  mergeAgentState,
  type AgentName,
  type AgentOutputSink,
  type AgentRunOptions,
  type AgentState,
  type CodexTaskMode,
} from "./state.js";
import {
  LocalSessionStore,
  newRelayId,
  relayEvent,
  roleForAgent,
  type AgentEventSink,
  type HumanDecisionKind,
  type RelaySession,
  type SessionStore,
} from "./session.js";
import { relayTaskEvent, type TaskStore } from "./task.js";

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
  sink?: AgentOutputSink;
  signal?: AbortSignal;
  execStream?: AgentRunOptions["execStream"];
  onUpdate?: (session: RelaySession) => void;
}

export class SessionController implements AgentEventSink {
  private activeSessionId = "";

  constructor(
    public readonly store: SessionStore = new LocalSessionStore(),
    private readonly options: Omit<SessionControllerOptions, "store"> = {},
  ) {}

  createSession(taskGoal: string, participants: string[] = ["human"], pendingStart = false): RelaySession {
    const session = this.store.createSession({
      workspacePath: this.options.workspacePath ?? GUEST_WORKSPACE,
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

  getSession(sessionId = this.activeSessionId): RelaySession {
    return this.store.getSession(sessionId);
  }

  completeSession(sessionId: string, outcome: string): RelaySession {
    const session = this.append(sessionId, relayEvent("session.completed", sessionId, { outcome }));
    this.updateTaskStatus("done", outcome, { sessionId });
    return session;
  }

  failSession(sessionId: string, outcome: string): RelaySession {
    const session = this.append(sessionId, relayEvent("session.failed", sessionId, { outcome }));
    this.updateTaskStatus("blocked", outcome, { sessionId });
    return session;
  }

  recordDecision(sessionId: string, kind: HumanDecisionKind, note?: string, targetAgent?: AgentName): RelaySession {
    const decision = {
      id: newRelayId("dec"),
      kind,
      createdAt: new Date().toISOString(),
      note,
      targetAgent,
    };
    let session = this.store.appendEvent(sessionId, relayEvent("human.decision", sessionId, { decision }));
    if (kind === "approve") {
      session = this.store.appendEvent(sessionId, relayEvent("session.status", sessionId, {
        status: "running",
        phase: "approved",
      }));
    } else if (kind === "reject") {
      session = this.store.appendEvent(sessionId, relayEvent("session.status", sessionId, {
        status: "waiting_for_human",
        phase: "feedback",
        pendingDecision: "feedback",
      }));
    }
    this.emitUpdate(session);
    return session;
  }

  async runStep(
    sessionId: string,
    state: AgentState,
    step: WorkflowStep,
    options: Pick<AgentRunOptions, "signal" | "sink" | "execStream"> = {},
  ): Promise<AgentState> {
    this.activeSessionId = sessionId;
    this.linkTaskSession(sessionId);
    const runId = newRelayId("run");
    const role = step.role ?? roleForAgent(step.agent, step.mode);
    this.append(sessionId, relayEvent("agent.started", sessionId, {
      runId,
      agent: step.agent,
      role,
      mode: step.mode,
    }));
    this.updateTaskStatus(step.mode === "review" ? "review" : "running", `${step.agent} ${step.mode} started.`, {
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
    if (step.agent === "claude") {
      patch = await claudeImplementNode(state, runOptions);
    } else if (step.agent === "pi") {
      patch = await piImplementNode(state, runOptions);
    } else if (step.mode === "review") {
      patch = await codexReviewNode(state, runOptions);
    } else {
      patch = await codexImplementNode(state, runOptions);
    }

    const next = mergeAgentState(state, patch);
    const status = next.last_exit_code === 0 ? "completed" : "failed";
    const artifact = this.store.writeArtifact(sessionId, {
      kind: step.mode === "review" ? "review" : "command_log",
      title: `${step.agent} ${step.mode} output`,
      body: next.agent_logs.slice(-1)[0] ?? "",
      agentRunId: runId,
    });
    this.append(sessionId, relayEvent("artifact.created", sessionId, { artifact }));
    this.append(sessionId, relayEvent("agent.completed", sessionId, {
      runId,
      agent: step.agent,
      status,
      exitCode: next.last_exit_code,
    }));
    if (status === "failed") {
      this.updateTaskStatus("blocked", `${step.agent} ${step.mode} failed with exit code ${next.last_exit_code}.`, {
        agent: step.agent,
        sessionId,
      });
    } else if (step.mode === "review") {
      this.updateTaskStatus("review", `${step.agent} review completed.`, { agent: step.agent, sessionId });
    } else {
      this.updateTaskStatus("waiting_for_human", `${step.agent} ${step.mode} completed.`, {
        agent: step.agent,
        sessionId,
      });
    }
    if (step.agent === "codex" && step.mode === "review") {
      this.append(sessionId, relayEvent("review.verdict", sessionId, {
        runId,
        verdict: next.codex_verdict || "failed",
        feedback: next.codex_feedback,
      }));
      if (next.codex_verdict === "approved") {
        this.updateTaskStatus("done", "Codex approved the work.", { agent: step.agent, sessionId });
      } else if (next.codex_verdict === "rejected") {
        this.updateTaskStatus("blocked", "Codex rejected the work.", { agent: step.agent, sessionId });
      }
    }
    return next;
  }

  async runAssignments(sessionId: string, taskGoal: string, assignments: WorkflowStep[], options: Pick<AgentRunOptions, "signal" | "sink" | "execStream"> = {}): Promise<AgentState> {
    let state = initialAgentState(taskGoal);
    for (const assignment of assignments) {
      if (options.signal?.aborted) {
        this.failSession(sessionId, "Task cancelled before the next agent started.");
        return state;
      }
      state = await this.runStep(sessionId, state, assignment, options);
      if (options.signal?.aborted) {
        this.failSession(sessionId, "Task cancelled during agent execution.");
        return state;
      }
    }
    this.completeSession(sessionId, "Assignments completed.");
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
      this.completeSession(sessionId, outcome);
    } else {
      this.failSession(sessionId, outcome);
    }
    return state;
  }

  agentOutput(runId: string, agent: AgentName, stream: "stdout" | "stderr", text: string): void {
    if (!this.activeSessionId) return;
    this.append(this.activeSessionId, relayEvent("agent.output", this.activeSessionId, {
      runId,
      agent,
      stream,
      text,
    }));
  }

  private append(sessionId: string, event: Parameters<SessionStore["appendEvent"]>[1]): RelaySession {
    const session = this.store.appendEvent(sessionId, event);
    this.emitUpdate(session);
    return session;
  }

  private emitUpdate(session: RelaySession): void {
    this.options.onUpdate?.(session);
  }

  private linkTaskSession(sessionId: string): void {
    if (!this.options.taskStore || !this.options.taskId) return;
    const task = this.options.taskStore.getTask(this.options.taskId);
    if (task.linkedSessionIds.includes(sessionId)) return;
    this.options.taskStore.linkSession(this.options.taskId, sessionId);
  }

  private updateTaskStatus(
    status: "assigned" | "running" | "waiting_for_human" | "review" | "done" | "blocked",
    message: string,
    input: { agent?: AgentName; sessionId?: string } = {},
  ): void {
    if (!this.options.taskStore || !this.options.taskId) return;
    this.options.taskStore.appendEvent(this.options.taskId, relayTaskEvent("task.status", this.options.taskId, { status }));
    this.options.taskStore.recordActivity(this.options.taskId, message, input);
  }
}
