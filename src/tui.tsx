import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, render, Text, useApp, useInput } from "ink";

import {
  type AgentName,
  type AgentOutputSink,
  type AgentState,
  type CodexTaskMode,
  type OrchestratorSession,
  GUEST_WORKSPACE,
  codexImplementNode,
  codexReviewNode,
  ensureAgentReady,
  initialAgentState,
  mergeAgentState,
  piImplementNode,
  claudeImplementNode,
  withOrchestratorSession,
} from "./orchestrator.js";

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
  signal?: AbortSignal;
}

export type AssignmentRunner = (request: RunRequest) => Promise<void>;

const leadingMentionPattern = /^@(claude|pi|codex)\b/i;
const MAX_LOG_LINES = 200;
const VISIBLE_LOG_LINES = 18;

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

export function taskNeedsCodexMode(parsed: ParsedTask): boolean {
  return parsed.assignments.some((assignment) => assignment.agent === "codex");
}

export function validateParsedTask(parsed: ParsedTask): string | null {
  if (!parsed.task) return "Enter a task after the @mentions.";
  if (parsed.assignments.length === 0) return "Assign the task with @claude, @pi, or @codex.";
  return null;
}

export async function runAssignments(request: RunRequest): Promise<void> {
  if (request.assignments.length === 0) {
    throw new Error("Assign the task with @claude, @pi, or @codex.");
  }
  let state = initialAgentState(request.task);
  for (const assignment of request.assignments) {
    if (request.signal?.aborted) {
      request.log("\nCancelled before next agent started.\n");
      return;
    }
    const mode = assignment.agent === "codex" ? assignment.codexMode ?? "implement" : "implement";
    request.onAgentStart?.(assignment);
    await ensureAgentReady(assignment.agent, request.log, request.signal);
    state = await runAssignedAgent(state, assignment.agent, mode, request.log, request.signal);
    if (request.signal?.aborted) {
      request.log("\nCancelled current agent.\n");
      return;
    }
  }
}

async function runAssignedAgent(
  state: AgentState,
  agent: AgentName,
  mode: CodexTaskMode,
  sink: AgentOutputSink,
  signal?: AbortSignal,
): Promise<AgentState> {
  if (agent === "claude") {
    return mergeAgentState(state, await claudeImplementNode(state, { sink, signal }));
  }
  if (agent === "pi") {
    return mergeAgentState(state, await piImplementNode(state, { sink, signal }));
  }
  if (mode === "review") {
    return mergeAgentState(state, await codexReviewNode(state, { sink, signal }));
  }
  return mergeAgentState(state, await codexImplementNode(state, { sink, signal }));
}

export interface RelayTuiProps {
  session?: OrchestratorSession;
  onExit?: () => void;
  runner?: AssignmentRunner;
  ready?: boolean;
  disabledMessage?: string;
  bootLogLines?: string[];
}

type PendingCodexChoice = {
  parsed: ParsedTask;
  codexIndex: number;
  selected: CodexTaskMode;
};

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
}: RelayTuiProps): React.ReactElement {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [logLines, setLogLines] = useState<string[]>([
    "Ready. Type @claude, @pi, or @codex followed by a task.",
  ]);
  const [currentAgent, setCurrentAgent] = useState("idle");
  const [isRunning, setIsRunning] = useState(false);
  const [pendingCodex, setPendingCodex] = useState<PendingCodexChoice | null>(null);
  const [message, setMessage] = useState("");

  const runnerRef = useRef(runner);
  runnerRef.current = runner;
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => {
    mountedRef.current = false;
    abortRef.current?.abort();
  }, []);

  const visibleLogs = useMemo(() => [...bootLogLines, ...logLines].slice(-VISIBLE_LOG_LINES), [bootLogLines, logLines]);
  const queueLabel = !ready ? "booting" : isRunning ? "running" : pendingCodex ? "awaiting Codex mode" : "ready";
  const workspace = session?.hostWorkspace ?? "(test workspace)";
  const inputWidth = Math.max(20, (process.stdout.columns ?? 80) - 6);
  const visibleInput = input.length <= inputWidth ? input : `…${input.slice(input.length - inputWidth + 1)}`;

  const appendLog = (text: string): void => {
    if (!text || !mountedRef.current) return;
    setLogLines((lines) => pushLines(lines, text));
  };

  const executeParsedTask = (parsed: ParsedTask): void => {
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);
    setCurrentAgent("starting");
    setMessage("");
    void runnerRef.current({
      assignments: parsed.assignments,
      task: parsed.task,
      log: appendLog,
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
        const nextCodexIndex = assignments.findIndex(
          (assignment, index) => index > choice.codexIndex && assignment.agent === "codex" && !assignment.codexMode,
        );
        const parsed = { ...choice.parsed, assignments };
        if (nextCodexIndex >= 0) {
          setPendingCodex({ parsed, codexIndex: nextCodexIndex, selected: "implement" });
        } else {
          setPendingCodex(null);
          executeParsedTask(parsed);
        }
        return;
      }
      return;
    }
    if (isRunning) return;
    if (key.return) {
      if (!ready) {
        setMessage(disabledMessage);
        return;
      }
      const parsed = parseAssignedTask(input);
      const error = validateParsedTask(parsed);
      if (error) {
        setMessage(error);
        return;
      }
      setInput("");
      const codexIndex = parsed.assignments.findIndex((assignment) => assignment.agent === "codex");
      if (codexIndex >= 0) {
        setPendingCodex({ parsed, codexIndex, selected: "implement" });
      } else {
        executeParsedTask(parsed);
      }
      return;
    }
    if (key.backspace || key.delete) {
      setInput((value) => value.slice(0, -1));
      if (message) setMessage("");
      return;
    }
    if (typed && !key.ctrl && !key.meta) {
      setInput((value) => `${value}${typed}`);
      if (message) setMessage("");
    }
  });

  return (
    <Box flexDirection="column" height="100%" paddingX={1}>
      <Box flexDirection="column">
        <Text color="cyan" bold>== Relay ======================================================</Text>
        <Text><Text color="cyan" bold>INFO</Text> workspace {workspace}</Text>
        <Text><Text color="cyan" bold>INFO</Text> mount {GUEST_WORKSPACE}</Text>
        <Text><Text color={isRunning ? "yellow" : "green"} bold>{isRunning ? "RUN" : ready ? "OK" : "INFO"}</Text> agent {currentAgent} | queue {queueLabel}</Text>
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
            <Text inverse={pendingCodex.selected === "review"}>review</Text> for #{pendingCodex.codexIndex + 1} Enter to run
          </Text>
        </Box>
      ) : (
        <Box borderStyle="single" borderColor={!ready || message ? "yellow" : "green"} paddingX={1}>
          <Text>{isRunning ? "Running... (Esc to cancel)" : ready ? `> ${visibleInput}` : input ? `${disabledMessage}  > ${visibleInput}` : disabledMessage}</Text>
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
