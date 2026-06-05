import type { AgentOutputSink } from "./format.js";
import type { SessionController } from "./controller.js";
import type { AgentEventSink } from "./session.js";

export type AgentName = "claude" | "pi" | "codex";
export type CodexTaskMode = "implement" | "review";
export type CodexReviewVerdict = "approved" | "rejected" | "failed";
export type { AgentOutputSink };

export const AGENT_USER = "agent";
export const GUEST_WORKSPACE = "/workspace";
export const MAX_CLAUDE_FAILURES = 3;
export const MAX_PI_FAILURES = 2;
export const MAX_CODEX_FAILURES = 2;

export interface AgentState {
  task_goal: string;
  agent_logs: string[];
  last_exit_code: number;
  claude_failures: number;
  pi_failures: number;
  codex_failures: number;
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
  sessionController?: SessionController;
  sessionId?: string;
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
    claude_failures: 0,
    pi_failures: 0,
    codex_failures: 0,
    codex_verdict: "",
    codex_feedback: "",
  };
}

export function mergeAgentState(state: AgentState, patch: Partial<AgentState>): AgentState {
  return {
    ...state,
    ...patch,
    agent_logs: [...state.agent_logs, ...(patch.agent_logs ?? [])],
  };
}

export function nextFailureCount(failed: boolean, currentCount: number): number {
  return failed ? currentCount + 1 : 0;
}
