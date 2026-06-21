import { getAgent } from "./agents.js";
import { classifyReview, extractReviewFeedback } from "./review.js";
import { StderrLineRenderer } from "./renderers.js";
import {
  agentWorkspacePath,
} from "./guest.js";
import {
  withFailure,
  type AgentName,
  type AgentRunOptions,
  type AgentState,
  type AgentTaskMode,
} from "./state.js";
import { extractTokenUsageFromJsonl } from "./token-usage.js";

/**
 * Run one agent assignment. Command construction, rendering, failure accounting,
 * and review-verdict parsing are all driven by the agent registry, so adding an
 * agent never requires a new node function — only a registry entry.
 */
export async function runAgentNode(
  agent: AgentName,
  mode: AgentTaskMode,
  state: AgentState,
  options: AgentRunOptions = {},
): Promise<Partial<AgentState>> {
  const def = getAgent(agent);
  const execute = requiredExecStream(options);
  const renderer = def.createRenderer(mode);
  const stderrRenderer = new StderrLineRenderer();
  const runId = options.runId;
  const reviewMode = mode === "review";
  const command = reviewMode ? def.buildReviewCommand(state) : def.buildActionCommand(state);
  const result = await execute("bash", ["-c", command], {
    cwd: agentWorkspacePath(),
    stdoutRenderer: (chunk) => {
      if (runId) options.eventSink?.agentOutput(runId, agent, "stdout", chunk);
      return renderer.feed(chunk);
    },
    stderrRenderer: (chunk) => {
      if (runId) options.eventSink?.agentOutput(runId, agent, "stderr", chunk);
      return stderrRenderer.feed(chunk);
    },
    sink: options.sink,
    signal: options.signal,
  });
  const tokenUsage = extractTokenUsageFromJsonl(result.stdout, agent);

  if (reviewMode) {
    const feedback = extractReviewFeedback(result.stdout);
    const verdict = classifyReview(result.exit_code, feedback);
    return {
      agent_logs: [agentResultLog(def.reviewLabel, result, 4000)],
      last_exit_code: result.exit_code,
      agent_failures: withFailure(state, agent, verdict === "failed"),
      review_verdict: verdict,
      review_feedback: feedback,
      token_usage: tokenUsage,
    };
  }

  return {
    agent_logs: [agentResultLog(def.actionLabel, result)],
    last_exit_code: result.exit_code,
    agent_failures: withFailure(state, agent, result.exit_code !== 0),
    token_usage: tokenUsage,
  };
}

// Thin wrappers around the registry-driven node.
export function claudeActionNode(state: AgentState, options: AgentRunOptions = {}): Promise<Partial<AgentState>> {
  return runAgentNode("claude", "action", state, options);
}

export function piActionNode(state: AgentState, options: AgentRunOptions = {}): Promise<Partial<AgentState>> {
  return runAgentNode("pi", "action", state, options);
}

export function codexActionNode(state: AgentState, options: AgentRunOptions = {}): Promise<Partial<AgentState>> {
  return runAgentNode("codex", "action", state, options);
}

function requiredExecStream(options: AgentRunOptions) {
  if (!options.execStream) {
    throw new Error("Agent node execution requires an execStream implementation.");
  }
  return options.execStream;
}

function agentResultLog(label: string, result: { exit_code: number; stdout: string; stderr: string; error_message?: string }, limit = 500): string {
  const parts = [`[${label} Exit ${result.exit_code}]`];
  if (result.error_message) parts.push(`Error: ${result.error_message}`);
  if (result.stderr.trim()) parts.push(`stderr:\n${result.stderr.slice(-limit)}`);
  if (result.stdout.trim()) parts.push(`stdout:\n${result.stdout.slice(-limit)}`);
  return parts.join("\n");
}
