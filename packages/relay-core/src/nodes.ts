import { getAgent } from "./agents.js";
import { classifyCodexReview, extractCodexFeedback } from "./codex-review.js";
import { StderrLineRenderer } from "./renderers.js";
import {
  agentWorkspacePath,
} from "./guest.js";
import {
  withFailure,
  type AgentName,
  type AgentRunOptions,
  type AgentState,
  type CodexTaskMode,
} from "./state.js";

/**
 * Run one agent assignment. Command construction, rendering, failure accounting,
 * and review-verdict parsing are all driven by the agent registry, so adding an
 * agent never requires a new node function — only a registry entry.
 */
export async function runAgentNode(
  agent: AgentName,
  mode: CodexTaskMode,
  state: AgentState,
  options: AgentRunOptions = {},
): Promise<Partial<AgentState>> {
  const def = getAgent(agent);
  const execute = requiredExecStream(options);
  const renderer = def.createRenderer(mode);
  const stderrRenderer = new StderrLineRenderer();
  const runId = options.runId;
  const reviewMode = mode === "review" && def.capabilities.review;
  const command = reviewMode && def.buildReviewCommand
    ? def.buildReviewCommand(state)
    : def.buildImplementCommand(state);
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

  if (reviewMode) {
    const feedback = extractCodexFeedback(result.stdout);
    const verdict = classifyCodexReview(result.exit_code, feedback);
    return {
      agent_logs: [agentResultLog(def.reviewLabel ?? `${def.displayName} Review`, result, 4000)],
      last_exit_code: result.exit_code,
      agent_failures: withFailure(state, agent, verdict === "failed"),
      codex_verdict: verdict,
      codex_feedback: feedback,
    };
  }

  return {
    agent_logs: [agentResultLog(def.implementLabel, result)],
    last_exit_code: result.exit_code,
    agent_failures: withFailure(state, agent, result.exit_code !== 0),
  };
}

// Backwards-compatible thin wrappers around the registry-driven node.
export function claudeImplementNode(state: AgentState, options: AgentRunOptions = {}): Promise<Partial<AgentState>> {
  return runAgentNode("claude", "implement", state, options);
}

export function piImplementNode(state: AgentState, options: AgentRunOptions = {}): Promise<Partial<AgentState>> {
  return runAgentNode("pi", "implement", state, options);
}

export function codexImplementNode(state: AgentState, options: AgentRunOptions = {}): Promise<Partial<AgentState>> {
  return runAgentNode("codex", "implement", state, options);
}

export function codexReviewNode(state: AgentState, options: AgentRunOptions = {}): Promise<Partial<AgentState>> {
  return runAgentNode("codex", "review", state, options);
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
