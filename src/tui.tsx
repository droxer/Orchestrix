import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, render, Text, useApp, useInput } from "ink";

import {
  type AgentName,
  type CodexTaskMode,
  type RelaySession,
  type SessionController,
  type SessionStore,
  type OrchestratorSession,
  GUEST_WORKSPACE,
  LocalSessionStore,
  SessionController as RelaySessionController,
  assignmentFailureOutcome,
  assignmentSucceeded,
  ensureAgentReady,
  initialAgentState,
  withOrchestratorSession,
} from "./relay.js";

export interface ParsedAssignment {
  agent: AgentName;
  codexMode?: CodexTaskMode;
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

const leadingMentionPattern = /^@(claude|pi|codex)\b/i;
const MAX_LOG_LINES = 200;
const VISIBLE_LOG_LINES = 18;
const AGENT_SHORTCUTS = ["@claude", "@pi", "@codex"] as const;
const COMMAND_SHORTCUTS = ["/approve", "/reject", "/cancel", "/rerun", "/handoff", "/sessions", "/open", "/summary", "/quit"] as const;
const RELAY_ACCENT = "#D97757";
const RELAY_DIM = "gray";
const RELAY_OK = "green";
const RELAY_WARN = "yellow";
const BRAND_MARK = "✻";
const SPINNER_FRAMES = ["·", "✢", "*", "✳", "✶", "✻", "✽"] as const;
const MARKDOWN_RULE = "------------------------------------------------------------";

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
  if (parsed.assignments.length === 0) return "Assign the task with @claude, @pi, or @codex.";
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
    throw new Error("Assign the task with @claude, @pi, or @codex.");
  }
  const controller = request.controller ?? new RelaySessionController(undefined, {
    workspacePath: request.workspacePath,
    sink: request.log,
    signal: request.signal,
    onUpdate: request.onSessionUpdate,
  });
  const sessionId = request.sessionId ?? controller.createSession(request.task).id;
  let state = initialAgentState(request.task);
  let terminalRecorded = false;
  const failCancelled = (outcome: string): void => {
    if (terminalRecorded) return;
    controller.failSession(sessionId, outcome);
    terminalRecorded = true;
  };
  try {
    for (const assignment of request.assignments) {
      if (request.signal?.aborted) {
        request.log("\nCancelled before next agent started.\n");
        failCancelled("Task cancelled before the next agent started.");
        return;
      }
      const mode = assignment.agent === "codex" ? assignment.codexMode ?? "implement" : "implement";
      request.onAgentStart?.(assignment);
      await ensureAgentReady(assignment.agent, request.log, request.signal);
      state = await controller.runStep(sessionId, state, { agent: assignment.agent, mode }, {
        sink: request.log,
        signal: request.signal,
      });
      if (!assignmentSucceeded({ agent: assignment.agent, mode }, state)) {
        const outcome = assignmentFailureOutcome({ agent: assignment.agent, mode }, state);
        controller.failSession(sessionId, outcome);
        terminalRecorded = true;
        request.log(`\n${outcome}\n`);
        return;
      }
      if (request.signal?.aborted) {
        request.log("\nCancelled current agent.\n");
        failCancelled("Task cancelled during agent execution.");
        return;
      }
    }
  } catch (error: unknown) {
    if (request.signal?.aborted) {
      request.log("\nCancelled current agent.\n");
      failCancelled("Task cancelled during agent execution.");
      return;
    }
    throw error;
  }
  terminalRecorded = true;
  controller.completeSession(sessionId, "Assignments completed.");
}

export interface RelayTuiProps {
  session?: OrchestratorSession;
  onExit?: () => void;
  runner?: AssignmentRunner;
  ready?: boolean;
  disabledMessage?: string;
  bootLogLines?: string[];
  sessionStore?: SessionStore;
}

function splitToLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function pushLines(existing: string[], text: string): string[] {
  if (!text) return existing;
  const incoming = splitToLines(text);
  const merged = existing.length === 0
    ? incoming
    : [...existing.slice(0, -1), `${existing[existing.length - 1]}${incoming[0]}`, ...incoming.slice(1)];
  return merged.length > MAX_LOG_LINES ? merged.slice(merged.length - MAX_LOG_LINES) : merged;
}

export function RelayTui({
  session,
  onExit,
  runner = runAssignments,
  ready = true,
  disabledMessage = "Starting Relay...",
  bootLogLines = [],
  sessionStore = new LocalSessionStore(),
}: RelayTuiProps): React.ReactElement {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [logLines, setLogLines] = useState<string[]>([
    "Ready. Type @claude, @pi, or @codex followed by a task.",
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

  const visibleLogs = useMemo(() => [...bootLogLines, ...logLines].slice(-VISIBLE_LOG_LINES), [bootLogLines, logLines]);
  const queueLabel = !ready ? "booting" : isRunning ? "running" : "ready";
  const workspace = session?.hostWorkspace ?? "(test workspace)";
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
    const controller = new RelaySessionController(sessionStore, {
      workspacePath: session?.hostWorkspace ?? workspace,
      onUpdate: setActiveSession,
    });
    controllerRef.current = controller;
    const created = controller.createSession(parsed.task, ["human", ...parsed.assignments.map((assignment) => assignment.agent)]);
    setActiveSession(created);
    setDefaultAssignments(parsed.assignments.map((assignment) => ({ ...assignment })));
    executeParsedTask(parsed, created.id);
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
      workspacePath: session?.hostWorkspace,
      onSessionUpdate: setActiveSession,
      onAgentStart: (assignment) => {
        if (!mountedRef.current) return;
        setCurrentAgent(formatAssignmentLabel(assignment));
      },
      signal: controller.signal,
    })
      .then(() => {
        if (!mountedRef.current) return;
        const finished = controller.signal.aborted ? "Task cancelled." : "Task finished.";
        appendLog(`\n${finished}\n`);
        setMessage(finished);
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) return;
        const detail = error instanceof Error ? error.message : String(error);
        appendLog(`\nERR  ${detail}\n`);
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
          appendLog("\nCancellation requested; stopping current agent.\n");
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
      const sessions = sessionStore.listSessions().slice(0, 6);
      appendLog(`\n${sessions.map((item) => `${item.id}  ${item.status}  ${item.taskGoal}`).join("\n") || "No sessions yet."}\n`);
      setMessage("Listed recent sessions.");
      return;
    }
    if (name === "/open") {
      if (!detail) {
        setMessage("Usage: /open <session-id>");
        return;
      }
      try {
        const opened = sessionStore.getSession(detail);
        setActiveSession(opened);
        setMessage(`Opened ${opened.id}.`);
      } catch (error: unknown) {
        const fallback = `Unknown Relay session ${detail}.`;
        setMessage(error instanceof Error ? error.message : fallback);
      }
      return;
    }
    if (name === "/summary") {
      if (!current) {
        setMessage("No active session.");
        return;
      }
      appendLog(`\nSession ${current.id}\n${current.status} ${current.phase}\n${current.agentRuns.length} runs, ${current.artifacts.length} artifacts\n${current.finalOutcome ?? current.taskGoal}\n`);
      setMessage("Summary appended.");
      return;
    }
    if (name === "/approve") {
      setMessage("Approval is not required; prompts run immediately.");
      return;
    }
    if (name === "/reject") {
      if (!current) {
        setMessage("No active session.");
        return;
      }
      setActiveSession(controllerRef.current.recordDecision(current.id, "reject", detail || "Rejected by human."));
      setMessage("Feedback recorded.");
      return;
    }
    if (name === "/cancel") {
      abortRef.current?.abort();
      if (current) setActiveSession(controllerRef.current.recordDecision(current.id, "cancel", "Cancelled by human."));
      setMessage("Cancellation requested.");
      return;
    }
    if (name === "/rerun") {
      const agent = detail as AgentName;
      if (!current || !["claude", "pi", "codex"].includes(agent)) {
        setMessage("Usage: /rerun <claude|pi|codex>");
        return;
      }
      setActiveSession(controllerRef.current.recordDecision(current.id, "rerun", "Rerun requested.", agent));
      executeParsedTask({ assignments: [{ agent }], task: current.taskGoal }, current.id);
      return;
    }
    if (name === "/handoff") {
      const [agentText, ...noteParts] = rest;
      const agent = agentText as AgentName;
      if (!current || !["claude", "pi", "codex"].includes(agent)) {
        setMessage("Usage: /handoff <claude|pi|codex> [note]");
        return;
      }
      const note = noteParts.join(" ").trim();
      const assignment = { agent, codexMode: agent === "codex" ? "review" as const : undefined };
      const defaultAssignment = { agent };
      const task = note ? `${current.taskGoal}\n\nHandoff note:\n${note}` : current.taskGoal;
      setActiveSession(controllerRef.current.recordDecision(current.id, "handoff", note || `Handoff to ${agent}.`, agent));
      setCurrentAgent(formatAssignmentLabel(assignment));
      setDefaultAssignments([defaultAssignment]);
      executeParsedTask({ assignments: [assignment], task }, current.id);
      return;
    }
    setMessage(`Unknown command: ${name}`);
  };

  const statusTone = statusColor(queueLabel);
  const statusMark = queueLabel === "running" || queueLabel === "booting" ? spinnerFrame : statusGlyphMark(queueLabel);

  return (
    <Box flexDirection="column" height="100%" paddingX={1} paddingY={1}>
      <Box borderStyle="round" borderColor={RELAY_DIM} paddingX={1} flexDirection="column">
        <Box>
          <Text color={RELAY_ACCENT} bold>{BRAND_MARK} Relay</Text>
          <Text dimColor>  agent orchestration</Text>
        </Box>
        <Text>
          <Text dimColor>cwd </Text>
          <Text>{workspace}</Text>
          <Text dimColor>   mount </Text>
          <Text>{GUEST_WORKSPACE}</Text>
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} paddingX={1} marginTop={1}>
        {renderMarkdownTranscript(visibleLogs)}
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
          <Text color={statusTone}>{statusMark}</Text>
          <Text dimColor> {queueLabel}</Text>
          <Text dimColor> · {currentAgent}</Text>
          {defaultAssignments.length > 0 ? (
            <Text dimColor> · {defaultAssignmentLabel}</Text>
          ) : null}
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

function renderMarkdownTranscript(lines: string[]): React.ReactElement[] {
  let inCodeBlock = false;
  return lines.map((line, index) => {
    const key = `log-${index}`;
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      const language = line.replace(/^\s*```/, "").trim();
      return (
        <Text key={key} dimColor>
          {language ? `code ${language}` : "code"}
        </Text>
      );
    }
    return renderMarkdownLine(line, key, inCodeBlock);
  });
}

function renderMarkdownLine(line: string, key: string, inCodeBlock: boolean): React.ReactElement {
  if (line.length === 0) return <Text key={key}> </Text>;
  if (inCodeBlock) {
    return (
      <Text key={key} color="green">
        <Text dimColor>| </Text>
        {line}
      </Text>
    );
  }

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
        {MARKDOWN_RULE}
      </Text>
    );
  }

  const blockquote = /^\s*>\s?(.*)$/.exec(line);
  if (blockquote) {
    return (
      <Text key={key}>
        <Text color={RELAY_ACCENT} dimColor>| </Text>
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
        <Text key={key} color="yellow">
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
  if (queueLabel === "ready") return RELAY_ACCENT;
  if (queueLabel === "booting") return RELAY_ACCENT;
  if (queueLabel === "running") return RELAY_ACCENT;
  return RELAY_WARN;
}

function statusGlyphMark(_queueLabel: string): string {
  return BRAND_MARK;
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
    return (
      <Text>
        <Text color={RELAY_ACCENT}>{spinnerFrame}</Text>
        <Text> {currentAgent}…</Text>
        <Text dimColor>  (esc to interrupt)</Text>
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
            <Text dimColor>{"> "}</Text>
            <Text>{visibleInput}</Text>
          </>
        ) : null}
      </Text>
    );
  }
  return (
    <Text>
      <Text dimColor>{"> "}</Text>
      <Text>{visibleInput}</Text>
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
  if (isRunning) return <Text dimColor>esc to interrupt</Text>;
  if (!ready) return <Text dimColor>esc to exit</Text>;
  if (showShortcutMenu) return <Text dimColor>enter accept · tab/←→ choose · esc hide</Text>;
  return <Text dimColor>enter send · tab shortcuts · esc exit</Text>;
}

function formatAssignmentLabel(assignment: ParsedAssignment): string {
  return assignment.agent;
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

function RelayTuiHost({ onExit }: { onExit: () => void }): React.ReactElement {
  const [session, setSession] = useState<OrchestratorSession | undefined>();
  const [bootError, setBootError] = useState("");
  const [bootLogLines, setBootLogLines] = useState<string[]>([]);
  const releaseSessionRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);

  const appendBootLog = (text: string): void => {
    if (!mountedRef.current) return;
    setBootLogLines((lines) => pushLines(lines, text));
  };

  useEffect(() => {
    void withOrchestratorSession(async (readySession) => {
      if (!mountedRef.current) return;
      setSession(readySession);
      appendBootLog("\nOK  VM ready. Assign a task with @claude, @pi, or @codex.\n");
      await new Promise<void>((resolve) => {
        releaseSessionRef.current = resolve;
      });
    }, appendBootLog).catch((error: unknown) => {
      if (!mountedRef.current) return;
      const detail = error instanceof Error ? error.message : String(error);
      setBootError(detail);
      appendBootLog(`\nERR  ${detail}\n`);
    });
    return () => {
      mountedRef.current = false;
      releaseSessionRef.current?.();
    };
  }, []);

  const ready = Boolean(session) && !bootError;
  const disabledMessage = bootError ? "Startup failed. Press Esc to exit." : "Starting Relay...";
  return (
    <RelayTui
      session={session}
      ready={ready}
      disabledMessage={disabledMessage}
      bootLogLines={bootLogLines}
      onExit={() => {
        releaseSessionRef.current?.();
        onExit();
      }}
    />
  );
}
