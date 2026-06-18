import {
  buildClaudeImplementCommand,
  buildClaudeReviewCommand,
  buildCodexImplementCommand,
  buildCodexReviewCommand,
  buildKimiImplementCommand,
  buildKimiReviewCommand,
  buildPiImplementCommand,
  buildPiPreflightCommand,
  buildPiReviewCommand,
} from "./commands.js";
import { ansi } from "./format.js";
import { runAsAgent } from "./guest.js";
import {
  ClaudeStreamRenderer,
  CodexStreamRenderer,
  PiStreamRenderer,
  PlainTextStreamRenderer,
} from "./renderers.js";
import type { AgentName, AgentState, AgentTaskMode } from "./state.js";

/** Minimal contract every stream renderer satisfies: feed a chunk, get display text. */
export interface StreamRenderer {
  feed(chunk: string): string;
}

/** The session-level role an agent fills when implementing (review mode always maps to "reviewer"). */
export type AgentImplementRole = "implementer" | "tester" | "planner" | "fixer";

export interface AgentDefinition {
  name: AgentName;
  /** Human-facing name used in readiness output and avatars. */
  displayName: string;
  /** Single-character avatar initial for the web UI. */
  initial: string;
  /** Consecutive-failure budget before the workflow halts retries for this agent. */
  maxFailures: number;
  /** Mode chosen when a caller addresses the agent without specifying one. */
  defaultMode: AgentTaskMode;
  /** Role recorded for an implement-mode assignment. */
  implementRole: AgentImplementRole;
  buildImplementCommand(state: AgentState): string;
  buildReviewCommand(state: AgentState): string;
  createRenderer(mode: AgentTaskMode): StreamRenderer;
  /** Label shown for the implement-mode artifact/log header. */
  implementLabel: string;
  /** Label shown for the review-mode artifact/log header. */
  reviewLabel: string;
  /** Whether the daemon must provision guest auth files before this agent can run. */
  needsGuestAuth: boolean;
  preflight: { label: string; command(): string };
}

export const AGENT_REGISTRY: Record<AgentName, AgentDefinition> = {
  claude: {
    name: "claude",
    displayName: "Claude Code",
    initial: "C",
    maxFailures: 3,
    defaultMode: "implement",
    implementRole: "implementer",
    buildImplementCommand: buildClaudeImplementCommand,
    buildReviewCommand: buildClaudeReviewCommand,
    createRenderer: () => new ClaudeStreamRenderer(),
    implementLabel: "Claude Code",
    reviewLabel: "Claude Code Review",
    needsGuestAuth: false,
    preflight: { label: "Claude Code", command: () => runAsAgent("claude --version", "claude") },
  },
  pi: {
    name: "pi",
    displayName: "Pi",
    initial: "π",
    maxFailures: 2,
    defaultMode: "implement",
    implementRole: "tester",
    buildImplementCommand: buildPiImplementCommand,
    buildReviewCommand: buildPiReviewCommand,
    createRenderer: () => new PiStreamRenderer(),
    implementLabel: "Pi",
    reviewLabel: "Pi Review",
    needsGuestAuth: true,
    preflight: { label: "Pi coding agent", command: buildPiPreflightCommand },
  },
  codex: {
    name: "codex",
    displayName: "Codex",
    initial: "X",
    maxFailures: 2,
    defaultMode: "implement",
    implementRole: "implementer",
    buildImplementCommand: buildCodexImplementCommand,
    buildReviewCommand: buildCodexReviewCommand,
    createRenderer: () => new CodexStreamRenderer(),
    implementLabel: "Codex Implement",
    reviewLabel: "Codex Review",
    needsGuestAuth: true,
    preflight: { label: "Codex auth", command: () => runAsAgent("codex login status", "codex") },
  },
  kimi: {
    name: "kimi",
    displayName: "Kimi",
    initial: "K",
    maxFailures: 2,
    defaultMode: "implement",
    implementRole: "implementer",
    buildImplementCommand: buildKimiImplementCommand,
    buildReviewCommand: buildKimiReviewCommand,
    createRenderer: () => new PlainTextStreamRenderer("Kimi", ansi.magenta),
    implementLabel: "Kimi",
    reviewLabel: "Kimi Review",
    needsGuestAuth: true,
    preflight: { label: "Kimi", command: () => runAsAgent("kimi --version && kimi doctor", "kimi") },
  },
};

export const AGENT_NAMES = Object.keys(AGENT_REGISTRY) as AgentName[];

export function isAgentName(value: unknown): value is AgentName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(AGENT_REGISTRY, value);
}

export function getAgent(name: AgentName): AgentDefinition {
  return AGENT_REGISTRY[name];
}

/** Comma-separated agent list for user-facing prompts, e.g. "claude, pi, codex, kimi". */
export function agentNameList(): string {
  return AGENT_NAMES.join(", ");
}
