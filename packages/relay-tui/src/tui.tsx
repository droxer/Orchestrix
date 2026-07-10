import { resolve } from "node:path";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, render, Text, useApp, useInput } from "ink";

import {
  type AgentName,
  type AgentTaskMode,
  type RelaySession,
  type SessionController,
  type SessionStore,
  GUEST_WORKSPACE,
  LocalSessionStore,
  RelayDaemonClient,
  SessionController as RelaySessionController,
  StderrLineRenderer,
  assignmentFailureOutcome,
  assignmentSucceeded,
  hostWorkspacePath,
  initialAgentState,
  shellQuote,
  stripAnsi,
  type RelayEvent,
  type SandboxRecord,
  type ControlPanelDaemonNodeRecord,
  AGENT_NAMES,
  ensureDaemonNodeToken,
  getAgent,
  isAgentName,
} from "relay-core";
import { ensureAgentReady, type OrchestratorSession } from "relay-daemon";

export interface ParsedAssignment {
  agent: AgentName;
  mode?: AgentTaskMode;
}

export interface ParsedTask {
  assignments: ParsedAssignment[];
  task: string;
}

export interface RunRequest {
  assignments: ParsedAssignment[];
  task: string;
  log: (text: string) => void;
  onAgentStart?: (assignment: ParsedAssignment) => void;
  onSessionUpdate?: (session: RelaySession) => void;
  sessionId?: string;
  controller?: SessionController;
  workspacePath?: string;
  signal?: AbortSignal;
}

export type AssignmentRunner = (request: RunRequest) => Promise<void>;

const leadingMentionPattern = new RegExp(`^@(${AGENT_NAMES.join("|")})\\b`, "i");
const MAX_LOG_LINES = 200;
const VISIBLE_LOG_LINES = 18;
const AGENT_SHORTCUTS = AGENT_NAMES.map((agent) => `@${agent}`);
// "@claude, @pi, @codex, or @kimi" — derived from the registry for user-facing hints.
const AGENT_MENTION_HINT = AGENT_NAMES.map((agent) => `@${agent}`).join(", ");
const COMMAND_SHORTCUTS = ["/approve", "/reject", "/cancel", "/rerun", "/handoff", "/sessions", "/open", "/new", "/rename", "/summary", "/quit"] as const;
const RELAY_ACCENT = "#D97757";
const RELAY_DIM = "gray";
const RELAY_OK = "green";
const RELAY_WARN = "yellow";
const RELAY_ERR = "red";
const RELAY_INFO = "cyan";
const RELAY_THINK = "gray";
const RELAY_TOOL = "magenta";
const RELAY_CODE = "cyan";
const BRAND_MARK = "R";
const TEXT_MARK = "●";
const THINK_MARK = "○";
const TOOL_MARK = "⏺";
const SPINNER_FRAMES = ["·", "✢", "*", "✳", "✶", "✻", "✽"] as const;
const DAEMON_POLL_INTERVAL_MS = 400;
const DAEMON_ABORT_TERMINAL_WAIT_MS = 15_000;
const STATUS_LABELS: Record<string, string> = {
  OK: RELAY_OK,
  WARN: RELAY_WARN,
  ERR: RELAY_ERR,
  INFO: RELAY_INFO,
};
const AGENT_COLORS: Record<string, string> = {
  claude: "#D97757",
  pi: "#7BD3F7",
  codex: "#C792EA",
  kimi: "#FFD580",
};
const ARTIFACT_KIND_COLORS: Record<string, string> = {
  plan: "cyan",
  command_log: "magenta",
  diff: "yellow",
  review: "green",
  summary: "blue",
};

export interface CompletionResult {
  input: string;
  completed: boolean;
  candidates: string[];
}

export interface ShortcutSuggestions {
  tokenStart: number;
  token: string;
  candidates: string[];
}

export function parseAssignedTask(input: string): ParsedTask {
  const assignments: ParsedAssignment[] = [];
  let task = input.trim();
  while (true) {
    const match = leadingMentionPattern.exec(task);
    if (!match) break;
    assignments.push({ agent: match[1].toLowerCase() as AgentName });
    task = task.slice(match[0].length).trimStart();
  }
  return { assignments, task: task.replace(/\s+/g, " ").trim() };
}

export function validateParsedTask(parsed: ParsedTask): string | null {
  if (!parsed.task) return "Enter a task after the @mentions.";
  if (parsed.assignments.length === 0) return `Assign the task with ${AGENT_MENTION_HINT}.`;
  return null;
}

export function withDefaultAssignments(parsed: ParsedTask, defaultAssignments: ParsedAssignment[]): ParsedTask {
  if (parsed.assignments.length > 0 || defaultAssignments.length === 0) return parsed;
  return {
    ...parsed,
    assignments: defaultAssignments.map((assignment) => ({ ...assignment })),
  };
}

export function completeShortcutInput(input: string): CompletionResult {
  const suggestions = shortcutSuggestions(input);
  if (!suggestions) return { input, completed: false, candidates: [] };
  const activeSuggestions = suggestions;
  const candidates = activeSuggestions.candidates;
  if (candidates.length === 0) return { input, completed: false, candidates };

  const shortcuts = activeSuggestions.token.startsWith("@") ? AGENT_SHORTCUTS : COMMAND_SHORTCUTS;
  const exactIndex = shortcuts.findIndex((shortcut) => shortcut === activeSuggestions.token);
  const replacement = exactIndex >= 0
    ? shortcuts[(exactIndex + 1) % shortcuts.length]
    : candidates[0];
  return {
    input: applyShortcutSelection(input, activeSuggestions, replacement),
    completed: replacement !== activeSuggestions.token,
    candidates,
  };
}

export function shortcutSuggestions(input: string): ShortcutSuggestions | null {
  const match = /(^|\s)([@/][^\s]*)$/.exec(input);
  if (!match) return null;
  const token = match[2];
  const shortcuts = token.startsWith("@") ? AGENT_SHORTCUTS : COMMAND_SHORTCUTS;
  const candidates = shortcuts.filter((shortcut) => shortcut.startsWith(token));
  if (candidates.length === 0) return null;
  return {
    tokenStart: match.index + match[1].length,
    token,
    candidates: [...candidates],
  };
}

export function applyShortcutSelection(input: string, suggestions: ShortcutSuggestions, selected: string): string {
  return `${input.slice(0, suggestions.tokenStart)}${selected}`;
}

export async function runAssignments(request: RunRequest): Promise<void> {
  if (request.assignments.length === 0) {
    throw new Error(`Assign the task with ${AGENT_MENTION_HINT}.`);
  }
  const controller = request.controller ?? new RelaySessionController(undefined, {
    workspacePath: request.workspacePath,
    sink: request.log,
    signal: request.signal,
    onUpdate: request.onSessionUpdate,
  });
  const sessionId = request.sessionId ?? (await controller.createSession(request.task)).id;
  let state = initialAgentState(request.task);
  let terminalRecorded = false;
  const recordCancelled = async (outcome: string): Promise<void> => {
    if (terminalRecorded) return;
    await controller.cancelSession(sessionId, outcome);
    terminalRecorded = true;
  };
  const recordFailed = async (outcome: string): Promise<void> => {
    if (terminalRecorded) return;
    await controller.failSession(sessionId, outcome);
    terminalRecorded = true;
  };
  try {
    for (const assignment of request.assignments) {
      if (request.signal?.aborted) {
        request.log("\nWARN  Cancelled before next agent.\n");
        await recordCancelled("Task cancelled before the next agent started.");
        return;
      }
      const mode = assignment.mode ?? "action";
      request.onAgentStart?.(assignment);
      await ensureAgentReady(assignment.agent, request.log, request.signal);
      state = await controller.runStep(sessionId, state, { agent: assignment.agent, mode }, {
        sink: request.log,
        signal: request.signal,
      });
      if (!assignmentSucceeded({ agent: assignment.agent, mode }, state)) {
        const outcome = assignmentFailureOutcome({ agent: assignment.agent, mode }, state);
        await recordFailed(outcome);
        request.log(`\n${outcome}\n`);
        return;
      }
      if (request.signal?.aborted) {
        request.log("\nCancelled current agent.\n");
        await recordCancelled("Task cancelled during agent execution.");
        return;
      }
    }
  } catch (error: unknown) {
    if (request.signal?.aborted) {
      request.log("\nCancelled current agent.\n");
      await recordCancelled("Task cancelled during agent execution.");
      return;
    }
    const outcome = error instanceof Error ? error.message : String(error);
    await recordFailed(outcome);
    throw error;
  }
  terminalRecorded = true;
  await controller.completeSession(sessionId, "Assignments completed.");
}

export function createDaemonAssignmentRunner(
  client: RelayDaemonClient,
  sandboxId: string,
): AssignmentRunner {
  const deliveredEventIds = new Set<string>();
  const renderers = new Map<string, { feed(chunk: string): string }>();
  return async (request) => {
    if (request.assignments.length === 0) {
      throw new Error(`Assign the task with ${AGENT_MENTION_HINT}.`);
    }
    request.log("\nINFO  Submitting task to Relay daemon.\n");
    const assignments = request.assignments.map((assignment) => ({
      agent: assignment.agent,
      mode: assignment.mode ?? "action",
    }));
    const sessionId = request.sessionId ?? (await client.createSession({
      taskGoal: request.task,
      workspacePath: request.workspacePath,
      assignments,
      signal: request.signal,
    })).id;
    if (!request.sessionId) {
      request.onSessionUpdate?.(await client.getSession(sessionId, request.signal));
    }
    let cancelPromise: Promise<RelaySession | undefined> | undefined;
    const requestDaemonCancel = (): Promise<RelaySession | undefined> => {
      if (cancelPromise) return cancelPromise;
      cancelPromise = client.cancelSandboxRun({
        sandboxId,
        sessionId,
        reason: "Cancelled by human.",
      }).then((session) => {
        request.onSessionUpdate?.(session);
        return session;
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        // Make the cancel failure loud — the daemon may still be running the
        // agent. Reset cancelPromise so a subsequent /cancel retries.
        cancelPromise = undefined;
        request.log(`\nERR daemon cancel failed: ${message}. Press /cancel again to retry.\n`);
        throw error;
      });
      return cancelPromise;
    };
    const abortListener = (): void => {
      void requestDaemonCancel().catch(() => undefined);
    };
    request.signal?.addEventListener("abort", abortListener, { once: true });
    if (request.signal?.aborted) void requestDaemonCancel().catch(() => undefined);
    const run = client.runSandbox({
      sandboxId,
      taskGoal: request.task,
      sessionId,
      assignments,
      signal: request.signal,
    });
    try {
      const session = await pollDaemonRunOutput(client, sessionId, run, {
        deliveredEventIds,
        log: request.log,
        renderers,
        signal: request.signal,
        onSessionUpdate: request.onSessionUpdate,
        onAbort: requestDaemonCancel,
      });
      replayDaemonAgentOutput(session.events, deliveredEventIds, request.log, renderers);
      request.onSessionUpdate?.(session);
      assertDaemonSessionSucceeded(session, request.signal);
    } finally {
      request.signal?.removeEventListener("abort", abortListener);
    }
  };
}

function assertDaemonSessionSucceeded(session: RelaySession, signal?: AbortSignal): void {
  if (session.status === "failed") {
    throw new RenderedRunError(formatDaemonFailureForTui(session.finalOutcome ?? "Relay daemon session failed."));
  }
  if (session.status === "cancelled" && !signal?.aborted) {
    throw new Error(session.finalOutcome ?? "Relay daemon session cancelled.");
  }
}

class RenderedRunError extends Error {
  readonly logAlreadyRendered = true;
}

function logAlreadyRendered(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "logAlreadyRendered" in error &&
    (error as { logAlreadyRendered?: unknown }).logAlreadyRendered === true,
  );
}

async function pollDaemonRunOutput(
  client: RelayDaemonClient,
  sessionId: string,
  run: Promise<RelaySession>,
  options: {
    deliveredEventIds: Set<string>;
    log: (text: string) => void;
    renderers: Map<string, { feed(chunk: string): string }>;
    signal?: AbortSignal;
    onSessionUpdate?: (session: RelaySession) => void;
    onAbort?: () => Promise<RelaySession | undefined>;
  },
): Promise<RelaySession> {
  let settled = false;
  let finalSession: RelaySession | undefined;
  let failure: unknown;
  const trackedRun = run.then(
    (session) => {
      settled = true;
      finalSession = session;
    },
    (error: unknown) => {
      settled = true;
      failure = error;
    },
  );

  const MAX_CONSECUTIVE_POLL_FAILURES = 5;
  let consecutivePollFailures = 0;
  while (!settled) {
    await delay(DAEMON_POLL_INTERVAL_MS, options.signal);
    if (settled) break;
    if (options.signal?.aborted) break;
    try {
      const session = await client.getSession(sessionId, options.signal);
      consecutivePollFailures = 0;
      replayDaemonAgentOutput(session.events, options.deliveredEventIds, options.log, options.renderers);
      options.onSessionUpdate?.(session);
    } catch (error) {
      if (options.signal?.aborted) break;
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Not found")) continue;
      consecutivePollFailures += 1;
      options.log(`\nWARN poll failed (${consecutivePollFailures}/${MAX_CONSECUTIVE_POLL_FAILURES}): ${message}\n`);
      if (consecutivePollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) throw error;
    }
  }

  await trackedRun;
  if (failure) {
    if (options.signal?.aborted) {
      await options.onAbort?.();
      return waitForTerminalDaemonSession(client, sessionId, {
        deliveredEventIds: options.deliveredEventIds,
        log: options.log,
        renderers: options.renderers,
        onSessionUpdate: options.onSessionUpdate,
      });
    }
    throw failure;
  }
  if (finalSession) return finalSession;
  try {
    return await client.getSession(sessionId, options.signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Daemon run settled but final session fetch failed: ${message}`);
  }
}

async function waitForTerminalDaemonSession(
  client: RelayDaemonClient,
  sessionId: string,
  options: {
    deliveredEventIds: Set<string>;
    log: (text: string) => void;
    renderers: Map<string, { feed(chunk: string): string }>;
    onSessionUpdate?: (session: RelaySession) => void;
  },
): Promise<RelaySession> {
  const deadline = Date.now() + DAEMON_ABORT_TERMINAL_WAIT_MS;
  while (true) {
    const session = await client.getSession(sessionId);
    replayDaemonAgentOutput(session.events, options.deliveredEventIds, options.log, options.renderers);
    options.onSessionUpdate?.(session);
    if (session.status === "completed" || session.status === "failed" || session.status === "cancelled") {
      return session;
    }
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for daemon run to stop after cancellation.");
    }
    await delay(DAEMON_POLL_INTERVAL_MS);
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export function replayDaemonAgentOutput(
  events: RelayEvent[],
  deliveredEventIds: Set<string>,
  log: (text: string) => void,
  renderers = new Map<string, { feed(chunk: string): string }>(),
): void {
  for (const event of events) {
    if (deliveredEventIds.has(event.id)) continue;
    if (event.type === "agent.output") {
      deliveredEventIds.add(event.id);
      if (event.stream === "stderr" && isBoxLiteSingleRuntimeError(event.text)) continue;
      const rendered = rendererForDaemonOutput(event, renderers).feed(daemonRendererInput(event.text));
      if (rendered) log(rendered);
      continue;
    }
    if (event.type === "agent.started") {
      deliveredEventIds.add(event.id);
      log(`\nINFO  ${event.agent}  started\n`);
      continue;
    }
    if (event.type === "agent.completed") {
      deliveredEventIds.add(event.id);
      const badge = event.status === "completed" ? "OK" : event.status === "cancelled" ? "WARN" : "ERR";
      log(`\n${badge}  ${event.agent}  ${event.status} (exit ${event.exitCode})\n`);
      continue;
    }
    if (event.type === "artifact.created") {
      deliveredEventIds.add(event.id);
      log(`\n⏺ ${event.artifact.kind} · ${event.artifact.title}\n`);
      continue;
    }
    if (event.type === "session.failed") {
      deliveredEventIds.add(event.id);
      log(`\nERR  ${formatDaemonFailureForTui(event.outcome)}\n`);
      continue;
    }
  }
}

function isBoxLiteSingleRuntimeError(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ");
  return normalized.includes("Another Relay orchestrator is already running:")
    && normalized.includes("only one BoxLite runtime can use ");
}

function formatDaemonFailureForTui(text: string): string {
  if (!isBoxLiteSingleRuntimeError(text)) return text;
  return "Another Relay orchestrator is already running. Stop the existing Relay daemon first (try `make stop`) before retrying.";
}

function daemonRendererInput(text: string): string {
  const output: string[] = [];
  let unwrapped = false;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("event:")) {
      unwrapped = true;
      continue;
    }
    if (trimmed.startsWith("data:")) {
      unwrapped = true;
      const payload = trimmed.slice("data:".length).trimStart();
      output.push(withTrailingNewline(agentOutputTextPayload(payload) ?? payload));
      continue;
    }
    const payload = agentOutputTextPayload(trimmed);
    if (payload !== undefined) {
      unwrapped = true;
      output.push(withTrailingNewline(payload));
    } else if (unwrapped) {
      output.push(`${line}\n`);
    }
  }

  return unwrapped ? output.join("") : text;
}

function agentOutputTextPayload(value: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object") return undefined;
    const record = parsed as Record<string, unknown>;
    return record.type === "agent.output" && typeof record.text === "string"
      ? record.text
      : undefined;
  } catch {
    return undefined;
  }
}

function withTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function rendererForDaemonOutput(
  event: Extract<RelayEvent, { type: "agent.output" }>,
  renderers: Map<string, { feed(chunk: string): string }>,
): { feed(chunk: string): string } {
  const key = `${event.runId}:${event.agent}:${event.stream}`;
  const existing = renderers.get(key);
  if (existing) return existing;
  const renderer = event.stream === "stderr"
    ? new StderrLineRenderer()
    : getAgent(event.agent).createRenderer("action");
  renderers.set(key, renderer);
  return renderer;
}

export interface RelayTuiProps {
  session?: OrchestratorSession;
  workspacePath?: string;
  onExit?: () => void;
  runner?: AssignmentRunner;
  ready?: boolean;
  disabledMessage?: string;
  bootLogLines?: string[];
  sessionStore?: SessionStore;
  localSessionControl?: boolean;
  remoteSessionControl?: RemoteSessionControl;
}

export interface RemoteSessionControl {
  listSessions?(): Promise<RelaySession[]>;
  getSession?(sessionId: string): Promise<RelaySession>;
  renameSession?(sessionId: string, title: string): Promise<RelaySession>;
  recordDecision(input: {
    sessionId: string;
    kind: "approve" | "reject" | "cancel" | "rerun" | "mark_done";
    note?: string;
    targetAgent?: AgentName;
  }): Promise<RelaySession>;
  recordHandoff(input: {
    sessionId: string;
    targetAgent: AgentName;
    note?: string;
    mode?: AgentTaskMode;
  }): Promise<RelaySession>;
}

function splitToLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function pushLines(existing: string[], text: string): string[] {
  if (!text) return existing;
  // The TUI renders styling through Ink, so drop the renderers' inline ANSI
  // before it lands in the transcript buffer — otherwise the escape codes
  // fight Ink's own colours and corrupt width/markdown parsing.
  const incoming = splitToLines(stripAnsi(normalizeTranscriptText(text)));
  const merged = existing.length === 0
    ? incoming
    : [...existing.slice(0, -1), `${existing[existing.length - 1]}${incoming[0]}`, ...incoming.slice(1)];
  return merged.length > MAX_LOG_LINES ? merged.slice(merged.length - MAX_LOG_LINES) : merged;
}

function normalizeTranscriptText(text: string): string {
  const output: string[] = [];
  let sawTransportOrJson = false;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      output.push(line);
      continue;
    }
    if (trimmed.startsWith("event:")) {
      sawTransportOrJson = true;
      continue;
    }
    if (trimmed.startsWith("data:")) {
      sawTransportOrJson = true;
      const payload = trimmed.slice("data:".length).trimStart();
      const display = displayTextFromJson(payload);
      if (display) output.push(display);
      continue;
    }

    const display = displayTextFromJson(trimmed);
    if (display !== undefined) {
      sawTransportOrJson = true;
      if (display) output.push(display);
      continue;
    }

    const mixedDisplay = displayTextFromMixedLine(line);
    if (mixedDisplay !== undefined) {
      sawTransportOrJson = true;
      if (mixedDisplay) output.push(mixedDisplay);
      continue;
    }

    output.push(line);
  }

  if (!sawTransportOrJson) return text;
  return output.join("\n");
}

function displayTextFromJson(value: string): string | undefined {
  try {
    return displayTextFromValue(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function displayTextFromMixedLine(line: string): string | undefined {
  let output = "";
  let cursor = 0;
  let sawDisplayJson = false;

  while (cursor < line.length) {
    const start = line.indexOf("{", cursor);
    if (start < 0) {
      output += line.slice(cursor);
      break;
    }

    output += line.slice(cursor, start);
    const end = jsonObjectEnd(line, start);
    if (end < 0) {
      output += line.slice(start);
      break;
    }

    const json = line.slice(start, end + 1);
    const display = displayTextFromJson(json);
    if (display === undefined) {
      output += json;
    } else {
      sawDisplayJson = true;
      output += display;
    }
    cursor = end + 1;
  }

  return sawDisplayJson ? output : undefined;
}

function jsonObjectEnd(value: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function displayTextFromValue(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const type = normalizedEventType(record.type);

  if (type === "agent.output" && typeof record.text === "string") {
    return normalizeTranscriptText(record.text);
  }

  if (type === "streamevent") {
    const event = record.event;
    if (event !== null && typeof event === "object") {
      const eventRecord = event as Record<string, unknown>;
      const eventType = normalizedEventType(eventRecord.type);
      const delta = eventRecord.delta;
      if (eventType === "contentblockdelta" && delta !== null && typeof delta === "object") {
        const deltaRecord = delta as Record<string, unknown>;
        const deltaType = normalizedEventType(deltaRecord.type);
        if (deltaType === "textdelta" && typeof deltaRecord.text === "string") return deltaRecord.text;
        if (deltaType === "thinkingdelta" && typeof deltaRecord.thinking === "string") return deltaRecord.thinking;
      }
      if (eventType === "contentblockstart" || eventType === "contentblockstop") return "";
    }
  }

  if (type === "item.completed" || type === "item.started") {
    const item = record.item;
    if (item !== null && typeof item === "object") {
      const itemRecord = item as Record<string, unknown>;
      if (
        (itemRecord.type === "agent_message" || itemRecord.type === "reasoning")
        && typeof itemRecord.text === "string"
      ) {
        return itemRecord.text;
      }
    }
  }

  if (typeof record.delta === "string") return record.delta;
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  const topLevelContent = textFromContentArray(record.content);
  if (topLevelContent) return topLevelContent;
  if (typeof record.message === "string") return record.message;

  const item = record.item;
  if (item !== null && typeof item === "object") {
    const itemRecord = item as Record<string, unknown>;
    if (typeof itemRecord.text === "string") return itemRecord.text;
    if (typeof itemRecord.content === "string") return itemRecord.content;
    const content = textFromContentArray(itemRecord.content);
    if (content) return content;
  }

  const message = record.message;
  if (message !== null && typeof message === "object") {
    const messageRecord = message as Record<string, unknown>;
    if (typeof messageRecord.text === "string") return messageRecord.text;
    if (typeof messageRecord.content === "string") return messageRecord.content;
    const content = textFromContentArray(messageRecord.content);
    if (content) return content;
  }

  return typeof record.type === "string" ? "" : undefined;
}

function textFromContentArray(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((chunk) => {
      if (chunk === null || typeof chunk !== "object") return "";
      const chunkRecord = chunk as Record<string, unknown>;
      if (typeof chunkRecord.text === "string") return chunkRecord.text;
      if (typeof chunkRecord.content === "string") return chunkRecord.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizedEventType(value: unknown): string {
  return typeof value === "string" ? value.replace(/_/g, "").toLowerCase() : "";
}

export function RelayTui({
  session,
  workspacePath,
  onExit,
  runner = runAssignments,
  ready = true,
  disabledMessage = "Starting Relay...",
  bootLogLines = [],
  sessionStore = new LocalSessionStore(),
  localSessionControl = true,
  remoteSessionControl,
}: RelayTuiProps): React.ReactElement {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [logLines, setLogLines] = useState<string[]>([
    `INFO  Ready — type ${AGENT_MENTION_HINT} followed by a task.`,
  ]);
  const [currentAgent, setCurrentAgent] = useState("idle");
  const [isRunning, setIsRunning] = useState(false);
  const [activeSession, setActiveSession] = useState<RelaySession | null>(null);
  const [defaultAssignments, setDefaultAssignments] = useState<ParsedAssignment[]>([]);
  const [message, setMessage] = useState("");
  const [shortcutIndex, setShortcutIndex] = useState(0);
  const [hiddenShortcutToken, setHiddenShortcutToken] = useState("");
  const [spinnerTick, setSpinnerTick] = useState(0);

  useEffect(() => {
    if (!isRunning) return;
    const handle = setInterval(() => setSpinnerTick((tick) => tick + 1), 120);
    return () => clearInterval(handle);
  }, [isRunning]);
  const spinnerFrame = SPINNER_FRAMES[spinnerTick % SPINNER_FRAMES.length];

  const runnerRef = useRef(runner);
  runnerRef.current = runner;
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const controllerRef = useRef<SessionController>(new RelaySessionController(sessionStore));
  useEffect(() => () => {
    mountedRef.current = false;
    abortRef.current?.abort();
  }, []);

  const allLogs = useMemo(() => [...bootLogLines, ...logLines], [bootLogLines, logLines]);
  const visibleLogs = useMemo(() => allLogs.slice(-VISIBLE_LOG_LINES), [allLogs]);
  const hiddenLogCount = Math.max(0, allLogs.length - visibleLogs.length);
  const queueLabel = !ready ? "booting" : isRunning ? "running" : "ready";
  const workspace = workspacePath ?? session?.hostWorkspace ?? "(test workspace)";
  const inputWidth = Math.max(20, (process.stdout.columns ?? 80) - 6);
  const visibleInput = input.length <= inputWidth ? input : `…${input.slice(input.length - inputWidth + 1)}`;
  const shortcutMenu = shortcutSuggestions(input);
  const showShortcutMenu = Boolean(shortcutMenu && input !== hiddenShortcutToken);
  const selectedShortcutIndex = shortcutMenu ? Math.min(shortcutIndex, shortcutMenu.candidates.length - 1) : 0;
  const defaultAssignmentLabel = formatAssignmentsLabel(defaultAssignments);

  const appendLog = (text: string): void => {
    if (!text || !mountedRef.current) return;
    setLogLines((lines) => pushLines(lines, text));
  };

  const startParsedTask = (parsed: ParsedTask): void => {
    void startParsedTaskAsync(parsed).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      setMessage(detail);
      appendLog(`\nERR ${detail}\n`);
    });
  };

  const startParsedTaskAsync = async (parsed: ParsedTask): Promise<void> => {
    let sessionId: string | undefined;
    if (localSessionControl) {
      const controller = new RelaySessionController(sessionStore, {
        workspacePath: workspace,
        onUpdate: setActiveSession,
      });
      controllerRef.current = controller;
      const created = await controller.createSession(parsed.task, ["human", ...parsed.assignments.map((assignment) => assignment.agent)]);
      sessionId = created.id;
      setActiveSession(created);
    }
    setDefaultAssignments(parsed.assignments.map((assignment) => ({ ...assignment })));
    executeParsedTask(parsed, sessionId);
  };

  const executeParsedTask = (parsed: ParsedTask, sessionId?: string): void => {
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);
    setCurrentAgent(parsed.assignments[0] ? formatAssignmentLabel(parsed.assignments[0]) : "starting");
    setMessage("");
    void runnerRef.current({
      assignments: parsed.assignments,
      task: parsed.task,
      log: appendLog,
      controller: controllerRef.current,
      sessionId,
      workspacePath: workspace,
      onSessionUpdate: setActiveSession,
      onAgentStart: (assignment) => {
        if (!mountedRef.current) return;
        setCurrentAgent(formatAssignmentLabel(assignment));
      },
      signal: controller.signal,
    })
      .then(() => {
        if (!mountedRef.current) return;
        const aborted = controller.signal.aborted;
        const finished = aborted ? "Task cancelled." : "Task finished.";
        const badge = aborted ? "WARN" : "OK";
        appendLog(`\n${badge}  ${finished}\n`);
        setMessage(finished);
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) return;
        const detail = error instanceof Error ? error.message : String(error);
        if (!logAlreadyRendered(error)) appendLog(`\nERR  ${detail}\n`);
        setMessage(detail);
      })
      .finally(() => {
        if (!mountedRef.current) return;
        setIsRunning(false);
        abortRef.current = null;
      });
  };

  useInput((typed, key) => {
    if (key.escape) {
      if (showShortcutMenu) {
        setHiddenShortcutToken(input);
        setShortcutIndex(0);
        return;
      }
      if (isRunning) {
        const controller = abortRef.current;
        if (controller && !controller.signal.aborted) {
          controller.abort();
          appendLog("\nWARN  Cancelling current agent.\n");
          setMessage("Cancelling…");
          return;
        }
        return;
      }
      exit();
      onExit?.();
      return;
    }
    if (isRunning) return;
    if (key.tab) {
      if (shortcutMenu) {
        setShortcutIndex((index) => (index + 1) % shortcutMenu.candidates.length);
        setHiddenShortcutToken("");
        setMessage("");
        return;
      }
      setMessage("No shortcut suggestions.");
      return;
    }
    if ((key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) && shortcutMenu) {
      const direction = key.upArrow || key.leftArrow ? -1 : 1;
      setShortcutIndex((index) => (index + direction + shortcutMenu.candidates.length) % shortcutMenu.candidates.length);
      setHiddenShortcutToken("");
      setMessage("");
      return;
    }
    if (key.return) {
      if (!ready) {
        setMessage(disabledMessage);
        return;
      }
      const command = input.trim();
      const exactCommand = command.startsWith("/") && COMMAND_SHORTCUTS.some(
        (shortcut) => command === shortcut || command.startsWith(`${shortcut} `),
      );
      if (exactCommand) {
        handleCommand(command);
        setInput("");
        return;
      }
      if (showShortcutMenu && shortcutMenu) {
        setInput(applyShortcutSelection(input, shortcutMenu, shortcutMenu.candidates[selectedShortcutIndex]));
        setShortcutIndex(0);
        setHiddenShortcutToken("");
        setMessage("");
        return;
      }
      if (command.startsWith("/")) {
        handleCommand(command);
        setInput("");
        return;
      }
      const parsed = withDefaultAssignments(parseAssignedTask(input), defaultAssignments);
      const error = validateParsedTask(parsed);
      if (error) {
        setMessage(error);
        return;
      }
      setInput("");
      startParsedTask(parsed);
      return;
    }
    if (key.backspace || key.delete) {
      setInput((value) => value.slice(0, -1));
      setShortcutIndex(0);
      setHiddenShortcutToken("");
      if (message) setMessage("");
      return;
    }
    if (typed && !key.ctrl && !key.meta) {
      setInput((value) => `${value}${typed}`);
      setShortcutIndex(0);
      setHiddenShortcutToken("");
      if (message) setMessage("");
    }
  });

  const handleCommand = (command: string): void => {
    const [name, ...rest] = command.split(/\s+/);
    const detail = rest.join(" ");
    const current = activeSession;
    if (name === "/quit") {
      exit();
      onExit?.();
      return;
    }
    if (name === "/sessions") {
      if (!localSessionControl) {
        if (!remoteSessionControl?.listSessions) {
          appendLog("\nSession listing is served by the host daemon API.\n");
          setMessage("Session listing is unavailable in daemon mode.");
          return;
        }
        void remoteSessionControl.listSessions().then((items) => {
          const sessions = items.slice(0, 6);
          appendLog(`\n${sessions.map((item) => `${item.id}  ${item.status}  ${item.title ?? item.taskGoal}`).join("\n") || "No sessions yet."}\n`);
          setMessage("Listed recent sessions.");
        }).catch((error: unknown) => {
          setMessage(error instanceof Error ? error.message : String(error));
        });
        return;
      }
      void sessionStore.listSessions().then((items) => {
        const sessions = items.slice(0, 6);
        appendLog(`\n${sessions.map((item) => `${item.id}  ${item.status}  ${item.title ?? item.taskGoal}`).join("\n") || "No sessions yet."}\n`);
        setMessage("Listed recent sessions.");
      }).catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : String(error));
      });
      return;
    }
    if (name === "/open") {
      if (!localSessionControl) {
        if (!remoteSessionControl?.getSession) {
          setMessage("Session opening is unavailable in daemon mode.");
          return;
        }
        if (!detail) {
          setMessage("Usage: /open <session-id>");
          return;
        }
        void remoteSessionControl.getSession(detail).then((opened) => {
          setActiveSession(opened);
          setMessage(`Opened ${opened.id}.`);
        }).catch((error: unknown) => {
          const fallback = `Unknown Relay session ${detail}.`;
          setMessage(error instanceof Error ? error.message : fallback);
        });
        return;
      }
      if (!detail) {
        setMessage("Usage: /open <session-id>");
        return;
      }
      void sessionStore.getSession(detail).then((opened) => {
        setActiveSession(opened);
        setMessage(`Opened ${opened.id}.`);
      }).catch((error: unknown) => {
        const fallback = `Unknown Relay session ${detail}.`;
        setMessage(error instanceof Error ? error.message : fallback);
      });
      return;
    }
    if (name === "/summary") {
      if (!current) {
        setMessage("No active session.");
        return;
      }
      appendLog(`\nSession ${current.id}\n${current.status} ${current.phase}\n${current.agentRuns.length} runs, ${current.artifacts.length} artifacts\n${current.finalOutcome ?? current.title ?? current.taskGoal}\n`);
      setMessage("Summary appended.");
      return;
    }
    if (name === "/new") {
      // Each typed task already opens a fresh session; clearing the active
      // session resets the transcript so the next task starts a new conversation.
      setActiveSession(null);
      setDefaultAssignments([]);
      setCurrentAgent("idle");
      setLogLines([`INFO  Ready — type ${AGENT_MENTION_HINT} followed by a task.`]);
      setMessage("Started a new conversation.");
      return;
    }
    if (name === "/rename") {
      if (!current) {
        setMessage("No active session.");
        return;
      }
      const title = detail?.trim();
      if (!title) {
        setMessage("Usage: /rename <title>");
        return;
      }
      if (localSessionControl) {
        void controllerRef.current.renameSession(current.id, title).then((updated) => {
          setActiveSession(updated);
          setMessage(`Renamed to ${updated.title ?? title}.`);
        }).catch((error: unknown) => {
          setMessage(error instanceof Error ? error.message : String(error));
        });
        return;
      }
      if (!remoteSessionControl?.renameSession) {
        setMessage("Renaming is unavailable.");
        return;
      }
      void remoteSessionControl.renameSession(current.id, title).then((updated) => {
        setActiveSession(updated);
        setMessage(`Renamed to ${title}.`);
      }).catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : String(error));
      });
      return;
    }
    const runRemoteDecision = async (
      kind: "approve" | "reject" | "cancel" | "rerun" | "mark_done",
      note?: string,
      targetAgent?: AgentName,
    ): Promise<RelaySession | undefined> => {
      if (!remoteSessionControl || !current) return undefined;
      try {
        const updated = await remoteSessionControl.recordDecision({ sessionId: current.id, kind, note, targetAgent });
        setActiveSession(updated);
        return updated;
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        setMessage(`Failed to record ${kind} on daemon: ${detail}`);
        appendLog(`\nERR daemon ${kind} failed: ${detail}\n`);
        return undefined;
      }
    };

    if (name === "/approve") {
      if (!current) {
        setMessage("No active session.");
        return;
      }
      if (localSessionControl) {
        setMessage("Approval is not required; prompts run immediately.");
        return;
      }
      void runRemoteDecision("approve", detail || undefined);
      setMessage("Approval sent to daemon.");
      return;
    }
    if (name === "/reject") {
      if (!current) {
        setMessage("No active session.");
        return;
      }
      if (localSessionControl) {
        void controllerRef.current.recordDecision(current.id, "reject", detail || "Rejected by human.").then(setActiveSession);
      } else {
        void runRemoteDecision("reject", detail || "Rejected by human.");
      }
      setMessage("Feedback recorded.");
      return;
    }
    if (name === "/cancel") {
      abortRef.current?.abort();
      if (current) {
        if (localSessionControl) {
          void controllerRef.current.recordDecision(current.id, "cancel", "Cancelled by human.").then(setActiveSession);
        } else {
          void runRemoteDecision("cancel", "Cancelled by human.");
        }
      }
      setMessage("Cancellation requested.");
      return;
    }
    if (name === "/rerun") {
      const agent = detail as AgentName;
      if (!current || !isAgentName(agent)) {
        setMessage(`Usage: /rerun <${AGENT_NAMES.join("|")}>`);
        return;
      }
      void (async () => {
        if (localSessionControl) {
          const updated = await controllerRef.current.recordDecision(current.id, "rerun", "Rerun requested.", agent);
          setActiveSession(updated);
        } else if (remoteSessionControl) {
          const updated = await runRemoteDecision("rerun", "Rerun requested.", agent);
          if (!updated) return;
        }
        executeParsedTask({ assignments: [{ agent, mode: "action" }], task: current.taskGoal }, current.id);
      })().catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        setMessage(`Failed to rerun session: ${detail}`);
        appendLog(`\nERR rerun failed: ${detail}\n`);
      });
      return;
    }
    if (name === "/handoff") {
      const [agentText, ...noteParts] = rest;
      const agent = agentText as AgentName;
      if (!current || !isAgentName(agent)) {
        setMessage(`Usage: /handoff <${AGENT_NAMES.join("|")}> [note]`);
        return;
      }
      const reviewFlagIndex = noteParts.indexOf("--review");
      const mode: AgentTaskMode = reviewFlagIndex === -1 ? "action" : "review";
      if (reviewFlagIndex !== -1) noteParts.splice(reviewFlagIndex, 1);
      const note = noteParts.join(" ").trim();
      const assignment = { agent, mode };
      const defaultAssignment = { agent, mode };
      void (async () => {
        if (localSessionControl) {
          const updated = await controllerRef.current.handoffSession(
            current.id,
            agent,
            [assignment],
            note || `Handoff to ${agent}.`,
          );
          setActiveSession(updated);
        } else if (remoteSessionControl) {
          try {
            const updated = await remoteSessionControl.recordHandoff({
              sessionId: current.id,
              targetAgent: agent,
              note: note || `Handoff to ${agent}.`,
              mode,
            });
            setActiveSession(updated);
          } catch (error: unknown) {
            const detail = error instanceof Error ? error.message : String(error);
            setMessage(`Failed to record handoff on daemon: ${detail}`);
            appendLog(`\nERR daemon handoff failed: ${detail}\n`);
            return;
          }
        }
        setCurrentAgent(formatAssignmentLabel(assignment));
        setDefaultAssignments([defaultAssignment]);
        executeParsedTask({ assignments: [assignment], task: current.taskGoal }, current.id);
      })().catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        setMessage(`Failed to hand off session: ${detail}`);
        appendLog(`\nERR handoff failed: ${detail}\n`);
      });
      return;
    }
    setMessage(`Unknown command: ${name}`);
  };

  const statusTone = statusColor(queueLabel);
  const statusMark = queueLabel === "running" || queueLabel === "booting" ? spinnerFrame : statusGlyphMark(queueLabel);

  return (
    <Box flexDirection="column" height="100%" paddingX={1} paddingY={1}>
      <Box borderStyle="round" borderColor={RELAY_DIM} paddingX={1} flexDirection="column">
        <Box justifyContent="space-between">
          <Text>
            <Text color={RELAY_ACCENT} bold>{BRAND_MARK} Relay</Text>
            <Text dimColor>  ·  Agent Orchestration</Text>
          </Text>
          <Text>
            <Text color={statusTone}>{statusMark}</Text>
            <Text dimColor> {queueLabel}</Text>
          </Text>
        </Box>
        <Text>
          <Text dimColor>{"cwd   "}</Text>
          <Text>{shortenPath(workspace)}</Text>
          <Text dimColor>{"   mount "}</Text>
          <Text>{GUEST_WORKSPACE}</Text>
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} paddingX={1} marginTop={1}>
        {renderMarkdownTranscript(visibleLogs, hiddenLogCount)}
      </Box>
      <Box
        borderStyle="round"
        borderColor={showShortcutMenu ? RELAY_ACCENT : RELAY_DIM}
        paddingX={1}
        flexDirection="column"
        marginTop={1}
      >
        <PromptLine
          isRunning={isRunning}
          ready={ready}
          disabledMessage={disabledMessage}
          visibleInput={visibleInput}
          input={input}
          spinnerFrame={spinnerFrame}
          currentAgent={currentAgent}
        />
        {showShortcutMenu && shortcutMenu ? (
          <Box marginTop={0}>
            <Text>
              {shortcutMenu.candidates.map((candidate, index) => {
                const selected = index === selectedShortcutIndex;
                return (
                  <Text key={candidate}>
                    {index > 0 ? <Text dimColor>  </Text> : null}
                    <Text color={selected ? RELAY_ACCENT : undefined} inverse={selected}>
                      {` ${candidate} `}
                    </Text>
                  </Text>
                );
              })}
            </Text>
          </Box>
        ) : null}
      </Box>
      <Box paddingX={1} justifyContent="space-between">
        <PromptHintText isRunning={isRunning} ready={ready} showShortcutMenu={showShortcutMenu} />
        <Text>
          {defaultAssignments.length > 0 ? (
            <Text dimColor>· {defaultAssignmentLabel}</Text>
          ) : (
            <Text dimColor>No Agent Yet</Text>
          )}
          {activeSession ? (
            <>
              <Text dimColor> · </Text>
              <Text color={RELAY_ACCENT}>{activeSession.id}</Text>
              <Text dimColor> {activeSession.status}/{activeSession.phase}</Text>
            </>
          ) : null}
        </Text>
      </Box>
      {message ? (
        <Box paddingX={1}>
          <Text color={RELAY_ACCENT}>{BRAND_MARK} </Text>
          <Text dimColor>{message}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function renderMarkdownTranscript(lines: string[], hiddenCount: number): React.ReactElement[] {
  const output: React.ReactElement[] = [];
  if (hiddenCount > 0) {
    output.push(
      <Text key="truncation-header" dimColor>
        {truncationRule(hiddenCount)}
      </Text>,
    );
  }
  let inCodeBlock = false;
  lines.forEach((line, index) => {
    const key = `log-${index}`;
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      const language = line.replace(/^\s*```/, "").trim();
      output.push(
        <Text key={key}>
          <Text color={RELAY_CODE} inverse>{` ${language || "code"} `}</Text>
          <Text dimColor>{"  ─────────"}</Text>
        </Text>,
      );
      return;
    }
    output.push(renderMarkdownLine(line, key, inCodeBlock));
  });
  return output;
}

function truncationRule(hiddenCount: number): string {
  const width = Math.max(8, Math.min((process.stdout.columns ?? 80) - 6, 80));
  const label = ` ${hiddenCount} earlier line${hiddenCount === 1 ? "" : "s"} hidden `;
  if (label.length + 6 >= width) return label.trim();
  const dashes = width - label.length;
  const left = Math.floor(dashes / 2);
  const right = dashes - left;
  return `${"─".repeat(left)}${label}${"─".repeat(right)}`;
}

function renderMarkdownLine(line: string, key: string, inCodeBlock: boolean): React.ReactElement {
  if (line.length === 0) return <Text key={key}> </Text>;
  if (inCodeBlock) {
    return (
      <Text key={key}>
        <Text dimColor>│ </Text>
        <Text>{line}</Text>
      </Text>
    );
  }

  const agentMarker = renderAgentMarkerLine(line, key);
  if (agentMarker) return agentMarker;

  const statusLine = renderStatusLine(line, key);
  if (statusLine) return statusLine;

  const heading = /^(#{1,6})\s+(.+)$/.exec(line);
  if (heading) {
    const level = heading[1].length;
    return (
      <Text key={key} color={level <= 2 ? RELAY_ACCENT : undefined} bold>
        {heading[2]}
      </Text>
    );
  }

  if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
    return (
      <Text key={key} dimColor>
        {horizontalRule()}
      </Text>
    );
  }

  const blockquote = /^\s*>\s?(.*)$/.exec(line);
  if (blockquote) {
    return (
      <Text key={key}>
        <Text color={RELAY_ACCENT}>│ </Text>
        <Text italic dimColor>{renderInlineMarkdown(blockquote[1], key)}</Text>
      </Text>
    );
  }

  const unordered = /^(\s*)[-*+]\s+(.+)$/.exec(line);
  if (unordered) {
    return (
      <Text key={key}>
        <Text dimColor>{`${unordered[1]}- `}</Text>
        {renderInlineMarkdown(unordered[2], key)}
      </Text>
    );
  }

  const ordered = /^(\s*)(\d+)\.\s+(.+)$/.exec(line);
  if (ordered) {
    return (
      <Text key={key}>
        <Text dimColor>{`${ordered[1]}${ordered[2]}. `}</Text>
        {renderInlineMarkdown(ordered[3], key)}
      </Text>
    );
  }

  return <Text key={key}>{renderInlineMarkdown(line, key)}</Text>;
}

function horizontalRule(): string {
  const width = Math.max(8, Math.min((process.stdout.columns ?? 80) - 6, 80));
  return "─".repeat(width);
}

// Agent stream renderers prefix each turn with a marker glyph: ● for spoken
// text, ○ for thinking/reasoning, ⏺ for a tool/command line. Re-style those
// markers through Ink instead of leaving the renderers' (now-stripped) ANSI.
function renderAgentMarkerLine(line: string, key: string): React.ReactElement | null {
  const text = /^●\s+(.*)$/.exec(line);
  if (text) {
    return (
      <Text key={key}>
        <Text color={RELAY_ACCENT} bold>{`${TEXT_MARK} `}</Text>
        {renderInlineMarkdown(text[1], key)}
      </Text>
    );
  }

  const thinking = /^○\s+(.*)$/.exec(line);
  if (thinking) {
    return (
      <Text key={key}>
        <Text color={RELAY_THINK} dimColor>{`${THINK_MARK} `}</Text>
        <Text color={RELAY_THINK} dimColor italic>{thinking[1]}</Text>
      </Text>
    );
  }

  const tool = /^⏺\s+(\S+)\s*(.*)$/.exec(line);
  if (tool) {
    const kindColor = ARTIFACT_KIND_COLORS[tool[1].toLowerCase()] ?? RELAY_TOOL;
    const rest = tool[2].replace(/^·\s*/, "");
    return (
      <Text key={key}>
        <Text color={kindColor}>{`${TOOL_MARK} `}</Text>
        <Text color={kindColor} bold>{tool[1]}</Text>
        {rest ? (
          <>
            <Text dimColor>{"  ·  "}</Text>
            <Text color={kindColor}>{rest}</Text>
          </>
        ) : null}
      </Text>
    );
  }

  return null;
}

// Status lines emitted via format.status(): "OK …", "WARN …", "ERR …", "INFO …".
function renderStatusLine(line: string, key: string): React.ReactElement | null {
  const match = /^(OK|WARN|ERR|INFO)\s{1,2}(.*)$/.exec(line);
  if (!match) return null;
  const tone = STATUS_LABELS[match[1]];
  const rest = match[2];
  const agentMatch = /^(\S+)\s{2}(.*)$/.exec(rest);
  const agentColor = agentMatch ? AGENT_COLORS[agentMatch[1].toLowerCase()] : undefined;
  return (
    <Text key={key}>
      <Text color={tone} bold inverse>{` ${match[1]} `}</Text>
      <Text>{"  "}</Text>
      {agentMatch && agentColor ? (
        <>
          <Text color={agentColor} bold>{agentMatch[1]}</Text>
          <Text dimColor>{"  "}</Text>
          <Text color={tone}>{agentMatch[2]}</Text>
        </>
      ) : (
        <Text color={tone}>{rest}</Text>
      )}
    </Text>
  );
}

function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const segments: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;
  let cursor = 0;
  let segmentIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) segments.push(text.slice(cursor, start));
    const token = match[0];
    const key = `${keyPrefix}-segment-${segmentIndex++}`;

    if (token.startsWith("`")) {
      segments.push(
        <Text key={key} inverse>
          {token.slice(1, -1)}
        </Text>,
      );
    } else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link) {
        segments.push(
          <Text key={key}>
            <Text color="blue" underline>{link[1]}</Text>
            <Text dimColor>{` (${link[2]})`}</Text>
          </Text>,
        );
      } else {
        segments.push(token);
      }
    } else if (token.startsWith("**") || token.startsWith("__")) {
      segments.push(
        <Text key={key} bold>
          {token.slice(2, -2)}
        </Text>,
      );
    } else {
      segments.push(
        <Text key={key} italic>
          {token.slice(1, -1)}
        </Text>,
      );
    }
    cursor = start + token.length;
  }

  if (cursor < text.length) segments.push(text.slice(cursor));
  return segments.length > 0 ? segments : [text];
}

function statusColor(queueLabel: string): string {
  if (queueLabel === "ready") return RELAY_OK;
  if (queueLabel === "running") return RELAY_ACCENT;
  if (queueLabel === "booting") return RELAY_WARN;
  return RELAY_WARN;
}

function statusGlyphMark(_queueLabel: string): string {
  return "●";
}

function shortenPath(path: string): string {
  const home = process.env.HOME;
  if (home && path.startsWith(home)) return `~${path.slice(home.length)}`;
  return path;
}

function PromptLine({
  isRunning,
  ready,
  disabledMessage,
  visibleInput,
  input,
  spinnerFrame,
  currentAgent,
}: {
  isRunning: boolean;
  ready: boolean;
  disabledMessage: string;
  visibleInput: string;
  input: string;
  spinnerFrame: string;
  currentAgent: string;
}): React.ReactElement {
  if (isRunning) {
    const agent = currentAgent && currentAgent !== "idle" ? currentAgent : "agent";
    return (
      <Text>
        <Text color={RELAY_ACCENT}>{spinnerFrame} </Text>
        <Text color={RELAY_ACCENT} bold>{agent}</Text>
        <Text dimColor> working…</Text>
        <Text dimColor>   esc to interrupt</Text>
      </Text>
    );
  }
  if (!ready) {
    return (
      <Text>
        <Text dimColor>{disabledMessage}</Text>
        {input ? (
          <>
            <Text dimColor>  </Text>
            <Text color={RELAY_ACCENT}>{"> "}</Text>
            <Text>{visibleInput}</Text>
          </>
        ) : null}
      </Text>
    );
  }
  return (
    <Text>
      <Text color={RELAY_ACCENT}>{"> "}</Text>
      {visibleInput
        ? <Text>{visibleInput}</Text>
        : <Text dimColor>type {AGENT_MENTION_HINT} and a task…</Text>}
    </Text>
  );
}

function PromptHintText({
  isRunning,
  ready,
  showShortcutMenu,
}: {
  isRunning: boolean;
  ready: boolean;
  showShortcutMenu: boolean;
}): React.ReactElement {
  if (isRunning) return <Text dimColor>Esc to Interrupt</Text>;
  if (!ready) return <Text dimColor>Esc to Exit</Text>;
  if (showShortcutMenu) return <Text dimColor>Enter Accept · Tab/←→ Choose · Esc Hide</Text>;
  return <Text dimColor>Enter Send · Tab Shortcuts · Esc Exit</Text>;
}

function formatAssignmentLabel(assignment: ParsedAssignment): string {
  return assignment.mode === "review" ? `${assignment.agent}:review` : assignment.agent;
}

function formatAssignmentsLabel(assignments: ParsedAssignment[]): string {
  if (assignments.length === 0) return "none";
  return assignments.map((assignment) => `@${formatAssignmentLabel(assignment)}`).join(" ");
}

export async function runInteractiveTui(): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      try {
        instance.unmount();
      } catch {
        // already unmounted
      }
      resolve();
    };
    const instance = render(<RelayTuiHost onExit={finish} />, {
      alternateScreen: false,
      exitOnCtrlC: true,
    });
    instance.waitUntilExit().then(finish, finish);
  });
}

export function RelayTuiHost({ onExit }: { onExit: () => void }): React.ReactElement {
  const [sandbox, setSandbox] = useState<SandboxRecord | undefined>();
  const [runner, setRunner] = useState<AssignmentRunner | undefined>();
  const [remoteSessionControl, setRemoteSessionControl] = useState<RemoteSessionControl | undefined>();
  const [bootError, setBootError] = useState("");
  const [bootLogLines, setBootLogLines] = useState<string[]>([]);
  const mountedRef = useRef(true);
  const workspacePath = useMemo(() => hostWorkspacePath(), []);

  const appendBootLog = (text: string): void => {
    if (!mountedRef.current) return;
    setBootLogLines((lines) => pushLines(lines, text));
  };

  useEffect(() => {
    const employeeId = process.env.RELAY_EMPLOYEE_ID || process.env.USER || "local";
    const explicitSandboxId = envValue("RELAY_SANDBOX_ID") ?? envValue("SANDBOX_ID");
    let cancelled = false;
    const waitForReadySandbox = async (): Promise<void> => {
      const discoveryClient = new RelayDaemonClient();
      const liveNode = await discoverLiveDaemonNode(discoveryClient, employeeId, workspacePath, explicitSandboxId);
      // Share the daemon-node token contract: a live daemon node wins, explicit
      // env token is the fallback, otherwise use the local per-employee token
      // file for a node that has not registered yet.
      const explicitNodeToken = process.env.RELAY_DAEMON_TOKEN ?? process.env.RELAY_DAEMON_NODE_TOKEN;
      const nodeToken = liveNode?.nodeToken ?? ensureDaemonNodeToken({
        workspacePath,
        employeeId,
        token: explicitNodeToken,
      }).token;
      const uiToken = ensureDaemonNodeToken({
        workspacePath,
        employeeId: `${employeeId}.ui`,
        token: process.env.RELAY_DAEMON_UI_TOKEN ?? liveNode?.nodeToken ?? explicitNodeToken,
      }).token;
      const client = new RelayDaemonClient({
        token: uiToken,
        nodeToken,
      });
      const provisionInput = { employeeId, workspacePath, ...(explicitSandboxId ? { sandboxId: explicitSandboxId } : {}) };
      let current = await client.provisionSandbox(provisionInput);
      let lastWaitingStatus = "";
      while (!cancelled && current.status !== "ready") {
        if (mountedRef.current) {
          setSandbox(current);
        }
        const waitingStatus = `${current.id}:${current.status}:${current.lastError ?? ""}`;
        if (waitingStatus !== lastWaitingStatus) {
          lastWaitingStatus = waitingStatus;
	          appendBootLog(
            `\nINFO Waiting for daemon node ${current.id} (${current.status}). ${current.lastError ?? "Start the sandbox worker."}\n` +
              `Run: \`make daemon EMPLOYEE_ID=${employeeId} SANDBOX_ID=${current.id} DAEMON_TOKEN=${nodeToken} WORKSPACE=${shellQuote(workspacePath)}\`\n`,
	          );
        }
        await delay(DAEMON_POLL_INTERVAL_MS);
        // Re-run employee selection while waiting so a stale placeholder does
        // not pin the TUI to an old sandbox id after a live node registers.
        current = await client.provisionSandbox(provisionInput);
      }
      if (cancelled || !mountedRef.current) return;
      setSandbox(current);
      setRunner(() => createDaemonAssignmentRunner(client, current.id));
      setRemoteSessionControl({
        listSessions: () => client.listSessions(),
        getSession: (sessionId) => client.getSession(sessionId),
        renameSession: (sessionId, title) => client.renameSession(sessionId, title),
        recordDecision: (input) => client.recordDecision(input),
        recordHandoff: (input) => client.recordHandoff(input),
      });
      const workspaceNote = current.workspacePath && !workspacePathsMatch(current.workspacePath, workspacePath)
        ? ` Workspace matched daemon node at ${current.workspacePath}.`
        : "";
      appendBootLog(`\nOK  Host daemon ready. Sandbox ${current.id} assigned to ${current.employeeId}.${workspaceNote}\n`);
    };
    void waitForReadySandbox().catch((error: unknown) => {
      if (!mountedRef.current || cancelled) return;
      const detail = error instanceof Error ? error.message : String(error);
      setBootError(detail);
      appendBootLog(`\nERR  ${detail}\nStart the Relay backend with: backend --port 8790\n`);
    });
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [workspacePath]);

  const ready = Boolean(sandbox && runner && sandbox.status === "ready") && !bootError;
  const disabledMessage = bootError
    ? "Daemon unavailable. Press Esc to exit."
    : sandbox && sandbox.status !== "ready"
      ? `Waiting for daemon node (${sandbox.status})...`
      : "Connecting to Relay daemon...";
  return (
    <RelayTui
      workspacePath={sandbox?.workspacePath ?? workspacePath}
      runner={runner}
      ready={ready}
      disabledMessage={disabledMessage}
      bootLogLines={bootLogLines}
      localSessionControl={false}
      remoteSessionControl={remoteSessionControl}
      onExit={() => {
        onExit();
      }}
    />
  );
}

async function discoverLiveDaemonNode(
  client: RelayDaemonClient,
  employeeId: string,
  workspacePath: string,
  sandboxId?: string,
): Promise<ControlPanelDaemonNodeRecord | undefined> {
  try {
    const nodes = await client.listControlPanelDaemonNodes();
    return nodes
      .filter((node) =>
        (sandboxId ? node.id === sandboxId : node.employeeId === employeeId) &&
        node.online !== false &&
        node.stale !== true &&
        Boolean(node.nodeToken) &&
        (sandboxId || !node.workspacePath || workspacePathsMatch(node.workspacePath, workspacePath))
      )
      .sort((a, b) => daemonNodeRank(a) - daemonNodeRank(b) || (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? ""))[0];
  } catch {
    return undefined;
  }
}

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function daemonNodeRank(node: ControlPanelDaemonNodeRecord): number {
  if (node.status === "ready") return 0;
  if (node.status === "running") return 1;
  return 2;
}

function workspacePathsMatch(a?: string, b?: string): boolean {
  const left = normalizeWorkspacePath(a);
  const right = normalizeWorkspacePath(b);
  return Boolean(left && right && left === right);
}

function normalizeWorkspacePath(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? resolve(trimmed) : undefined;
}
