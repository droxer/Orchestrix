import { execStream } from "./box.js";
import { classifyCodexReview, extractCodexFeedback } from "./codex-review.js";
import {
  buildClaudeImplementCommand,
  buildCodexImplementCommand,
  buildCodexReviewCommand,
  buildPiImplementCommand,
} from "./commands.js";
import { ansi, emitOrPrint, promptBlock } from "./format.js";
import {
  ClaudeStreamRenderer,
  CodexStreamRenderer,
  PlainTextStreamRenderer,
  StderrLineRenderer,
} from "./renderers.js";
import {
  claudeTaskPrompt,
  codexImplementPrompt,
  codexReviewPrompt,
  piTaskPrompt,
} from "./prompts.js";
import {
  GUEST_WORKSPACE,
  nextFailureCount,
  type AgentRunOptions,
  type AgentState,
} from "./state.js";

export async function claudeImplementNode(state: AgentState, options: AgentRunOptions = {}): Promise<Partial<AgentState>> {
  emitOrPrint(options.sink, promptBlock("Claude Code - implementation", claudeTaskPrompt(state), ansi.magenta));
  const execute = options.execStream ?? execStream;
  const renderer = new ClaudeStreamRenderer();
  const stderrRenderer = new StderrLineRenderer();
  const runId = options.runId;
  const result = await execute("bash", ["-c", buildClaudeImplementCommand(state)], {
    cwd: GUEST_WORKSPACE,
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
    agent_logs: [`[Claude Code Exit ${result.exit_code}]:\n${result.stdout.slice(-500)}`],
    last_exit_code: result.exit_code,
    claude_failures: nextFailureCount(result.exit_code !== 0, state.claude_failures),
  };
}

export async function piImplementNode(state: AgentState, options: AgentRunOptions = {}): Promise<Partial<AgentState>> {
  emitOrPrint(options.sink, promptBlock("Pi - implementation review", piTaskPrompt(state), ansi.yellow));
  const execute = options.execStream ?? execStream;
  const renderer = new PlainTextStreamRenderer("Pi", ansi.yellow);
  const stderrRenderer = new StderrLineRenderer();
  const runId = options.runId;
  const result = await execute("bash", ["-c", buildPiImplementCommand(state)], {
    cwd: GUEST_WORKSPACE,
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
    agent_logs: [`[Pi Exit ${result.exit_code}]:\n${result.stdout.slice(-500)}`],
    last_exit_code: result.exit_code,
    pi_failures: nextFailureCount(result.exit_code !== 0, state.pi_failures),
  };
}

export async function codexReviewNode(state: AgentState, options: AgentRunOptions = {}): Promise<Partial<AgentState>> {
  emitOrPrint(options.sink, promptBlock("Codex - code review", codexReviewPrompt(state), ansi.blue));
  const execute = options.execStream ?? execStream;
  const renderer = new CodexStreamRenderer();
  const stderrRenderer = new StderrLineRenderer();
  const runId = options.runId;
  const result = await execute("bash", ["-c", buildCodexReviewCommand(state)], {
    cwd: GUEST_WORKSPACE,
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
    agent_logs: [`[Codex Review Exit ${result.exit_code}]:\n${result.stdout}`],
    last_exit_code: result.exit_code,
    codex_failures: nextFailureCount(verdict === "failed", state.codex_failures),
    codex_verdict: verdict,
    codex_feedback: feedback,
  };
}

export async function codexImplementNode(state: AgentState, options: AgentRunOptions = {}): Promise<Partial<AgentState>> {
  emitOrPrint(options.sink, promptBlock("Codex - implementation", codexImplementPrompt(state), ansi.blue));
  const execute = options.execStream ?? execStream;
  const renderer = new CodexStreamRenderer();
  const stderrRenderer = new StderrLineRenderer();
  const runId = options.runId;
  const result = await execute("bash", ["-c", buildCodexImplementCommand(state)], {
    cwd: GUEST_WORKSPACE,
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
    agent_logs: [`[Codex Implement Exit ${result.exit_code}]:\n${result.stdout.slice(-500)}`],
    last_exit_code: result.exit_code,
    codex_failures: nextFailureCount(result.exit_code !== 0, state.codex_failures),
  };
}
