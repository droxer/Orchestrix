import {
  buildClaudeActionCommand,
  buildClaudeAskCommand,
  buildClaudeReviewCommand,
  buildCodexActionCommand,
  buildCodexAskCommand,
  buildCodexReviewCommand,
  buildKimiActionCommand,
  buildKimiAskCommand,
  buildKimiReviewCommand,
  buildPiActionCommand,
  buildPiAskCommand,
  buildPiPreflightCommand,
  buildPiReviewCommand,
} from "./commands.js";
import { runAsAgent } from "./guest.js";
import {
  ClaudeStreamRenderer,
  CodexStreamRenderer,
  KimiStreamRenderer,
  PiStreamRenderer,
} from "./renderers.js";
import type { AgentName, AgentState, AgentTaskMode } from "./state.js";

/** Minimal contract every stream renderer satisfies: feed a chunk, get display text. */
export interface StreamRenderer {
  feed(chunk: string): string;
}

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
  buildActionCommand(state: AgentState): string;
  buildReviewCommand(state: AgentState): string;
  /** Read-only Q&A command (UI "Ask" mode). */
  buildAskCommand(state: AgentState): string;
  createRenderer(mode: AgentTaskMode): StreamRenderer;
  /** Label shown for the action-mode artifact/log header. */
  actionLabel: string;
  /** Label shown for the review-mode artifact/log header. */
  reviewLabel: string;
  /** Label shown for the ask-mode artifact/log header. */
  askLabel: string;
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
    defaultMode: "action",
    buildActionCommand: buildClaudeActionCommand,
    buildReviewCommand: buildClaudeReviewCommand,
    buildAskCommand: buildClaudeAskCommand,
    createRenderer: () => new ClaudeStreamRenderer(),
    actionLabel: "Claude Code",
    reviewLabel: "Claude Code Review",
    askLabel: "Claude Code Ask",
    needsGuestAuth: false,
    preflight: { label: "Claude Code", command: () => runAsAgent("claude --version", "claude") },
  },
  pi: {
    name: "pi",
    displayName: "Pi",
    initial: "π",
    maxFailures: 2,
    defaultMode: "action",
    buildActionCommand: buildPiActionCommand,
    buildReviewCommand: buildPiReviewCommand,
    buildAskCommand: buildPiAskCommand,
    createRenderer: () => new PiStreamRenderer(),
    actionLabel: "Pi",
    reviewLabel: "Pi Review",
    askLabel: "Pi Ask",
    needsGuestAuth: true,
    preflight: { label: "Pi coding agent", command: buildPiPreflightCommand },
  },
  codex: {
    name: "codex",
    displayName: "Codex",
    initial: "X",
    maxFailures: 2,
    defaultMode: "action",
    buildActionCommand: buildCodexActionCommand,
    buildReviewCommand: buildCodexReviewCommand,
    buildAskCommand: buildCodexAskCommand,
    createRenderer: () => new CodexStreamRenderer(),
    actionLabel: "Codex Action",
    reviewLabel: "Codex Review",
    askLabel: "Codex Ask",
    needsGuestAuth: true,
    preflight: { label: "Codex auth", command: () => runAsAgent("codex login status", "codex") },
  },
  kimi: {
    name: "kimi",
    displayName: "Kimi",
    initial: "K",
    maxFailures: 2,
    defaultMode: "action",
    buildActionCommand: buildKimiActionCommand,
    buildReviewCommand: buildKimiReviewCommand,
    buildAskCommand: buildKimiAskCommand,
    createRenderer: () => new KimiStreamRenderer(),
    actionLabel: "Kimi",
    reviewLabel: "Kimi Review",
    askLabel: "Kimi Ask",
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
