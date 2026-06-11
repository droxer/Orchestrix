"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  Bot,
  Check,
  CircleStop,
  CornerDownLeft,
  GitBranch,
  KeyRound,
  MessageCircle,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Settings,
  UserRound,
  X,
} from "lucide-react";

import {
  cancelRun,
  listDaemonNodes,
  listSandboxes,
  listSessions,
  provisionSandbox,
  recordDecision,
  recordHandoff,
  runSandbox,
} from "./api";
import type {
  AgentName,
  CodexTaskMode,
  DaemonNodeMonitorRecord,
  RelaySession,
  SandboxRecord,
  Tone,
} from "./types";
import { Badge } from "@/components/ui/badge";
import { AgentStream } from "./components/AgentStream";

const quickUsers = ["alice", "bob", "carol"];
const agents: AgentName[] = ["claude", "pi", "codex"];
const modes: CodexTaskMode[] = ["implement", "review"];
const tokenStorageKey = "relay-web.tokens";
const selectedEmployeeKey = "relay-web.selectedEmployee";

const agentDescriptors: Record<AgentName, { tone: string; role: string; blurb: string }> = {
  claude: { tone: "claude", role: "Builder",  blurb: "Turns requests into implementation work with methodical context." },
  pi:     { tone: "pi",     role: "Planner",  blurb: "Explores trade-offs and shapes the next reliable step." },
  codex:  { tone: "codex",  role: "Reviewer", blurb: "Reads diffs, checks behavior, and calls out risks." },
};

type TokenMap = Record<string, string>;
type MobileView = "threads" | "chat";

type DerivedMessage =
  | {
      kind: "user";
      id: string;
      timestamp: string;
      text: string;
    }
  | {
      kind: "agent";
      id: string;
      timestamp: string;
      agent: AgentName;
      runId: string;
      streaming: boolean;
      stdout: string;
      stderr: string;
      attachments: RelaySession["artifacts"];
    }
  | {
      kind: "system";
      id: string;
      timestamp: string;
      tone: Tone;
      label: string;
      detail?: string;
    };

/** A continuation block from the same agent renders without avatar/header, Slack-style. */
function isGroupedContinuation(messages: DerivedMessage[], index: number): boolean {
  const message = messages[index];
  if (message.kind !== "agent") return false;
  for (let i = index - 1; i >= 0; i -= 1) {
    const prev = messages[i];
    if (prev.kind === "system") continue;
    return prev.kind === "agent" && prev.agent === message.agent;
  }
  return false;
}

interface EmployeeContact {
  id: string;
  sandbox?: SandboxRecord;
  node?: DaemonNodeMonitorRecord;
  activeRun?: DaemonNodeMonitorRecord["activeRuns"][number];
  sessionCount: number;
  lastSession?: RelaySession;
}

function readTokens(): TokenMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(tokenStorageKey);
    return raw ? (JSON.parse(raw) as TokenMap) : {};
  } catch {
    return {};
  }
}

function writeTokens(tokens: TokenMap): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(tokenStorageKey, JSON.stringify(tokens));
}

export function App() {
  const [sandboxes, setSandboxes] = useState<SandboxRecord[]>([]);
  const [nodes, setNodes] = useState<DaemonNodeMonitorRecord[]>([]);
  const [sessions, setSessions] = useState<RelaySession[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<string>(quickUsers[0]);
  const [customEmployee, setCustomEmployee] = useState("");
  const [tokens, setTokens] = useState<TokenMap>({});
  const [hydrated, setHydrated] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [activeAgent, setActiveAgent] = useState<AgentName>("claude");
  const [modeByAgent, setModeByAgent] = useState<Record<AgentName, CodexTaskMode>>({
    claude: "implement",
    pi: "implement",
    codex: "review",
  });
  const [composerText, setComposerText] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>("chat");
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffAgent, setHandoffAgent] = useState<AgentName>("codex");
  const [handoffMode, setHandoffMode] = useState<CodexTaskMode>("review");
  const [handoffNote, setHandoffNote] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<{ tone: Tone; message: string }>({
    tone: "info",
    message: "Open an employee workspace to begin.",
  });
  const [toastVisible, setToastVisible] = useState(false);
  const statusSeenRef = useRef(false);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    if (!statusSeenRef.current) {
      statusSeenRef.current = true;
      return;
    }
    setToastVisible(true);
    const timer = window.setTimeout(() => setToastVisible(false), 4000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const selectedSandbox = useMemo(
    () => sandboxes.find((sandbox) => sandbox.employeeId === selectedEmployee),
    [sandboxes, selectedEmployee],
  );
  const selectedNode = useMemo(
    () => nodes.find((node) => node.employeeId === selectedEmployee || node.id === selectedSandbox?.id),
    [nodes, selectedEmployee, selectedSandbox?.id],
  );

  const sandboxWorkspace = selectedSandbox?.workspacePath;
  const sandboxSessions = useMemo(
    () => sessions.filter((session) => !sandboxWorkspace || session.workspacePath === sandboxWorkspace),
    [sessions, sandboxWorkspace],
  );
  const threadSessions = useMemo(
    () => sandboxSessions.filter((session) => session.agentRuns.some((run) => run.agent === activeAgent)),
    [sandboxSessions, activeAgent],
  );

  const activeSession = useMemo(() => {
    if (selectedSessionId) {
      const pinned = sessions.find((session) => session.id === selectedSessionId);
      if (pinned) return pinned;
    }
    return threadSessions[0];
  }, [selectedSessionId, sessions, threadSessions]);

  const selectedToken = selectedSandbox ? tokens[selectedSandbox.id] ?? tokens[selectedEmployee] : tokens[selectedEmployee];
  const activeRun = selectedNode?.activeRuns[0];

  const messages = useMemo<DerivedMessage[]>(() => projectMessages(activeSession), [activeSession]);

  const awaitingDecision = useMemo(() => {
    if (!activeSession) return false;
    const events = activeSession.events;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event.type === "human.decision") return false;
      if (event.type === "agent.completed") return true;
      if (event.type === "session.completed" || event.type === "session.failed") return false;
    }
    return false;
  }, [activeSession]);

  const employeeContacts = useMemo<EmployeeContact[]>(() => {
    const byId = new Map<string, EmployeeContact>();

    const ensure = (id: string): EmployeeContact => {
      const key = id.trim();
      const existing = byId.get(key);
      if (existing) return existing;
      const contact: EmployeeContact = { id: key, sessionCount: 0 };
      byId.set(key, contact);
      return contact;
    };

    for (const employeeId of quickUsers) ensure(employeeId);
    ensure(selectedEmployee);

    for (const sandbox of sandboxes) {
      const contact = ensure(sandbox.employeeId);
      contact.sandbox = sandbox;
    }

    for (const node of nodes) {
      const employeeId = node.employeeId ?? sandboxes.find((sandbox) => sandbox.id === node.id)?.employeeId;
      if (!employeeId) continue;
      const contact = ensure(employeeId);
      contact.node = node;
      contact.activeRun = node.activeRuns[0];
    }

    for (const contact of byId.values()) {
      const related = sessions.filter((session) => sessionBelongsToEmployee(session, contact.id, contact.sandbox));
      contact.sessionCount = related.length;
      contact.lastSession = related[0];
    }

    return [...byId.values()].sort((a, b) => {
      if (a.id === selectedEmployee) return -1;
      if (b.id === selectedEmployee) return 1;
      if (a.activeRun && !b.activeRun) return -1;
      if (b.activeRun && !a.activeRun) return 1;
      const aQuick = quickUsers.indexOf(a.id);
      const bQuick = quickUsers.indexOf(b.id);
      if (aQuick !== -1 || bQuick !== -1) return (aQuick === -1 ? 99 : aQuick) - (bQuick === -1 ? 99 : bQuick);
      return a.id.localeCompare(b.id);
    });
  }, [nodes, sandboxes, selectedEmployee, sessions]);

  const filteredEmployees = useMemo(() => {
    const query = employeeQuery.trim().toLowerCase();
    if (!query) return employeeContacts;
    return employeeContacts.filter((contact) => {
      const lastGoal = contact.lastSession?.taskGoal.toLowerCase() ?? "";
      return contact.id.toLowerCase().includes(query) || lastGoal.includes(query);
    });
  }, [employeeContacts, employeeQuery]);

  const employeeSearchCanStart = useMemo(() => {
    const id = employeeQuery.trim();
    return id.length > 0 && !employeeContacts.some((contact) => contact.id.toLowerCase() === id.toLowerCase());
  }, [employeeContacts, employeeQuery]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setIsRefreshing(true);
    try {
      const [sandboxResult, nodeResult, sessionResult] = await Promise.allSettled([
        listSandboxes(signal),
        listDaemonNodes(signal),
        listSessions(signal),
      ]);
      if (sandboxResult.status === "fulfilled") setSandboxes(sandboxResult.value.sandboxes);
      if (nodeResult.status === "fulfilled") setNodes(nodeResult.value.nodes);
      if (sessionResult.status === "fulfilled") setSessions(sessionResult.value.sessions);
      const rejected = [sandboxResult, nodeResult, sessionResult].find((item) => item.status === "rejected");
      if (rejected?.status === "rejected") {
        setStatus({ tone: "warn", message: rejected.reason instanceof Error ? rejected.reason.message : String(rejected.reason) });
      }
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => void refresh(controller.signal), 3000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    const storedEmployee = localStorage.getItem(selectedEmployeeKey);
    if (storedEmployee) setSelectedEmployee(storedEmployee);
    setTokens(readTokens());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(selectedEmployeeKey, selectedEmployee);
    setTokenInput(tokens[selectedEmployee] ?? "");
  }, [selectedEmployee, tokens, hydrated]);

  useEffect(() => {
    setSelectedSessionId(undefined);
  }, [activeAgent, selectedEmployee]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (!el || !atBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, activeSession?.id]);

  function handleTranscriptScroll(): void {
    const el = transcriptRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }

  async function selectEmployee(employeeId: string) {
    const nextEmployee = employeeId.trim().replace(/^@/, "");
    if (!nextEmployee) return;
    setSelectedEmployee(nextEmployee);
    setMobileView("chat");
    const token = tokenInput.trim() || tokens[nextEmployee];
    try {
      setStatus({ tone: "info", message: `Opening ${nextEmployee}'s Relay workspace.` });
      const sandbox = await provisionSandbox(nextEmployee, token);
      const nextTokens = { ...tokens };
      if (sandbox.token) {
        nextTokens[sandbox.id] = sandbox.token;
        nextTokens[nextEmployee] = sandbox.token;
        setTokens(nextTokens);
        writeTokens(nextTokens);
      }
      setSandboxes((current) => [sandbox, ...current.filter((item) => item.id !== sandbox.id)]);
      setStatus({ tone: "good", message: `${nextEmployee}'s agent workspace is ready.` });
      await refresh();
    } catch (error) {
      setStatus({ tone: "bad", message: error instanceof Error ? error.message : String(error) });
    }
  }

  function saveToken() {
    const token = tokenInput.trim();
    const nextTokens = { ...tokens };
    if (selectedSandbox) nextTokens[selectedSandbox.id] = token;
    nextTokens[selectedEmployee] = token;
    setTokens(nextTokens);
    writeTokens(nextTokens);
    setStatus({ tone: "info", message: token ? "Token saved for this employee." : "Token cleared." });
  }

  async function sendMessage() {
    const raw = composerText.trim();
    if (!raw) return;
    const mentionMatch = /^@(claude|pi|codex)(?:\s+|$)/i.exec(raw);
    const routedAgent: AgentName = (mentionMatch?.[1].toLowerCase() as AgentName | undefined) ?? activeAgent;
    const goal = mentionMatch ? raw.slice(mentionMatch[0].length).trim() : raw;
    if (!goal) {
      setStatus({ tone: "warn", message: `Add a task after @${routedAgent}.` });
      return;
    }
    if (!selectedSandbox) {
      setStatus({ tone: "warn", message: "Open this employee's sandbox before sending." });
      await selectEmployee(selectedEmployee);
      return;
    }
    setIsRunning(true);
    try {
      const session = await runSandbox(
        {
          sandboxId: selectedSandbox.id,
          taskGoal: goal,
          assignments: [{ agent: routedAgent, mode: modeByAgent[routedAgent] }],
        },
        selectedToken,
      );
      setSelectedSessionId(session.id);
      setComposerText("");
      setMentionOpen(false);
      setMobileView("chat");
      atBottomRef.current = true;
      setStatus({ tone: "good", message: `Message sent to ${selectedEmployee}'s ${routedAgent} agent.` });
      await refresh();
    } catch (error) {
      setStatus({ tone: "bad", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsRunning(false);
    }
  }

  function detectMentionToken(text: string, caret: number): { start: number; query: string } | null {
    const upTo = text.slice(0, caret);
    const match = /(?:^|\s)@([a-z0-9-]*)$/i.exec(upTo);
    if (!match) return null;
    const start = match.index === 0 ? 0 : match.index + 1;
    return { start, query: match[1].toLowerCase() };
  }

  function syncMentionState(text: string, caret: number) {
    if (isComposing) return;
    const token = detectMentionToken(text, caret);
    if (token) {
      setMentionOpen(true);
      setMentionQuery(token.query);
      setMentionIndex(0);
    } else if (mentionOpen) {
      setMentionOpen(false);
    }
  }

  function insertMention(agent: AgentName) {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? composerText.length;
    const token = detectMentionToken(composerText, caret);
    const start = token?.start ?? caret;
    const before = composerText.slice(0, start);
    const after = composerText.slice(caret);
    const inserted = `@${agent} `;
    const next = `${before}${inserted}${after}`;
    setComposerText(next);
    setMentionOpen(false);
    setMentionQuery("");
    setMentionIndex(0);
    pickAgent(agent);
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      const pos = start + inserted.length;
      node.focus();
      node.setSelectionRange(pos, pos);
    });
  }

  async function cancelActiveRun() {
    if (!selectedSandbox || !activeRun) return;
    try {
      const session = await cancelRun(selectedSandbox.id, activeRun.sessionId, selectedToken);
      setSelectedSessionId(session.id);
      setStatus({ tone: "warn", message: `Cancel requested for ${activeRun.sessionId}.` });
      await refresh();
    } catch (error) {
      setStatus({ tone: "bad", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function sendDecision(kind: "approve" | "reject" | "rerun" | "mark_done") {
    if (!activeSession) return;
    try {
      const session = await recordDecision(activeSession.id, kind);
      setSelectedSessionId(session.id);
      setStatus({ tone: "good", message: `${kind.replace("_", " ")} recorded.` });
      await refresh();
    } catch (error) {
      setStatus({ tone: "bad", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function sendHandoff() {
    if (!activeSession) return;
    try {
      const session = await recordHandoff(activeSession.id, handoffAgent, handoffMode, handoffNote.trim() || undefined);
      setSelectedSessionId(session.id);
      setHandoffNote("");
      setHandoffOpen(false);
      setActiveAgent(handoffAgent);
      setStatus({ tone: "good", message: `Conversation handed to ${handoffAgent}.` });
      await refresh();
    } catch (error) {
      setStatus({ tone: "bad", message: error instanceof Error ? error.message : String(error) });
    }
  }

  function pickAgent(agent: AgentName) {
    setActiveAgent(agent);
    setAgentPickerOpen(false);
  }

  const filteredMentionAgents = mentionQuery
    ? agents.filter((agent) => agent.startsWith(mentionQuery))
    : agents;

  return (
    <main
      className="messenger-shell"
      data-settings={settingsOpen ? "open" : "closed"}
      data-mobile-view={mobileView}
    >
      <a className="skip-link" href="#chat-panel">Skip to Conversation</a>

      <div className="mobile-topbar" aria-label="Mobile workspace switcher">
        <button
          type="button"
          className={mobileView === "threads" ? "active" : ""}
          aria-label="Conversations"
          aria-pressed={mobileView === "threads"}
          onClick={() => setMobileView("threads")}
        >
          <MessageCircle size={16} />
          <span>Chats</span>
        </button>
        <button
          type="button"
          className={mobileView === "chat" ? "active" : ""}
          aria-pressed={mobileView === "chat"}
          onClick={() => setMobileView("chat")}
        >
          <Bot size={16} />
          <span translate="no">@{selectedEmployee}</span>
        </button>
        <button
          type="button"
          className={`mobile-settings ${settingsOpen ? "active" : ""}`}
          aria-label="Settings"
          aria-controls="settings-drawer"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((value) => !value)}
        >
          <Settings size={16} />
        </button>
      </div>

      <aside className="people-panel" aria-label="Relay navigation">
        <div className="brand-mark">
          <strong>Relay</strong>
          <span className="badge-pill">Workforce control</span>
        </div>

        <nav className="side-nav" aria-label="Workspace sections">
          <button className="active" type="button" aria-label="Chat" aria-pressed="true">
            <MessageCircle size={16} />
            <span>Chat</span>
            <small>{employeeContacts.length}</small>
          </button>
          <button
            type="button"
            aria-label="Sandboxes"
            aria-pressed={settingsOpen}
            onClick={() => setSettingsOpen((value) => !value)}
          >
            <UserRound size={16} />
            <span>Sandboxes</span>
            <small>{sandboxes.length}</small>
          </button>
        </nav>

        <button
          className="people-settings"
          type="button"
          aria-controls="settings-drawer"
          aria-expanded={settingsOpen}
          aria-label="Workspace settings"
          onClick={() => setSettingsOpen((value) => !value)}
        >
          <Settings size={15} />
          <span>Workspace settings</span>
        </button>
      </aside>

      <aside className="thread-panel" aria-label="Employee conversations">
        <div className="conversation-header">
          <div className="conversation-heading">
            <p className="eyebrow">Conversations</p>
            <h1>
              Employees
              <small className="mono conversation-heading-count">{filteredEmployees.length.toString().padStart(2, "0")}</small>
            </h1>
          </div>
          <button type="button" aria-label="Refresh" onClick={() => void refresh()}>
            <RefreshCw size={16} className={isRefreshing ? "spin" : ""} />
          </button>
        </div>

        <form
          className="people-search conversation-search"
          onSubmit={(event) => {
            event.preventDefault();
            void selectEmployee(employeeQuery);
          }}
        >
            <Search size={15} />
            <input
              aria-label="Search employee conversations"
              name="employee-search"
              autoComplete="off"
              spellCheck={false}
              placeholder="Search conversations…"
              value={employeeQuery}
              onChange={(event) => setEmployeeQuery(event.target.value)}
            />
          {employeeSearchCanStart ? (
            <button type="submit" aria-label={`Open workspace for ${employeeQuery}`}>
              <Plus size={15} />
            </button>
          ) : null}
        </form>

        <section className="conversation-list" aria-label="Employee conversation list">
          {filteredEmployees.map((contact) => {
            const status = contact.sandbox?.status ?? "unprovisioned";
            const lastAgent = contact.lastSession?.agentRuns[contact.lastSession.agentRuns.length - 1]?.agent;
            return (
              <button
                className={`conversation-row ${selectedEmployee === contact.id ? "active" : ""} ${contact.activeRun ? "has-activity" : ""}`}
                key={contact.id}
                type="button"
                aria-pressed={selectedEmployee === contact.id}
                onClick={() => void selectEmployee(contact.id)}
              >
                <EmployeeAvatar employeeId={contact.id} running={Boolean(contact.activeRun)} />
                <span className="conversation-copy">
                  <span className="conversation-topline">
                    <span className="conversation-name">
                      <span className={`status-dot status-dot-${statusTone(status)}`} aria-hidden="true" />
                      <strong translate="no">{contact.id}</strong>
                    </span>
                    {contact.activeRun ? (
                      <span className="conversation-badge mono" aria-label="Agent running">
                        {Math.max(contact.sessionCount, 1)}
                      </span>
                    ) : (
                      <span className="conversation-stamp mono">
                        {contact.sessionCount > 0 ? `${contact.sessionCount.toString().padStart(2, "0")}` : "—"}
                      </span>
                    )}
                  </span>
                  <span className="conversation-preview">
                    {contact.activeRun
                      ? `${contact.activeRun.agent} is working`
                      : contact.lastSession?.taskGoal ?? "Open their agent workspace"}
                  </span>
                  <span className="conversation-meta">
                    <span className="conversation-meta-status">{status}</span>
                    <span className="conversation-meta-sep" aria-hidden="true" />
                    <span>{lastAgent ?? "no agent yet"}</span>
                  </span>
                </span>
              </button>
            );
          })}
          {filteredEmployees.length === 0 ? (
            <button className="conversation-row conversation-row-new" type="button" onClick={() => void selectEmployee(employeeQuery)}>
              <span className="conversation-new-avatar" aria-hidden="true">
                <Plus size={16} />
              </span>
              <span className="conversation-copy">
                <span className="conversation-topline">
                  <span className="conversation-name">
                    <strong>Start @{employeeQuery || "new-employee"}</strong>
                  </span>
                </span>
                <span className="conversation-preview">Create a sandbox-backed employee conversation.</span>
              </span>
            </button>
          ) : null}
        </section>
      </aside>

      <section id="chat-panel" className="chat-panel" aria-label="Active employee agent conversation" tabIndex={-1}>
        <header className="chat-header">
          <div className="chat-title">
            <button
              className="mobile-back-button"
              type="button"
              onClick={() => setMobileView("threads")}
            >
              <MessageCircle size={16} />
              <span>Conversations</span>
            </button>
            <EmployeeAvatar employeeId={selectedEmployee} running={Boolean(activeRun)} />
            <div>
              <p>
                <span translate="no">@{selectedEmployee}</span>
                <span className="header-separator" aria-hidden="true" />
                <span translate="no">{activeAgent}</span>
                {activeSession ? (
                  <>
                    <span className="header-separator" aria-hidden="true" />
                    <span className="session-id">{activeSession.id.slice(0, 8)}</span>
                  </>
                ) : null}
              </p>
              <h2>
                {activeSession ? activeSession.taskGoal : agentDescriptors[activeAgent].blurb}
              </h2>
            </div>
          </div>
          <div className="chat-tools">
            <div className="header-agent-tabs" aria-label="Talk to agent">
              {agents.map((agent) => (
                <button
                  key={agent}
                  type="button"
                  aria-pressed={agent === activeAgent}
                  className={agent === activeAgent ? "active" : ""}
                  onClick={() => setActiveAgent(agent)}
                >
                  <span translate="no">@{agent}</span>
                </button>
              ))}
            </div>
            {activeSession ? <StatusPill value={activeSession.status} /> : null}
            <button
              className="icon-button"
              type="button"
              aria-label="Refresh"
              title="Refresh"
              onClick={() => void refresh()}
            >
              <RefreshCw size={16} className={isRefreshing ? "spin" : ""} />
            </button>
            <button
              className={`icon-button ${settingsOpen ? "active" : ""}`}
              type="button"
              aria-label="Settings"
              aria-controls="settings-drawer"
              aria-expanded={settingsOpen}
              title="Settings"
              onClick={() => setSettingsOpen((value) => !value)}
            >
              <Settings size={16} />
            </button>
          </div>
        </header>

        <div
          className={`toast ${status.tone}`}
          data-visible={toastVisible}
          role="status"
          aria-live="polite"
        >
          {toastVisible ? status.message : null}
        </div>

        <div className="transcript" ref={transcriptRef} onScroll={handleTranscriptScroll}>
          <div className="transcript-inner">
            {activeSession ? (
              <>
                {messages.map((message, index) => (
                  <MessageBlock
                    key={message.id}
                    message={message}
                    employeeId={selectedEmployee}
                    grouped={isGroupedContinuation(messages, index)}
                  />
                ))}
                {awaitingDecision ? (
                  <div className="decision-bar">
                    <button type="button" onClick={() => void sendDecision("approve")}>
                      <Check size={14} /> Approve
                    </button>
                    <button type="button" onClick={() => void sendDecision("rerun")}>Rerun</button>
                    <button type="button" onClick={() => void sendDecision("mark_done")}>Mark done</button>
                    <button type="button" className="danger-soft" onClick={() => void sendDecision("reject")}>Reject</button>
                    <button
                      type="button"
                      className="primary"
                      aria-controls="handoff-panel"
                      aria-expanded={handoffOpen}
                      onClick={() => setHandoffOpen((value) => !value)}
                    >
                      <GitBranch size={14} /> Handoff
                    </button>
                  </div>
                ) : null}
                {handoffOpen ? (
                  <div id="handoff-panel" className="handoff-panel">
                    <div className="handoff-row">
                      <label htmlFor="handoff-agent">Route to</label>
                      <select id="handoff-agent" name="handoff-agent" value={handoffAgent} onChange={(event) => setHandoffAgent(event.target.value as AgentName)}>
                        {agents.map((agent) => <option key={agent} value={agent}>{agent}</option>)}
                      </select>
                      <select id="handoff-mode" name="handoff-mode" aria-label="Handoff mode" value={handoffMode} onChange={(event) => setHandoffMode(event.target.value as CodexTaskMode)}>
                        {modes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                      </select>
                    </div>
                    <input
                      aria-label="Handoff note"
                      name="handoff-note"
                      autoComplete="off"
                      placeholder="Optional handoff note…"
                      value={handoffNote}
                      onChange={(event) => setHandoffNote(event.target.value)}
                    />
                    <div className="handoff-actions">
                      <button type="button" onClick={() => setHandoffOpen(false)}>Cancel</button>
                      <button type="button" className="primary" onClick={() => void sendHandoff()}>Send handoff</button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="transcript-empty" data-agent={activeAgent}>
                <MessageCircle size={28} />
                <p className="eyebrow">New workspace session</p>
                <h2>
                  @{selectedEmployee} is ready for {activeAgent}.
                </h2>
                <p>{agentDescriptors[activeAgent].blurb}</p>
              </div>
            )}
          </div>
        </div>

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage();
          }}
        >
          <div className="composer-toolbar">
            <div className="mode-switch" aria-label="Mode">
              {modes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={modeByAgent[activeAgent] === mode}
                  className={modeByAgent[activeAgent] === mode ? "active" : ""}
                  onClick={() => setModeByAgent((current) => ({ ...current, [activeAgent]: mode }))}
                >
                  {mode}
                </button>
              ))}
            </div>
            <div className="agent-picker-wrap">
              <button
                type="button"
                className="agent-picker-trigger"
                aria-label="Choose agent"
                aria-controls="agent-picker"
                aria-expanded={agentPickerOpen}
                onClick={() => setAgentPickerOpen((value) => !value)}
              >
                <AtSign size={14} />
                  <span translate="no">{activeAgent}</span>
              </button>
              {agentPickerOpen ? (
                <div id="agent-picker" className="agent-picker" aria-label="Choose agent">
                  {agents.map((agent) => (
                    <button
                      key={agent}
                      type="button"
                      aria-pressed={agent === activeAgent}
                      className={agent === activeAgent ? "active" : ""}
                      onClick={() => pickAgent(agent)}
                    >
                      <span className={`agent-avatar tone-${agentDescriptors[agent].tone}`} aria-hidden="true">
                        <Bot size={13} />
                      </span>
                      <span translate="no">{agent}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {activeRun ? (
              <button
                type="button"
                className="cancel-run"
                onClick={() => void cancelActiveRun()}
              >
                <CircleStop size={14} /> Cancel run
              </button>
            ) : null}
          </div>
          <div className="composer-input-wrap">
            {mentionOpen && filteredMentionAgents.length > 0 ? (
              <div
                id="mention-popover"
                className="mention-popover agent-picker"
                role="listbox"
                aria-label="Address an agent"
              >
                {filteredMentionAgents.map((agent, i) => (
                  <button
                    key={agent}
                    id={`mention-option-${i}`}
                    type="button"
                    role="option"
                    aria-selected={i === mentionIndex}
                    className={i === mentionIndex ? "active" : ""}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      insertMention(agent);
                    }}
                  >
                    <span className={`agent-avatar tone-${agentDescriptors[agent].tone}`} aria-hidden="true">
                      <Bot size={13} />
                    </span>
                    <span translate="no">@{agent}</span>
                    <span className="mention-role">{agentDescriptors[agent].role}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="composer-input">
            <textarea
              ref={textareaRef}
              aria-label={`Write to ${selectedEmployee}'s ${activeAgent}`}
              aria-controls={mentionOpen ? "mention-popover" : undefined}
              aria-expanded={mentionOpen}
              aria-activedescendant={mentionOpen ? `mention-option-${mentionIndex}` : undefined}
              name="message"
              placeholder={`Write to @${selectedEmployee} — type @ to switch agent…`}
              value={composerText}
              onChange={(event) => {
                const value = event.target.value;
                setComposerText(value);
                syncMentionState(value, event.target.selectionStart ?? value.length);
              }}
              onKeyUp={(event) => {
                if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") {
                  const target = event.currentTarget;
                  syncMentionState(target.value, target.selectionStart ?? target.value.length);
                }
              }}
              onSelect={(event) => {
                const target = event.currentTarget;
                syncMentionState(target.value, target.selectionStart ?? target.value.length);
              }}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={(event) => {
                setIsComposing(false);
                const target = event.currentTarget;
                syncMentionState(target.value, target.selectionStart ?? target.value.length);
              }}
              onBlur={() => setMentionOpen(false)}
              onKeyDown={(event) => {
                if (mentionOpen && filteredMentionAgents.length > 0) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setMentionIndex((i) => (i + 1) % filteredMentionAgents.length);
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setMentionIndex((i) => (i - 1 + filteredMentionAgents.length) % filteredMentionAgents.length);
                    return;
                  }
                  if (event.key === "Enter" || event.key === "Tab") {
                    event.preventDefault();
                    insertMention(filteredMentionAgents[mentionIndex]);
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setMentionOpen(false);
                    return;
                  }
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              rows={2}
            />
            <button
              type="submit"
              className="send-button"
              disabled={isRunning || !composerText.trim()}
              aria-label="Send"
              title="Send"
            >
              <CornerDownLeft size={18} />
            </button>
            </div>
          </div>
        </form>
      </section>

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        quickUsers={quickUsers}
        selectedEmployee={selectedEmployee}
        customEmployee={customEmployee}
        setCustomEmployee={setCustomEmployee}
        selectEmployee={selectEmployee}
        tokenInput={tokenInput}
        setTokenInput={setTokenInput}
        saveToken={saveToken}
        selectedSandbox={selectedSandbox}
        selectedNode={selectedNode}
        activeRun={activeRun}
        onCancelRun={cancelActiveRun}
      />
    </main>
  );
}

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  quickUsers: string[];
  selectedEmployee: string;
  customEmployee: string;
  setCustomEmployee: (value: string) => void;
  selectEmployee: (employeeId: string) => Promise<void>;
  tokenInput: string;
  setTokenInput: (value: string) => void;
  saveToken: () => void;
  selectedSandbox?: SandboxRecord;
  selectedNode?: DaemonNodeMonitorRecord;
  activeRun?: DaemonNodeMonitorRecord["activeRuns"][number];
  onCancelRun: () => Promise<void>;
}

function SettingsDrawer({
  open,
  onClose,
  quickUsers,
  selectedEmployee,
  customEmployee,
  setCustomEmployee,
  selectEmployee,
  tokenInput,
  setTokenInput,
  saveToken,
  selectedSandbox,
  selectedNode,
  activeRun,
  onCancelRun,
}: SettingsDrawerProps) {
  if (!open) return null;
  return (
    <aside id="settings-drawer" className="settings-drawer" aria-labelledby="settings-title">
      <div className="settings-header">
        <div>
          <p className="eyebrow">Employee workspace</p>
          <h3 id="settings-title" translate="no">@{selectedEmployee}</h3>
        </div>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <section className="settings-section">
        <div className="panel-kicker">Known employees</div>
        <div className="settings-user-list">
          {quickUsers.map((employeeId) => (
            <button
              className={`settings-user ${selectedEmployee === employeeId ? "active" : ""}`}
              key={employeeId}
              onClick={() => void selectEmployee(employeeId)}
              type="button"
            >
              <EmployeeAvatar employeeId={employeeId} running={false} />
              <span translate="no">@{employeeId}</span>
            </button>
          ))}
        </div>
        <form
          className="settings-inline"
          onSubmit={(event) => {
            event.preventDefault();
            void selectEmployee(customEmployee);
            setCustomEmployee("");
          }}
        >
          <UserRound size={15} />
          <input
            aria-label="Custom employee ID"
            name="custom-employee-id"
            autoComplete="off"
            spellCheck={false}
            placeholder="alice…"
            value={customEmployee}
            onChange={(event) => setCustomEmployee(event.target.value)}
          />
          <button type="submit">Open Employee</button>
        </form>
      </section>

      <section className="settings-section">
        <div className="panel-kicker">Sandbox token</div>
        <div className="settings-inline">
          <KeyRound size={15} />
          <input
            aria-label="Sandbox token"
            name="sandbox-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="tok_…"
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
          />
          <button type="button" onClick={saveToken}>Save Token</button>
        </div>
        <p className="settings-hint">Saved locally in this browser for the selected employee.</p>
      </section>

      <section className="settings-section">
        <div className="panel-kicker">Live sandbox</div>
        <p className="settings-id" translate="no">{selectedSandbox?.id ?? "No sandbox selected"}</p>
        <StatusPill value={selectedSandbox?.status ?? "unprovisioned"} />
        <dl className="settings-dl">
          <div>
            <dt>workspace</dt>
            <dd>{selectedSandbox?.workspacePath ?? "none"}</dd>
          </div>
          <div>
            <dt>node</dt>
            <dd>
              {selectedNode ? (
                <>
                  <span className="mono">{selectedNode.queuedCommandCount}</span> queued
                </>
              ) : (
                "not registered"
              )}
            </dd>
          </div>
          <div>
            <dt>run</dt>
            <dd>
              {activeRun ? (
                <span className="settings-run">
                  <span className="mono" translate="no">{activeRun.agent}</span>
                  <button type="button" className="settings-cancel" onClick={() => void onCancelRun()}>
                    <CircleStop size={12} /> Cancel
                  </button>
                </span>
              ) : (
                "idle"
              )}
            </dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}

function EmployeeAvatar({ employeeId, running }: { employeeId: string; running: boolean }) {
  const initials = employeeId
    .split(/[._-\s]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "?";
  return (
    <span className={`employee-avatar ${running ? "running" : ""}`} aria-hidden="true">
      {initials}
    </span>
  );
}

function MessageBlock({
  message,
  employeeId,
  grouped = false,
}: {
  message: DerivedMessage;
  employeeId: string;
  grouped?: boolean;
}) {
  if (message.kind === "user") {
    return (
      <article className="msg msg-user">
        <div className="bubble">
          <header>
            <span>you</span>
            <time className="mono">{formatTime(message.timestamp)}</time>
          </header>
          <p>{message.text}</p>
        </div>
      </article>
    );
  }
  if (message.kind === "agent") {
    return (
      <article className={`msg msg-agent ${message.streaming ? "streaming" : ""} ${grouped ? "grouped" : ""}`}>
        <span className={`agent-avatar tone-${agentDescriptors[message.agent].tone}`} aria-hidden="true">
          <Bot size={15} />
        </span>
        <div className="bubble">
          <header>
            <span>{employeeId}'s {message.agent}</span>
            <time className="mono">{formatTime(message.timestamp)}</time>
          </header>
          <AgentStream
            agent={message.agent}
            stdout={message.stdout}
            stderr={message.stderr}
            streaming={message.streaming}
          />
          {message.attachments.length > 0 ? (
            <div className="attachment-list">
              {message.attachments.map((artifact) => (
                <a
                  key={artifact.id}
                  className="attachment-card"
                  href={`/sessions/artifacts/${encodeURIComponent(artifact.id)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Paperclip size={14} />
                  <span className="attachment-meta">
                    <span className="attachment-kind">{artifact.kind}</span>
                    <strong>{artifact.title}</strong>
                  </span>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </article>
    );
  }
  return (
    <div className={`msg msg-system tone-${message.tone}`}>
      <span className="msg-system-rule" aria-hidden="true" />
      <span className="msg-system-label">
        <span>{message.label}</span>
        {message.detail ? <span className="msg-system-detail">{message.detail}</span> : null}
      </span>
      <time className="mono">{formatTime(message.timestamp)}</time>
    </div>
  );
}

function statusTone(value: string): Tone {
  if (value === "ready" || value === "completed" || value === "done") return "good";
  if (value === "running") return "info";
  if (value === "failed" || value === "blocked" || value === "cancelled") return "bad";
  return "warn";
}

function StatusPill({ value }: { value: string }) {
  return <Badge variant="outline" className={`pill ${statusTone(value)}`}>{value}</Badge>;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function sessionBelongsToEmployee(session: RelaySession, employeeId: string, sandbox?: SandboxRecord): boolean {
  if (sandbox && session.workspacePath === sandbox.workspacePath) return true;
  return session.workspacePath === `/workspace/${employeeId}` || session.workspacePath.endsWith(`/${employeeId}`);
}

function projectMessages(session: RelaySession | undefined): DerivedMessage[] {
  if (!session) return [];
  const out: DerivedMessage[] = [];
  out.push({
    kind: "user",
    id: `${session.id}:goal`,
    timestamp: session.createdAt,
    text: session.taskGoal,
  });

  const runState = new Map<string, {
    index: number;
    agent: AgentName;
    streaming: boolean;
    stdout: string;
    stderr: string;
    attachmentIds: Set<string>;
    timestamp: string;
  }>();

  const ensureRun = (runId: string, agent: AgentName, timestamp: string): number => {
    const existing = runState.get(runId);
    if (existing) return existing.index;
    const block: DerivedMessage = {
      kind: "agent",
      id: `${session.id}:run:${runId}`,
      timestamp,
      agent,
      runId,
      streaming: true,
      stdout: "",
      stderr: "",
      attachments: [],
    };
    out.push(block);
    const index = out.length - 1;
    runState.set(runId, {
      index,
      agent,
      streaming: true,
      stdout: "",
      stderr: "",
      attachmentIds: new Set(),
      timestamp,
    });
    return index;
  };

  for (const event of session.events) {
    switch (event.type) {
      case "session.created":
        break;
      case "agent.started": {
        ensureRun(event.runId, event.agent, event.timestamp);
        out.push({
          kind: "system",
          id: event.id,
          timestamp: event.timestamp,
          tone: "neutral",
          label: `${event.agent} - ${event.mode} started`,
        });
        break;
      }
      case "agent.output": {
        const index = ensureRun(event.runId, event.agent, event.timestamp);
        const state = runState.get(event.runId);
        if (!state) break;
        if (event.stream === "stdout") state.stdout += event.text;
        else state.stderr += event.text;
        const block = out[index];
        if (block.kind === "agent") {
          out[index] = {
            ...block,
            stdout: state.stdout,
            stderr: state.stderr,
          };
        }
        break;
      }
      case "artifact.created": {
        const runId = event.artifact.agentRunId;
        if (runId) {
          const index = ensureRun(runId, session.currentAgent ?? "claude", event.timestamp);
          const state = runState.get(runId);
          const block = out[index];
          if (state && !state.attachmentIds.has(event.artifact.id) && block.kind === "agent") {
            state.attachmentIds.add(event.artifact.id);
            out[index] = { ...block, attachments: [...block.attachments, event.artifact] };
          }
        } else {
          out.push({
            kind: "system",
            id: event.id,
            timestamp: event.timestamp,
            tone: "neutral",
            label: `artifact - ${event.artifact.kind}`,
            detail: event.artifact.title,
          });
        }
        break;
      }
      case "human.decision": {
        out.push({
          kind: "system",
          id: event.id,
          timestamp: event.timestamp,
          tone: "info",
          label: `you - ${event.decision.kind.replace("_", " ")}`,
          detail: event.decision.note,
        });
        break;
      }
      case "agent.completed": {
        const state = runState.get(event.runId);
        if (state) {
          state.streaming = false;
          const block = out[state.index];
          if (block.kind === "agent") {
            out[state.index] = { ...block, streaming: false };
          }
        }
        out.push({
          kind: "system",
          id: event.id,
          timestamp: event.timestamp,
          tone: event.status === "completed" ? "good" : event.status === "failed" ? "bad" : "neutral",
          label: `${event.agent} - ${event.status}`,
          detail: `exit ${event.exitCode}`,
        });
        break;
      }
      case "review.verdict": {
        out.push({
          kind: "system",
          id: event.id,
          timestamp: event.timestamp,
          tone: event.verdict === "approved" ? "good" : "bad",
          label: `codex verdict - ${event.verdict}`,
          detail: event.feedback,
        });
        break;
      }
      case "session.status": {
        out.push({
          kind: "system",
          id: event.id,
          timestamp: event.timestamp,
          tone: "neutral",
          label: `status - ${event.phase}`,
        });
        break;
      }
      case "session.completed":
      case "session.failed": {
        out.push({
          kind: "system",
          id: event.id,
          timestamp: event.timestamp,
          tone: event.type === "session.completed" ? "good" : "bad",
          label: event.type === "session.completed" ? "session completed" : "session failed",
          detail: event.outcome,
        });
        break;
      }
    }
  }
  return out;
}
