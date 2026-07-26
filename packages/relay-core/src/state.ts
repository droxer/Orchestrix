import type { AgentOutputSink } from "./format.js";
import type { TokenUsage } from "./token-usage.js";
import type { CodexCollaborationEvent } from "./codex-collaboration.js";

export type AgentName = "claude" | "pi" | "codex" | "kimi";
// "action" runs the agent with write access (UI label: "Action"); "ask" is a
// read-only Q&A pass enforced via each CLI's read-only flag; "review" is the
// default-workflow Codex review pass and is not user-selectable in the composer.
export type AgentTaskMode = "action" | "review" | "ask";
export type { AgentOutputSink };

export const AGENT_USER = "agent";
export const GUEST_WORKSPACE = "/workspace";

export interface AgentState {
  task_goal: string;
  agent_logs: string[];
  last_exit_code: number;
  /** Per-agent consecutive failure counts; absent entries mean zero. */
  agent_failures: Partial<Record<AgentName, number>>;
  token_usage?: TokenUsage;
  /** Bridge text from intervening other-agent runs on the shared session, if any. */
  prior_agent_bridge?: string;
  /** Rendered transcript of earlier conversation turns on this session, if any. */
  prior_conversation?: string;
  /** Latest handoff note for the current turn, if any. */
  prior_handoff_note?: string;
  /** Display name of the selected logical agent identity. */
  agent_display_name?: string;
  /** Durable personality profile for the selected logical agent identity. */
  agent_instructions?: string;
  /**
   * Personal home subdir (slash-separated, under the shared node workspace)
   * for this run's logical agent, e.g. "agents/agent-<b64>". Runs execute at
   * the shared workspace root; this names the agent's private area.
   */
  agent_home_subdir?: string;
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
  agentCollaboration?(runId: string, agent: AgentName, event: CodexCollaborationEvent): void | Promise<void>;
}

export interface SessionStepRunner {
  store: {
    appendEvent(sessionId: string, event: unknown): unknown | Promise<unknown>;
  };
  createSession(taskGoal: string): Promise<{ id: string }>;
  runStep(
    sessionId: string,
    state: AgentState,
    step: { agent: AgentName; mode: AgentTaskMode; role?: string },
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
