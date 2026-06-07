import { classifyCodexReview, extractCodexFeedback } from "./codex-review.js";
import {
  buildClaudeImplementCommand,
  buildCodexImplementCommand,
  buildCodexReviewCommand,
  buildPiImplementCommand,
} from "./commands.js";
import { ansi } from "./format.js";
import {
  ClaudeStreamRenderer,
  CodexStreamRenderer,
  PlainTextStreamRenderer,
  StderrLineRenderer,
} from "./renderers.js";
import {
  agentWorkspacePath,
} from "./guest.js";
import {
  nextFailureCount,
  type AgentRunOptions,
  type AgentState,
} from "./state.js";

export async function claudeImplementNode(state: AgentState, options: AgentRunOptions = {}): Promise<Partial<AgentState>> {
  const execute = requiredExecStream(options);
  const renderer = new ClaudeStreamRenderer();
  const stderrRenderer = new StderrLineRenderer();
  const runId = options.runId;
  const result = await execute("bash", ["-c", buildClaudeImplementCommand(state)], {
    cwd: agentWorkspacePath(),
    stdoutRenderer: (chunk) => {
      if (runId) options.eventSink?.agentOutput(runId, "claude", "stdout", chunk);
      return renderer.feed(chunk);
    },
    stderrRenderer: (chunk) => {
      if (runId) options.eventSink?.agentOutput(runId, "claude", "stderr", chunk);
      return stderrRenderer.feed(chunk);
    },
    sink: options.sink,
    signal: options.signal,
  });
  return {
    agent_logs: [agentResultLog("Claude Code", result)],
    last_exit_code: result.exit_code,
    claude_failures: nextFailureCount(result.exit_code !== 0, state.claude_failures),
  };
}

export async function piImplementNode(state: AgentState, options: AgentRunOptions = {}): Promise<Partial<AgentState>> {
  const execute = requiredExecStream(options);
  const renderer = new PlainTextStreamRenderer("Pi", ansi.yellow);
  const stderrRenderer = new StderrLineRenderer();
  const runId = options.runId;
  const result = await execute("bash", ["-c", buildPiImplementCommand(state)], {
    cwd: agentWorkspacePath(),
    stdoutRenderer: (chunk) => {
      if (runId) options.eventSink?.agentOutput(runId, "pi", "stdout", chunk);
      return renderer.feed(chunk);
    },
    stderrRenderer: (chunk) => {
      if (runId) options.eventSink?.agentOutput(runId, "pi", "stderr", chunk);
      return stderrRenderer.feed(chunk);
    },
    sink: options.sink,
    signal: options.signal,
  });
  return {
    agent_logs: [agentResultLog("Pi", result)],
    last_exit_code: result.exit_code,
    pi_failures: nextFailureCount(result.exit_code !== 0, state.pi_failures),
  };
}

export async function codexReviewNode(state: AgentState, options: AgentRunOptions = {}): Promise<Partial<AgentState>> {
  const execute = requiredExecStream(options);
  const renderer = new CodexStreamRenderer();
  const stderrRenderer = new StderrLineRenderer();
  const runId = options.runId;
  const result = await execute("bash", ["-c", buildCodexReviewCommand(state)], {
    cwd: agentWorkspacePath(),
    stdoutRenderer: (chunk) => {
      if (runId) options.eventSink?.agentOutput(runId, "codex", "stdout", chunk);
      return renderer.feed(chunk);
    },
    stderrRenderer: (chunk) => {
      if (runId) options.eventSink?.agentOutput(runId, "codex", "stderr", chunk);
      return stderrRenderer.feed(chunk);
    },
    sink: options.sink,
    signal: options.signal,
  });
  const feedback = extractCodexFeedback(result.stdout);
  const verdict = classifyCodexReview(result.exit_code, feedback);
  return {
    agent_logs: [agentResultLog("Codex Review", result, 4000)],
    last_exit_code: result.exit_code,
    codex_failures: nextFailureCount(verdict === "failed", state.codex_failures),
    codex_verdict: verdict,
    codex_feedback: feedback,
  };
}

export async function codexImplementNode(state: AgentState, options: AgentRunOptions = {}): Promise<Partial<AgentState>> {
  const execute = requiredExecStream(options);
  const renderer = new CodexStreamRenderer();
  const stderrRenderer = new StderrLineRenderer();
  const runId = options.runId;
  const result = await execute("bash", ["-c", buildCodexImplementCommand(state)], {
    cwd: agentWorkspacePath(),
    stdoutRenderer: (chunk) => {
      if (runId) options.eventSink?.agentOutput(runId, "codex", "stdout", chunk);
      return renderer.feed(chunk);
    },
    stderrRenderer: (chunk) => {
      if (runId) options.eventSink?.agentOutput(runId, "codex", "stderr", chunk);
      return stderrRenderer.feed(chunk);
    },
    sink: options.sink,
    signal: options.signal,
  });
  return {
    agent_logs: [agentResultLog("Codex Implement", result)],
    last_exit_code: result.exit_code,
    codex_failures: nextFailureCount(result.exit_code !== 0, state.codex_failures),
  };
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
