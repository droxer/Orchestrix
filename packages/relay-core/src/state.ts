import type { AgentOutputSink } from "./format.js";

export type AgentName = "claude" | "pi" | "codex" | "kimi";
export type CodexTaskMode = "implement" | "review";
export type CodexReviewVerdict = "approved" | "rejected" | "failed";
export type { AgentOutputSink };

export const AGENT_USER = "agent";
export const GUEST_WORKSPACE = "/workspace";

export interface AgentState {
  task_goal: string;
  agent_logs: string[];
  last_exit_code: number;
  /** Per-agent consecutive failure counts; absent entries mean zero. */
  agent_failures: Partial<Record<AgentName, number>>;
  codex_verdict: CodexReviewVerdict | "";
  codex_feedback: string;
}

export interface AgentRunOptions {
  sink?: AgentOutputSink;
  signal?: AbortSignal;
  execStream?: AgentExecutor;
  eventSink?: AgentEventSink;
  runId?: string;
  agent?: AgentName;
  sessionController?: SessionStepRunner;
  sessionId?: string;
}

export interface AgentEventSink {
  agentOutput(runId: string, agent: AgentName, stream: "stdout" | "stderr", text: string): void | Promise<void>;
}

export interface SessionStepRunner {
  store: {
    appendEvent(sessionId: string, event: unknown): unknown | Promise<unknown>;
  };
  createSession(taskGoal: string): Promise<{ id: string }>;
  runStep(
    sessionId: string,
    state: AgentState,
    step: { agent: AgentName; mode: CodexTaskMode; role?: string },
    options?: Pick<AgentRunOptions, "signal" | "sink" | "execStream">,
  ): Promise<AgentState>;
}

export interface StreamExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  error_message?: string;
}

export type AgentExecutor = (
  cmd: string,
  args?: string[],
  options?: {
    cwd?: string;
    stdoutRenderer?: (chunk: string) => string;
    stderrRenderer?: (chunk: string) => string;
    sink?: AgentOutputSink;
    signal?: AbortSignal;
  },
) => Promise<StreamExecResult>;

export function initialAgentState(taskGoal: string): AgentState {
  return {
    task_goal: taskGoal,
    agent_logs: [],
    last_exit_code: 0,
    agent_failures: {},
    codex_verdict: "",
    codex_feedback: "",
  };
}

export function mergeAgentState(state: AgentState, patch: Partial<AgentState>): AgentState {
  return {
    ...state,
    ...patch,
    agent_logs: [...state.agent_logs, ...(patch.agent_logs ?? [])],
    agent_failures: { ...state.agent_failures, ...(patch.agent_failures ?? {}) },
  };
}

export function nextFailureCount(failed: boolean, currentCount: number): number {
  return failed ? currentCount + 1 : 0;
}

export function failureCount(state: AgentState, agent: AgentName): number {
  return state.agent_failures[agent] ?? 0;
}

/** Returns the next per-agent failure map after a run: incremented on failure, reset to 0 on success. */
export function withFailure(state: AgentState, agent: AgentName, failed: boolean): Partial<Record<AgentName, number>> {
  return { ...state.agent_failures, [agent]: nextFailureCount(failed, failureCount(state, agent)) };
}
