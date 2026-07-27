import { runAgentNode } from "./nodes.js";
import { extractLastAssistantText } from "./last-assistant-text.js";
import { routeClaudeHandoff, routePiHandoff, type Route } from "./routing.js";
import {
  GUEST_WORKSPACE,
  initialAgentState,
  mergeAgentState,
  type AgentName,
  type AgentRunOptions,
  type AgentState,
  type AgentTaskMode,
} from "./state.js";
import type { AgentOutputSink } from "./format.js";
import {
  newRelayId,
  relayEvent,
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
  agentId?: string;
  mode: AgentTaskMode;
  role?: AgentRole;
}

export interface SessionControllerOptions {
  taskStore?: TaskStore;
  taskId?: string;
  workspacePath?: string;
  daemonNodeId?: string;
  ownerEmployeeId?: string;
  teamId?: string;
  sink?: AgentOutputSink;
  signal?: AbortSignal;
  execStream?: AgentRunOptions["execStream"];
  onUpdate?: (session: RelaySession) => void;
}

export function isReviewAssignment(mode: AgentTaskMode): boolean {
  return mode === "review";
}

export function assignmentSucceeded(_step: WorkflowStep, state: AgentState): boolean {
  return state.last_exit_code === 0;
}

export function assignmentFailureOutcome(step: WorkflowStep, state: AgentState): string {
  if (state.last_exit_code !== 0) {
    return `${step.agent} ${step.mode} failed with exit code ${state.last_exit_code}.`;
  }
  return `${step.agent} ${step.mode} failed.`;
}

export class SessionController implements AgentEventSink {
  private activeSessionId = "";
  private readonly pendingOutputWrites = new Set<Promise<void>>();

  constructor(
    public readonly store: SessionStore,
    private readonly options: SessionControllerOptions = {},
  ) {}

  async createSession(taskGoal: string, participants: string[] = ["human"]): Promise<RelaySession> {
    const session = await this.store.createSession({
      workspacePath: this.options.workspacePath ?? GUEST_WORKSPACE,
      daemonNodeId: this.options.daemonNodeId,
      ownerEmployeeId: this.options.ownerEmployeeId,
      teamId: this.options.teamId,
      taskGoal,
      participants,
      status: "running",
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

  async renameSession(sessionId: string, title: string): Promise<RelaySession> {
    const trimmed = title.trim();
    if (!trimmed) throw new Error("title is required.");
    if (trimmed.length > 200) throw new Error("title must be 200 characters or fewer.");

    const current = await this.store.getSession(sessionId);
    if (current.title === trimmed) return current;
    return this.append(sessionId, relayEvent("session.renamed", sessionId, { title: trimmed }));
  }

  async recordDecision(sessionId: string, kind: HumanDecisionKind, note?: string, targetAgent?: AgentName): Promise<RelaySession> {
    if (kind === "cancel") {
      return this.cancelSession(sessionId, note);
    }
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
    if (kind === "mark_done") {
      return this.completeSession(sessionId, note || "Marked done from Relay API.");
    }
    if (kind === "rerun") {
      return this.append(sessionId, relayEvent("session.status", sessionId, {
        status: "running",
        phase: targetAgent ? `rerun:${targetAgent}` : "rerun",
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

  async handoffSession(sessionId: string, targetAgent: AgentName, assignments: WorkflowStep[] = [{ agent: targetAgent, mode: "action" }], note?: string): Promise<RelaySession> {
    await this.validateAssignment(sessionId);
    const targetAgentId = assignments[0]?.agentId;
    const decision = {
      id: newRelayId("dec"),
      kind: "handoff" as const,
      createdAt: new Date().toISOString(),
      note,
      targetAgent,
      ...(targetAgentId ? { targetAgentId } : {}),
      ...(this.options.ownerEmployeeId ? { actorEmployeeId: this.options.ownerEmployeeId } : {}),
    };
    await this.append(sessionId, relayEvent("human.decision", sessionId, { decision }));
    await this.assignSession(sessionId, assignments);
    return this.append(sessionId, relayEvent("session.status", sessionId, {
      status: "running",
      phase: `handoff:${targetAgent}`,
    }));
  }

  async assignSession(sessionId: string, assignments: WorkflowStep[]): Promise<RelaySession> {
    await this.validateAssignment(sessionId);
    const body = JSON.stringify({ assignments }, null, 2);
    await this.createArtifact(sessionId, {
      kind: "plan",
      title: "Assignment plan",
      body,
      extension: "json",
    });
    return this.append(sessionId, relayEvent("session.status", sessionId, {
      status: "running",
      phase: "assigned",
    }));
  }

  private async validateAssignment(sessionId: string): Promise<void> {
    const session = await this.store.getSession(sessionId);
    if (session.archived) throw new Error(`Session ${sessionId} is archived.`);
    if (session.agentRuns.some((run) => run.status === "running")) {
      throw new Error(`Session ${sessionId} already has a run in flight.`);
    }
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
    if (this.store.createArtifact) {
      const { artifact } = await this.store.createArtifact(sessionId, input);
      return artifact;
    }
    const artifact = await this.store.writeArtifact(sessionId, input);
    await this.append(sessionId, relayEvent("artifact.created", sessionId, { artifact }));
    return artifact;
  }

  async recordAgentStarted(sessionId: string, step: { runId: string; agent: AgentName; role?: AgentRole; mode: AgentTaskMode }): Promise<RelaySession> {
    this.activeSessionId = sessionId;
    await this.linkTaskSession(sessionId);
    const session = await this.append(sessionId, relayEvent("agent.started", sessionId, {
      runId: step.runId,
      agent: step.agent,
      ...(step.role ? { role: step.role } : {}),
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
      mode: AgentTaskMode;
      status: "completed" | "failed" | "cancelled";
      exitCode: number;
      agentLog: string;
      tokenUsage?: AgentState["token_usage"];
    },
  ): Promise<AgentState> {
    this.activeSessionId = sessionId;
    const statePatch: Partial<AgentState> = {
      agent_logs: [input.agentLog],
      last_exit_code: input.exitCode,
    };
    await this.waitForPendingOutputWrites();
    await this.append(sessionId, relayEvent("agent.completed", sessionId, {
      runId: input.runId,
      agent: input.agent,
      status: input.status,
      exitCode: input.exitCode,
      agentLog: input.agentLog,
      tokenUsage: input.tokenUsage,
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
    const runState = await this.stateForRun(sessionId, state, step.agent, step.agentId);
    const runId = newRelayId("run");
    await this.append(sessionId, relayEvent("agent.started", sessionId, {
      runId,
      agent: step.agent,
      ...(step.role ? { role: step.role } : {}),
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
      patch = await runAgentNode(step.agent, step.mode, runState, runOptions);
    } catch (error) {
      const status = runOptions.signal?.aborted ? "cancelled" : "failed";
      await this.waitForPendingOutputWrites();
      await this.append(sessionId, relayEvent("agent.completed", sessionId, {
        runId,
        agent: step.agent,
        status,
        exitCode: status === "cancelled" ? 130 : 1,
        agentLog: error instanceof Error ? error.message : String(error),
        tokenUsage: undefined,
      }));
      const message = error instanceof Error ? error.message : String(error);
      await this.updateTaskStatus("blocked", message, {
        agent: step.agent,
        sessionId,
      });
      throw error;
    }

    const next = mergeAgentState(runState, patch);
    const status = runOptions.signal?.aborted ? "cancelled" : next.last_exit_code === 0 ? "completed" : "failed";
    await this.waitForPendingOutputWrites();
    await this.append(sessionId, relayEvent("agent.completed", sessionId, {
      runId,
      agent: step.agent,
      status,
      exitCode: next.last_exit_code,
      agentLog: next.agent_logs.slice(-1)[0] ?? "",
      tokenUsage: next.token_usage,
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
        state = await this.runStep(sessionId, state, { agent: "claude", mode: "action" }, options);
        next = routeClaudeHandoff(state, options.sink);
      } else if (next === "pi_implement") {
        state = await this.runStep(sessionId, state, { agent: "pi", mode: "action" }, options);
        next = routePiHandoff(state, options.sink);
      }
    }
    const outcome = state.last_exit_code === 0 ? "Default workflow completed." : "Default workflow halted.";
    if (state.last_exit_code === 0) await this.completeSession(sessionId, outcome);
    else {
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

  private async stateForRun(
    sessionId: string,
    state: AgentState,
    agent: AgentName,
    agentId?: string,
  ): Promise<AgentState> {
    const next: AgentState = { ...state };
    delete next.prior_agent_bridge;
    delete next.prior_conversation;
    delete next.prior_handoff_note;

    const session = await this.store.getSession(sessionId);
    const bridge = await computePriorAgentBridge(session, this.store);
    if (bridge) next.prior_agent_bridge = bridge;
    const conversation = await computeConversationHistory(session, this.store);
    if (conversation) next.prior_conversation = conversation;
    const handoffNote = computePriorHandoffNote(session, agent, agentId);
    if (handoffNote) next.prior_handoff_note = handoffNote;
    return next;
  }
}

function abortReason(signal: AbortSignal): string | undefined {
  return typeof signal.reason === "string" && signal.reason ? signal.reason : undefined;
}

type TurnMarker = [timestamp: string, eventIndex: number];
const HISTORY_HEADER = "[Conversation so far]";
const HISTORY_ELISION = "[Earlier conversation omitted]";
const DEFAULT_MAX_HISTORY_BLOCKS = 24;
const DEFAULT_MAX_HISTORY_CHARS = 16000;
const OUTPUT_TAIL_LINES = 20;
const OUTPUT_TAIL_CHARS = 1200;

function latestUserTurnMarker(session: RelaySession): TurnMarker | undefined {
  const markers: TurnMarker[] = [[session.createdAt, -1]];
  session.events.forEach((event, index) => {
    if (event.type === "session.created") markers.push([event.timestamp, index]);
    if (event.type === "user.message") markers.push([event.timestamp, index]);
  });
  return markers.sort(compareMarkers).at(-1);
}

function compareMarkers(a: TurnMarker, b: TurnMarker): number {
  const timestamp = a[0].localeCompare(b[0]);
  return timestamp !== 0 ? timestamp : a[1] - b[1];
}

function markerAfter(a: TurnMarker, b: TurnMarker): boolean {
  return compareMarkers(a, b) > 0;
}

function markerBefore(a: TurnMarker, b: TurnMarker): boolean {
  return compareMarkers(a, b) < 0;
}

function runTimestamp(run: RelaySession["agentRuns"][number]): string {
  return run.completedAt ?? run.startedAt ?? "";
}

function runMarker(session: RelaySession, run: RelaySession["agentRuns"][number]): TurnMarker {
  const timestamp = runTimestamp(run);
  const index = session.events.findIndex((event) => event.type === "agent.completed" && event.runId === run.id);
  return [timestamp, index];
}

function bridgeArtifactForRun(session: RelaySession, run: RelaySession["agentRuns"][number]): RelayArtifact | undefined {
  const artifacts = new Map(session.artifacts.map((artifact) => [artifact.id, artifact]));
  for (let i = run.artifactIds.length - 1; i >= 0; i--) {
    const artifact = artifacts.get(run.artifactIds[i]);
    if (artifact && (artifact.kind === "command_log" || artifact.kind === "review" || artifact.kind === "agent_output")) {
      return artifact;
    }
  }
  return undefined;
}

async function runAssistantText(session: RelaySession, run: RelaySession["agentRuns"][number], store: SessionStore): Promise<string | undefined> {
  const log = await runLogForRun(session, run, store);
  return runContinuityText(run, log);
}

async function runLogForRun(session: RelaySession, run: RelaySession["agentRuns"][number], store: SessionStore): Promise<string | undefined> {
  if (run.agentLog !== undefined) return run.agentLog;
  const completed = [...session.events]
    .reverse()
    .find((event) => event.type === "agent.completed" && event.runId === run.id);
  if (completed?.type === "agent.completed" && completed.agentLog !== undefined) {
    return completed.agentLog;
  }
  const artifact = bridgeArtifactForRun(session, run);
  if (!artifact) return undefined;
  try {
    return await store.readArtifact(session.id, artifact.id);
  } catch {
    return undefined;
  }
}

function includeRunInContinuity(run: RelaySession["agentRuns"][number]): boolean {
  return run.status === "completed" || run.status === "failed" || run.status === "cancelled";
}

function runContinuitySuffix(run: RelaySession["agentRuns"][number]): string {
  if (run.status === "completed") return "";
  if (run.status === "failed") {
    return run.exitCode === undefined ? " - failed" : ` - failed, exit ${run.exitCode}`;
  }
  if (run.status === "cancelled") return " - cancelled";
  return ` - ${run.status}`;
}

function outputTail(transcript: string | undefined): string | undefined {
  if (!transcript?.trim()) return undefined;
  const lines = transcript
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith("○ ") && !line.startsWith("⏺ "));
  if (lines.length === 0) return undefined;
  const tail = lines.slice(-OUTPUT_TAIL_LINES).join("\n").trim();
  if (tail.length <= OUTPUT_TAIL_CHARS) return tail;
  return tail.slice(-OUTPUT_TAIL_CHARS).trimStart();
}

function runContinuityText(run: RelaySession["agentRuns"][number], transcript: string | undefined): string | undefined {
  const assistantText = transcript ? extractLastAssistantText(transcript) ?? undefined : undefined;
  if (assistantText || run.status === "completed") return assistantText;
  return outputTail(transcript);
}

async function computePriorAgentBridge(session: RelaySession, store: SessionStore): Promise<string | undefined> {
  const runs = session.agentRuns ?? [];
  const latestUser = latestUserTurnMarker(session);
  const priorRuns = runs
    .filter((run) => includeRunInContinuity(run) && (!latestUser || markerAfter(runMarker(session, run), latestUser)));
  if (priorRuns.length === 0) return undefined;

  const blocks: string[] = [];
  for (const run of priorRuns) {
    blocks.push(`[Previous from @${run.agent}${runContinuitySuffix(run)}]\n${(await runAssistantText(session, run, store)) ?? "<no output>"}`);
  }
  return blocks.join("\n\n");
}

async function computeConversationHistory(session: RelaySession, store: SessionStore): Promise<string | undefined> {
  const latestUser = latestUserTurnMarker(session);
  const items: Array<{ marker: TurnMarker; block: string }> = [];

  const createdIndex = session.events.findIndex((event) => event.type === "session.created");
  const createdMarker: TurnMarker = [session.createdAt, createdIndex];
  if (!latestUser || markerBefore(createdMarker, latestUser)) {
    items.push({ marker: createdMarker, block: `[User]\n${session.taskGoal}` });
  }
  for (let i = 0; i < session.events.length; i++) {
    const event = session.events[i];
    if (event.type === "user.message" && (!latestUser || markerBefore([event.timestamp, i], latestUser))) {
      items.push({ marker: [event.timestamp, i], block: `[User]\n${event.text}` });
    }
  }
  for (const run of session.agentRuns) {
    if (!includeRunInContinuity(run)) continue;
    const marker = runMarker(session, run);
    if (latestUser && !markerBefore(marker, latestUser)) continue;
    items.push({
      marker,
      block: `[Assistant @${run.agent}${runContinuitySuffix(run)}]\n${(await runAssistantText(session, run, store)) ?? "<no output>"}`,
    });
  }

  items.sort((a, b) => compareMarkers(a.marker, b.marker));
  if (items.length === 0) return undefined;
  return `${HISTORY_HEADER}\n\n${capHistoryBlocks(items.map((item) => item.block)).join("\n\n")}`;
}

function historyLength(blocks: string[]): number {
  return blocks.join("\n\n").length;
}

function truncateTail(block: string, budget: number): string {
  if (budget <= HISTORY_ELISION.length) return HISTORY_ELISION;
  if (block.length <= budget) return block;
  const marker = "[Earlier content omitted]\n";
  return marker + block.slice(-(budget - marker.length)).trimStart();
}

function capHistoryBlocks(
  blocks: string[],
  maxBlocks = DEFAULT_MAX_HISTORY_BLOCKS,
  maxChars = DEFAULT_MAX_HISTORY_CHARS,
): string[] {
  const contentBudget = maxChars - HISTORY_HEADER.length - 2;
  if (blocks.length === 0) return [];
  if (maxBlocks <= 0 || contentBudget <= 0) return [HISTORY_ELISION];

  const keptReversed: string[] = [];
  let omitted = false;
  let currentLength = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const separatorLength = keptReversed.length > 0 ? 2 : 0;
    const nextLength = currentLength + separatorLength + blocks[i].length;
    if (keptReversed.length >= maxBlocks || (keptReversed.length > 0 && nextLength > contentBudget)) {
      omitted = true;
      break;
    }
    if (keptReversed.length === 0 && nextLength > contentBudget) {
      keptReversed.push(truncateTail(blocks[i], contentBudget));
      omitted = true;
      break;
    }
    keptReversed.push(blocks[i]);
    currentLength = nextLength;
  }

  const kept = keptReversed.reverse();
  if (!omitted) return kept;

  kept.unshift(HISTORY_ELISION);
  while (kept.length > 1 && historyLength(kept) > contentBudget) {
    if (kept.length === 2) {
      const available = contentBudget - HISTORY_ELISION.length - 2;
      kept[1] = truncateTail(kept[1], Math.max(0, available));
      break;
    }
    kept.splice(1, 1);
  }
  return kept;
}

function computePriorHandoffNote(
  session: RelaySession,
  agent?: AgentName,
  agentId?: string,
): string | undefined {
  const latestUser = latestUserTurnMarker(session);
  let latest: { marker: TurnMarker; decision: RelaySession["decisions"][number] } | undefined;
  session.events.forEach((event, index) => {
    if (event.type !== "human.decision") return;
    const marker: TurnMarker = [event.timestamp, index];
    if (latestUser && !markerAfter(marker, latestUser)) return;
    if (!latest || markerAfter(marker, latest.marker)) {
      latest = { marker, decision: event.decision };
    }
  });
  if (!latest || latest.decision.kind !== "handoff") return undefined;
  if (latest.decision.targetAgentId && latest.decision.targetAgentId !== agentId) return undefined;
  if (agent && latest.decision.targetAgent && latest.decision.targetAgent !== agent) return undefined;
  const note = latest.decision.note?.trim();
  return note ? `[Handoff note]\n${note}` : undefined;
}
