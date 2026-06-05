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

type PendingCodexChoice = {
  parsed: ParsedTask;
  codexIndex: number;
  selected: CodexTaskMode;
};

const leadingMentionPattern = /^@(claude|pi|codex)\b/i;
const MAX_LOG_LINES = 200;
const VISIBLE_LOG_LINES = 18;
const AGENT_SHORTCUTS = ["@claude", "@pi", "@codex"] as const;
const COMMAND_SHORTCUTS = ["/approve", "/reject", "/cancel", "/rerun", "/handoff", "/sessions", "/open", "/summary"] as const;

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
  const [pendingCodex, setPendingCodex] = useState<PendingCodexChoice | null>(null);
  const [pendingStart, setPendingStart] = useState<ParsedTask | null>(null);
  const [activeSession, setActiveSession] = useState<RelaySession | null>(null);
  const [message, setMessage] = useState("");
  const [shortcutIndex, setShortcutIndex] = useState(0);
  const [hiddenShortcutToken, setHiddenShortcutToken] = useState("");

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
  const queueLabel = !ready ? "booting" : isRunning ? "running" : pendingCodex ? "awaiting Codex mode" : pendingStart ? "awaiting approval" : "ready";
  const workspace = session?.hostWorkspace ?? "(test workspace)";
  const inputWidth = Math.max(20, (process.stdout.columns ?? 80) - 6);
  const visibleInput = input.length <= inputWidth ? input : `…${input.slice(input.length - inputWidth + 1)}`;
  const shortcutMenu = shortcutSuggestions(input);
  const showShortcutMenu = Boolean(shortcutMenu && input !== hiddenShortcutToken);
  const selectedShortcutIndex = shortcutMenu ? Math.min(shortcutIndex, shortcutMenu.candidates.length - 1) : 0;

  const appendLog = (text: string): void => {
    if (!text || !mountedRef.current) return;
    setLogLines((lines) => pushLines(lines, text));
  };

  const createPendingSession = (parsed: ParsedTask): void => {
    const controller = new RelaySessionController(sessionStore, {
      workspacePath: session?.hostWorkspace ?? workspace,
      onUpdate: setActiveSession,
    });
    controllerRef.current = controller;
    const created = controller.createSession(parsed.task, ["human", ...parsed.assignments.map((assignment) => assignment.agent)], true);
    setActiveSession(created);
    setPendingStart(parsed);
    setMessage(`Session ${created.id} is waiting for /approve.`);
  };

  const startWithCodexModeSelection = (parsed: ParsedTask): void => {
    const codexIndex = parsed.assignments.findIndex((assignment) => assignment.agent === "codex" && !assignment.codexMode);
    if (codexIndex >= 0) {
      setPendingCodex({ parsed, codexIndex, selected: "implement" });
      setMessage("");
      return;
    }
    createPendingSession(parsed);
  };

  const executeParsedTask = (parsed: ParsedTask, sessionId?: string): void => {
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);
    setCurrentAgent("starting");
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
        setCurrentAgent("idle");
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
      if (pendingCodex) {
        setPendingCodex(null);
        setMessage("Codex mode selection cancelled.");
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
    if (pendingCodex) {
      if (typed === "i" || typed === "r") {
        setPendingCodex((pending) =>
          pending
            ? {
                ...pending,
                selected: typed === "i" ? "implement" : "review",
              }
            : pending,
        );
        return;
      }
      if (key.leftArrow || key.rightArrow) {
        setPendingCodex((pending) =>
          pending
            ? {
                ...pending,
                selected: pending.selected === "implement" ? "review" : "implement",
              }
            : pending,
        );
        return;
      }
      if (key.return) {
        const choice = pendingCodex;
        const assignments = choice.parsed.assignments.map((assignment, index) =>
          index === choice.codexIndex ? { ...assignment, codexMode: choice.selected } : assignment,
        );
        const parsed = { ...choice.parsed, assignments };
        const nextCodexIndex = assignments.findIndex(
          (assignment, index) => index > choice.codexIndex && assignment.agent === "codex" && !assignment.codexMode,
        );
        if (nextCodexIndex >= 0) {
          setPendingCodex({ parsed, codexIndex: nextCodexIndex, selected: "implement" });
        } else {
          setPendingCodex(null);
          createPendingSession(parsed);
        }
        return;
      }
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
    if ((key.upArrow || key.downArrow) && shortcutMenu) {
      const direction = key.upArrow ? -1 : 1;
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
      const parsed = parseAssignedTask(input);
      const error = validateParsedTask(parsed);
      if (error) {
        setMessage(error);
        return;
      }
      setInput("");
      startWithCodexModeSelection(parsed);
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
      if (!current || !pendingStart) {
        setMessage("No pending session to approve.");
        return;
      }
      controllerRef.current.recordDecision(current.id, "approve");
      const parsed = pendingStart;
      setPendingStart(null);
      executeParsedTask(parsed, current.id);
      return;
    }
    if (name === "/reject") {
      if (!current) {
        setMessage("No active session.");
        return;
      }
      setActiveSession(controllerRef.current.recordDecision(current.id, "reject", detail || "Rejected by human."));
      setPendingStart(null);
      setMessage("Feedback recorded.");
      return;
    }
    if (name === "/cancel") {
      abortRef.current?.abort();
      if (current) setActiveSession(controllerRef.current.recordDecision(current.id, "cancel", "Cancelled by human."));
      setPendingStart(null);
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
      const task = note ? `${current.taskGoal}\n\nHandoff note:\n${note}` : current.taskGoal;
      setActiveSession(controllerRef.current.recordDecision(current.id, "handoff", note || "Handoff requested.", agent));
      executeParsedTask({
        assignments: [{ agent, codexMode: agent === "codex" ? "review" : undefined }],
        task,
      }, current.id);
      return;
    }
    setMessage(`Unknown command: ${name}`);
  };

  return (
    <Box flexDirection="column" height="100%" paddingX={1}>
      <Box flexDirection="column">
        <Text color="cyan" bold>== Relay ======================================================</Text>
        <Text><Text color="cyan" bold>INFO</Text> workspace {workspace}</Text>
        <Text><Text color="cyan" bold>INFO</Text> mount {GUEST_WORKSPACE}</Text>
        <Text><Text color={isRunning ? "yellow" : "green"} bold>{isRunning ? "RUN" : ready ? "OK" : "INFO"}</Text> agent {currentAgent} | queue {queueLabel}</Text>
        {activeSession ? (
          <Text><Text color="cyan" bold>SESSION</Text> {activeSession.id} {activeSession.status} {activeSession.phase} | runs {activeSession.agentRuns.length} | artifacts {activeSession.artifacts.length}</Text>
        ) : null}
      </Box>
      <Box marginTop={1} flexDirection="column" flexGrow={1}>
        {visibleLogs.map((line, index) => (
          <Text key={index}>{line.length > 0 ? line : " "}</Text>
        ))}
      </Box>
      {pendingCodex ? (
        <Box borderStyle="single" borderColor="yellow" paddingX={1}>
          <Text>
            Codex mode:{" "}
            <Text inverse={pendingCodex.selected === "implement"}>implement</Text>{" "}
            <Text inverse={pendingCodex.selected === "review"}>review</Text> for #{pendingCodex.codexIndex + 1} Enter to continue
          </Text>
        </Box>
      ) : (
        <Box borderStyle="single" borderColor={!ready || message ? "yellow" : showShortcutMenu ? "cyan" : "green"} paddingX={1} flexDirection="column">
          <Text>{isRunning ? "Running... (Esc to cancel)" : pendingStart ? `Pending approval (/approve, /reject, /cancel)  > ${visibleInput}` : ready ? `> ${visibleInput}` : input ? `${disabledMessage}  > ${visibleInput}` : disabledMessage}</Text>
          {showShortcutMenu && shortcutMenu ? (
            <Text>
              {shortcutMenu.candidates.map((candidate, index) => (
                <Text key={candidate} inverse={index === selectedShortcutIndex}> {candidate} </Text>
              ))}
            </Text>
          ) : null}
        </Box>
      )}
      {message ? <Text color="yellow">{message}</Text> : null}
    </Box>
  );
}

function formatAssignmentLabel(assignment: ParsedAssignment): string {
  return assignment.agent === "codex" ? `codex:${assignment.codexMode ?? "implement"}` : assignment.agent;
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
      alternateScreen: true,
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
