import { getAgent } from "./agents.js";
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
import { CodexCollaborationStream } from "./codex-collaboration.js";

// The completed-run agent log is the fallback transcript for runs whose live
// output events are incomplete. A small tail cap drops the head of the stream,
// which renders as the reply's first characters going missing, so keep the
// budget generous; override with RELAY_AGENT_RESULT_LOG_LIMIT when needed.
const AGENT_RESULT_LOG_LIMIT = Number(process.env.RELAY_AGENT_RESULT_LOG_LIMIT) || 262_144;

/**
 * Run one agent assignment. Command construction, rendering, and failure
 * accounting are all driven by the agent registry, so adding an agent never
 * requires a new node function — only a registry entry. A review pass is just
 * an agent run with the review prompt; its output is captured in the agent log
 * like any other run.
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
  const collaborationStream = agent === "codex" ? new CodexCollaborationStream() : undefined;
  const runId = options.runId;
  const reviewMode = mode === "review";
  const command =
    mode === "review"
      ? def.buildReviewCommand(state)
      : mode === "ask"
        ? def.buildAskCommand(state)
        : def.buildActionCommand(state);
  const actionLabel = mode === "ask" ? def.askLabel : def.actionLabel;
  // Runs execute at the shared workspace root so agents on the same computer
  // collaborate through it; state.agent_home_subdir names the private area.
  const cwd = agentWorkspacePath();
  const result = await execute("bash", ["-c", command], {
    cwd,
    stdoutRenderer: (chunk) => {
      if (runId) options.eventSink?.agentOutput(runId, agent, "stdout", chunk);
      if (runId && collaborationStream && options.eventSink?.agentCollaboration) {
        for (const event of collaborationStream.feed(chunk)) {
          options.eventSink.agentCollaboration(runId, agent, event);
        }
      }
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
    return {
      agent_logs: [agentResultLog(def.reviewLabel, result)],
      last_exit_code: result.exit_code,
      agent_failures: withFailure(state, agent, result.exit_code !== 0),
      token_usage: tokenUsage,
    };
  }

  return {
    agent_logs: [agentResultLog(actionLabel, result)],
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

function agentResultLog(label: string, result: { exit_code: number; stdout: string; stderr: string; error_message?: string }, limit = AGENT_RESULT_LOG_LIMIT): string {
  const parts = [`[${label} Exit ${result.exit_code}]`];
  if (result.error_message) parts.push(`Error: ${result.error_message}`);
  if (result.stderr.trim()) parts.push(`stderr:\n${result.stderr.slice(-limit)}`);
  if (result.stdout.trim()) parts.push(`stdout:\n${result.stdout.slice(-limit)}`);
  return parts.join("\n");
}
