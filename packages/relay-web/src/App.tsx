"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign, Check, CircleStop, CornerDownLeft, GitBranch,
  MessageCircle, Plus, RefreshCw, Search, Settings, UserRound,
} from "lucide-react";
import {
  cancelRun, createSession, provisionSandbox,
  recordDecision, recordHandoff, runSandbox,
} from "./api";
import type { AgentName, CodexTaskMode, SandboxRecord, Tone } from "./types";
import { RelayMark } from "./components/RelayMark";
import { EmployeeAvatar } from "./components/EmployeeAvatar";
import { StatusPill } from "./components/StatusPill";
import { TranscriptEmpty } from "./components/TranscriptEmpty";
import { MessageBlock, projectMessages, isGroupedContinuation } from "./components/MessageBlock";
import type { DerivedMessage } from "./components/MessageBlock";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { ConversationRow, NewConversationRow } from "./components/ConversationRow";
import type { EmployeeContact } from "./components/ConversationRow";
import { useRelayData } from "./hooks/useRelayData";

const quickUsers = ["alice", "bob", "carol"];
const agents: AgentName[] = ["claude", "pi", "codex"];
const tokenStorageKey = "relay-web.tokens";
const selectedEmployeeKey = "relay-web.selectedEmployee";
const agentDescriptors: Record<AgentName, { role: string; blurb: string }> = {
  claude: { role: "Builder",  blurb: "Turns requests into implementation work with methodical context." },
  pi:     { role: "Planner",  blurb: "Explores trade-offs and shapes the next reliable step." },
  codex:  { role: "Reviewer", blurb: "Reads diffs, checks behavior, and calls out risks." },
};
const AGENT_INITIALS: Record<AgentName, string> = { claude: "C", pi: "π", codex: "X" };

function defaultModeForAgent(agent: AgentName): CodexTaskMode {
  return agent === "codex" ? "review" : "implement";
}

type TokenMap = Record<string, string>;
type MobileView = "threads" | "chat";

function readTokens(): TokenMap {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(tokenStorageKey) ?? "null") as TokenMap ?? {}; }
  catch { return {}; }
}

function writeTokens(tokens: TokenMap): void {
  if (typeof window !== "undefined") localStorage.setItem(tokenStorageKey, JSON.stringify(tokens));
}

function sessionBelongsToEmployee(
  session: { workspacePath: string }, employeeId: string, sandbox?: SandboxRecord,
): boolean {
  if (sandbox && session.workspacePath === sandbox.workspacePath) return true;
  return session.workspacePath === `/workspace/${employeeId}` || session.workspacePath.endsWith(`/${employeeId}`);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AgentPicker({ activeAgent, agentPickerOpen, setAgentPickerOpen, pickAgent }: {
  activeAgent: AgentName; agentPickerOpen: boolean;
  setAgentPickerOpen: (v: boolean) => void; pickAgent: (a: AgentName) => void;
}) {
  return (
    <div className="agent-picker-wrap">
      <button type="button" className="agent-picker-trigger" aria-label="Choose agent" aria-controls="agent-picker" aria-expanded={agentPickerOpen} onClick={() => setAgentPickerOpen(!agentPickerOpen)}>
        <AtSign size={14} /><span translate="no">{activeAgent}</span>
      </button>
      {agentPickerOpen ? (
        <div id="agent-picker" className="agent-picker" aria-label="Choose agent">
          {agents.map((a) => (
            <button key={a} type="button" aria-pressed={a === activeAgent} className={a === activeAgent ? "active" : ""} onClick={() => pickAgent(a)}>
              <span className="agent-avatar" aria-hidden="true">{AGENT_INITIALS[a]}</span>
              <span translate="no">{a}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MentionPopover({ filteredAgents, mentionIndex, insertMention }: {
  filteredAgents: AgentName[]; mentionIndex: number; insertMention: (a: AgentName) => void;
}) {
  return (
    <div id="mention-popover" className="mention-popover agent-picker" role="listbox" aria-label="Address an agent">
      {filteredAgents.map((a, i) => (
        <button key={a} id={`mention-option-${i}`} type="button" role="option" aria-selected={i === mentionIndex} className={i === mentionIndex ? "active" : ""} onMouseDown={(e) => { e.preventDefault(); insertMention(a); }}>
          <span className="agent-avatar" aria-hidden="true">{AGENT_INITIALS[a]}</span>
          <span translate="no">@{a}</span>
          <span className="mention-role">{agentDescriptors[a].role}</span>
        </button>
      ))}
    </div>
  );
}

function DecisionBar({ sendDecision, handoffOpen, setHandoffOpen, handoffAgent, setHandoffAgent, handoffNote, setHandoffNote, sendHandoff }: {
  sendDecision: (kind: "approve" | "reject" | "rerun" | "mark_done") => Promise<void>;
  handoffOpen: boolean; setHandoffOpen: (v: boolean) => void;
  handoffAgent: AgentName; setHandoffAgent: (a: AgentName) => void;
  handoffNote: string; setHandoffNote: (v: string) => void;
  sendHandoff: () => Promise<void>;
}) {
  return (
    <>
      <div className="decision-bar">
        <button type="button" onClick={() => void sendDecision("approve")}><Check size={14} /> Approve</button>
        <button type="button" onClick={() => void sendDecision("rerun")}>Rerun</button>
        <button type="button" onClick={() => void sendDecision("mark_done")}>Mark done</button>
        <button type="button" className="danger-soft" onClick={() => void sendDecision("reject")}>Reject</button>
        <button type="button" className="primary" aria-controls="handoff-panel" aria-expanded={handoffOpen} onClick={() => setHandoffOpen(!handoffOpen)}>
          <GitBranch size={14} /> Handoff
        </button>
      </div>
      {handoffOpen ? (
        <div id="handoff-panel" className="handoff-panel">
          <div className="handoff-row">
            <label htmlFor="handoff-agent">Route to</label>
            <select id="handoff-agent" name="handoff-agent" value={handoffAgent} onChange={(e) => setHandoffAgent(e.target.value as AgentName)}>
              {agents.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <input aria-label="Handoff note" name="handoff-note" autoComplete="off" placeholder="Optional handoff note…" value={handoffNote} onChange={(e) => setHandoffNote(e.target.value)} />
          <div className="handoff-actions">
            <button type="button" onClick={() => setHandoffOpen(false)}>Cancel</button>
            <button type="button" className="primary" onClick={() => void sendHandoff()}>Send handoff</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export function App() {
  const [selectedEmployee, setSelectedEmployee] = useState<string>(quickUsers[0]);
  const [customEmployee, setCustomEmployee] = useState("");
  const [tokens, setTokens] = useState<TokenMap>({});
  const [hydrated, setHydrated] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [activeAgent, setActiveAgent] = useState<AgentName>("claude");
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
  const [handoffNote, setHandoffNote] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<{ tone: Tone; message: string }>({ tone: "info", message: "Open an employee workspace to begin." });
  const [toastVisible, setToastVisible] = useState(false);
  const statusSeenRef = useRef(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const selectedEmployeeToken = tokens[selectedEmployee];
  const { sandboxes, nodes, sessions, isRefreshing, refresh, setSandboxes } = useRelayData(setStatus, selectedEmployeeToken);

  useEffect(() => {
    if (!statusSeenRef.current) { statusSeenRef.current = true; return; }
    setToastVisible(true);
    const t = window.setTimeout(() => setToastVisible(false), 4000);
    return () => window.clearTimeout(t);
  }, [status]);

  const selectedSandbox = useMemo(() => sandboxes.find((s) => s.employeeId === selectedEmployee), [sandboxes, selectedEmployee]);
  const selectedNode = useMemo(() => nodes.find((n) => n.employeeId === selectedEmployee || n.id === selectedSandbox?.id), [nodes, selectedEmployee, selectedSandbox?.id]);
  const sandboxWorkspace = selectedSandbox?.workspacePath;
  const sandboxSessions = useMemo(() => sessions.filter((s) => !sandboxWorkspace || s.workspacePath === sandboxWorkspace), [sessions, sandboxWorkspace]);
  const threadSessions = useMemo(() => sandboxSessions.filter((s) => s.agentRuns.some((r) => r.agent === activeAgent)), [sandboxSessions, activeAgent]);
  const activeSession = useMemo(() => {
    if (selectedSessionId) { const p = sessions.find((s) => s.id === selectedSessionId); if (p) return p; }
    return threadSessions[0];
  }, [selectedSessionId, sessions, threadSessions]);

  const selectedToken = selectedSandbox ? (tokens[selectedSandbox.id] ?? tokens[selectedEmployee]) : tokens[selectedEmployee];
  const activeRun = selectedNode?.activeRuns[0];
  const messages = useMemo<DerivedMessage[]>(() => projectMessages(activeSession), [activeSession]);

  const awaitingDecision = useMemo(() => {
    if (!activeSession) return false;
    for (let i = activeSession.events.length - 1; i >= 0; i -= 1) {
      const ev = activeSession.events[i];
      if (ev.type === "human.decision") return false;
      if (ev.type === "agent.completed") return true;
      if (ev.type === "session.completed" || ev.type === "session.failed") return false;
    }
    return false;
  }, [activeSession]);

  const employeeContacts = useMemo<EmployeeContact[]>(() => {
    const byId = new Map<string, EmployeeContact>();
    const ensure = (id: string): EmployeeContact => {
      const key = id.trim();
      if (byId.has(key)) return byId.get(key)!;
      const c: EmployeeContact = { id: key, sessionCount: 0 };
      byId.set(key, c); return c;
    };
    for (const id of quickUsers) ensure(id);
    ensure(selectedEmployee);
    for (const sb of sandboxes) { const c = ensure(sb.employeeId); c.sandbox = sb; }
    for (const node of nodes) {
      const eid = node.employeeId ?? sandboxes.find((s) => s.id === node.id)?.employeeId;
      if (!eid) continue;
      const c = ensure(eid); c.node = node; c.activeRun = node.activeRuns[0];
    }
    for (const c of byId.values()) {
      const rel = sessions.filter((s) => sessionBelongsToEmployee(s, c.id, c.sandbox));
      c.sessionCount = rel.length; c.lastSession = rel[0];
    }
    return [...byId.values()].sort((a, b) => {
      if (a.id === selectedEmployee) return -1;
      if (b.id === selectedEmployee) return 1;
      if (a.activeRun && !b.activeRun) return -1;
      if (b.activeRun && !a.activeRun) return 1;
      const aQ = quickUsers.indexOf(a.id), bQ = quickUsers.indexOf(b.id);
      if (aQ !== -1 || bQ !== -1) return (aQ === -1 ? 99 : aQ) - (bQ === -1 ? 99 : bQ);
      return a.id.localeCompare(b.id);
    });
  }, [nodes, sandboxes, selectedEmployee, sessions]);

  const filteredEmployees = useMemo(() => {
    const q = employeeQuery.trim().toLowerCase();
    if (!q) return employeeContacts;
    return employeeContacts.filter((c) => c.id.toLowerCase().includes(q) || (c.lastSession?.taskGoal.toLowerCase() ?? "").includes(q));
  }, [employeeContacts, employeeQuery]);

  const employeeSearchCanStart = useMemo(() => {
    const id = employeeQuery.trim();
    return id.length > 0 && !employeeContacts.some((c) => c.id.toLowerCase() === id.toLowerCase());
  }, [employeeContacts, employeeQuery]);

  const refreshWithToken = useCallback(async (tokenOverride?: string) => {
    await refresh(undefined, tokenOverride);
  }, [refresh]);

  useEffect(() => {
    const stored = localStorage.getItem(selectedEmployeeKey);
    if (stored) setSelectedEmployee(stored);
    setTokens(readTokens()); setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(selectedEmployeeKey, selectedEmployee);
    setTokenInput(tokens[selectedEmployee] ?? "");
  }, [selectedEmployee, tokens, hydrated]);
  useEffect(() => { setSelectedSessionId(undefined); }, [activeAgent, selectedEmployee]);
  useEffect(() => {
    const el = transcriptRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, activeSession?.id]);

  function handleTranscriptScroll(): void {
    const el = transcriptRef.current;
    if (el) atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }

  async function selectEmployee(employeeId: string) {
    const next = employeeId.trim().replace(/^@/, "");
    if (!next) return;
    setSelectedEmployee(next); setMobileView("chat");
    const token = next === selectedEmployee ? tokenInput.trim() || tokens[next] : tokens[next];
    try {
      setStatus({ tone: "info", message: `Opening ${next}'s Relay workspace.` });
      const sandbox = await provisionSandbox(next, token);
      const nextTokens = { ...tokens };
      if (sandbox.token) {
        nextTokens[sandbox.id] = sandbox.token;
        nextTokens[next] = sandbox.token;
        setTokens(nextTokens); writeTokens(nextTokens);
      }
      setSandboxes((cur) => [sandbox, ...cur.filter((s) => s.id !== sandbox.id)]);
      setStatus({ tone: "good", message: `${next}'s agent workspace is ready.` });
      await refreshWithToken(nextTokens[sandbox.id] ?? nextTokens[next]);
    } catch (err) {
      setStatus({ tone: "bad", message: err instanceof Error ? err.message : String(err) });
    }
  }

  function saveToken() {
    const token = tokenInput.trim();
    const nextTokens = { ...tokens };
    if (selectedSandbox) nextTokens[selectedSandbox.id] = token;
    nextTokens[selectedEmployee] = token;
    setTokens(nextTokens); writeTokens(nextTokens);
    setStatus({ tone: "info", message: token ? "Token saved for this employee." : "Token cleared." });
  }

  async function sendMessage() {
    const raw = composerText.trim();
    if (!raw) return;
    const mm = /^@(claude|pi|codex)(?:\s+|$)/i.exec(raw);
    const routedAgent: AgentName = (mm?.[1].toLowerCase() as AgentName | undefined) ?? activeAgent;
    const goal = mm ? raw.slice(mm[0].length).trim() : raw;
    if (!goal) { setStatus({ tone: "warn", message: `Add a task after @${routedAgent}.` }); return; }
    if (!selectedSandbox) {
      setStatus({ tone: "warn", message: "Open this employee's sandbox before sending." });
      await selectEmployee(selectedEmployee); return;
    }
    setIsRunning(true);
    try {
      const assignment = { agent: routedAgent, mode: defaultModeForAgent(routedAgent) };
      const session = await createSession({ taskGoal: goal, assignments: [assignment], workspacePath: selectedSandbox.workspacePath }, selectedToken);
      setSelectedSessionId(session.id); setComposerText(""); setMentionOpen(false);
      setMobileView("chat"); atBottomRef.current = true;
      await refresh();
      const timer = window.setInterval(() => void refresh(), 1000);
      try {
        const done = await runSandbox({ sandboxId: selectedSandbox.id, taskGoal: goal, assignments: [assignment], sessionId: session.id }, selectedToken);
        setSelectedSessionId(done.id);
        setStatus({ tone: "good", message: `Message sent to ${selectedEmployee}'s ${routedAgent} agent.` });
      } finally { window.clearInterval(timer); }
      await refresh();
    } catch (err) {
      setStatus({ tone: "bad", message: err instanceof Error ? err.message : String(err) });
    } finally { setIsRunning(false); }
  }

  function detectMentionToken(text: string, caret: number): { start: number; query: string } | null {
    const m = /(?:^|\s)@([a-z0-9-]*)$/i.exec(text.slice(0, caret));
    if (!m) return null;
    return { start: m.index === 0 ? 0 : m.index + 1, query: m[1].toLowerCase() };
  }

  function syncMentionState(text: string, caret: number) {
    if (isComposing) return;
    const token = detectMentionToken(text, caret);
    if (token) { setMentionOpen(true); setMentionQuery(token.query); setMentionIndex(0); }
    else if (mentionOpen) setMentionOpen(false);
  }

  function insertMention(agent: AgentName) {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? composerText.length;
    const token = detectMentionToken(composerText, caret);
    const start = token?.start ?? caret;
    const inserted = `@${agent} `;
    setComposerText(`${composerText.slice(0, start)}${inserted}${composerText.slice(caret)}`);
    setMentionOpen(false); setMentionQuery(""); setMentionIndex(0); pickAgent(agent);
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus(); node.setSelectionRange(start + inserted.length, start + inserted.length);
    });
  }

  async function cancelActiveRun() {
    if (!selectedSandbox || !activeRun) return;
    try {
      const session = await cancelRun(selectedSandbox.id, activeRun.sessionId, selectedToken);
      setSelectedSessionId(session.id);
      setStatus({ tone: "warn", message: `Cancel requested for ${activeRun.sessionId}.` });
      await refresh();
    } catch (err) {
      setStatus({ tone: "bad", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function sendDecision(kind: "approve" | "reject" | "rerun" | "mark_done") {
    if (!activeSession) return;
    try {
      const session = await recordDecision(activeSession.id, kind, undefined, selectedToken);
      setSelectedSessionId(session.id);
      setStatus({ tone: "good", message: `${kind.replace("_", " ")} recorded.` });
      await refresh();
    } catch (err) {
      setStatus({ tone: "bad", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function sendHandoff() {
    if (!activeSession) return;
    try {
      const session = await recordHandoff(activeSession.id, handoffAgent, defaultModeForAgent(handoffAgent), handoffNote.trim() || undefined, selectedToken);
      setSelectedSessionId(session.id); setHandoffNote(""); setHandoffOpen(false); setActiveAgent(handoffAgent);
      setStatus({ tone: "good", message: `Conversation handed to ${handoffAgent}.` });
      await refresh();
    } catch (err) {
      setStatus({ tone: "bad", message: err instanceof Error ? err.message : String(err) });
    }
  }

  function pickAgent(agent: AgentName) { setActiveAgent(agent); setAgentPickerOpen(false); }

  const filteredMentionAgents = mentionQuery ? agents.filter((a) => a.startsWith(mentionQuery)) : agents;

  return (
    <main className="messenger-shell" data-settings={settingsOpen ? "open" : "closed"} data-mobile-view={mobileView}>
      <a className="skip-link" href="#chat-panel">Skip to Conversation</a>

      <div className="mobile-topbar" aria-label="Mobile workspace switcher">
        <button type="button" className={mobileView === "threads" ? "active" : ""} aria-label="Conversations" aria-pressed={mobileView === "threads"} onClick={() => setMobileView("threads")}>
          <MessageCircle size={16} /><span>Chats</span>
        </button>
        <button type="button" className={mobileView === "chat" ? "active" : ""} aria-pressed={mobileView === "chat"} onClick={() => setMobileView("chat")}>
          <span translate="no">@{selectedEmployee}</span>
        </button>
        <button type="button" className={`mobile-settings ${settingsOpen ? "active" : ""}`} aria-label="Settings" aria-controls="settings-drawer" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((v) => !v)}>
          <Settings size={16} />
        </button>
      </div>

      <aside className="people-panel" aria-label="Relay navigation">
        <div className="brand-mark">
          <RelayMark width={40} height={27} />
          <span className="badge-pill">Workforce control</span>
        </div>
        <nav className="side-nav" aria-label="Workspace sections">
          <button className="active" type="button" aria-label="Chat" aria-pressed="true">
            <MessageCircle size={16} /><span>Chat</span><small>{employeeContacts.length}</small>
          </button>
          <button type="button" aria-label="Sandboxes" aria-pressed={settingsOpen} onClick={() => setSettingsOpen((v) => !v)}>
            <UserRound size={16} /><span>Sandboxes</span><small>{sandboxes.length}</small>
          </button>
        </nav>
        <button className="people-settings" type="button" aria-controls="settings-drawer" aria-expanded={settingsOpen} aria-label="Workspace settings" onClick={() => setSettingsOpen((v) => !v)}>
          <Settings size={15} /><span>Workspace settings</span>
        </button>
      </aside>

      <aside className="thread-panel" aria-label="Employee conversations">
        <div className="conversation-header">
          <div className="conversation-heading">
            <h1>Conversations<small className="mono conversation-heading-count">{filteredEmployees.length.toString().padStart(2, "0")}</small></h1>
          </div>
          <button type="button" aria-label="Refresh" onClick={() => void refresh()}>
            <RefreshCw size={16} className={isRefreshing ? "spin" : ""} />
          </button>
        </div>
        <form className="people-search conversation-search" onSubmit={(e) => { e.preventDefault(); void selectEmployee(employeeQuery); }}>
          <Search size={15} />
          <input aria-label="Search employee conversations" name="employee-search" autoComplete="off" spellCheck={false} placeholder="Search conversations…" value={employeeQuery} onChange={(e) => setEmployeeQuery(e.target.value)} />
          {employeeSearchCanStart ? <button type="submit" aria-label={`Open workspace for ${employeeQuery}`}><Plus size={15} /></button> : null}
        </form>
        <section className="conversation-list" aria-label="Employee conversation list">
          {filteredEmployees.map((c) => <ConversationRow key={c.id} contact={c} selected={selectedEmployee === c.id} onSelect={(id) => void selectEmployee(id)} />)}
          {filteredEmployees.length === 0 ? <NewConversationRow employeeQuery={employeeQuery} onSelect={(id) => void selectEmployee(id)} /> : null}
        </section>
      </aside>

      <section id="chat-panel" className="chat-panel" aria-label="Active employee agent conversation" tabIndex={-1}>
        <header className="chat-header">
          <div className="chat-title">
            <button className="mobile-back-button" type="button" onClick={() => setMobileView("threads")}>
              <MessageCircle size={16} /><span>Conversations</span>
            </button>
            <EmployeeAvatar employeeId={selectedEmployee} running={Boolean(activeRun)} />
            <div>
              <p>
                <span translate="no">@{selectedEmployee}</span>
                <span className="header-separator" aria-hidden="true" />
                <span translate="no">{activeAgent}</span>
                {activeSession ? <><span className="header-separator" aria-hidden="true" /><span className="session-id">{activeSession.id.slice(0, 8)}</span></> : null}
              </p>
              <h2>{activeSession ? activeSession.taskGoal : "New conversation"}</h2>
            </div>
          </div>
          <div className="chat-tools">
            <div className="header-agent-tabs" aria-label="Talk to agent">
              {agents.map((a) => <button key={a} type="button" aria-pressed={a === activeAgent} className={a === activeAgent ? "active" : ""} onClick={() => setActiveAgent(a)}><span translate="no">@{a}</span></button>)}
            </div>
            {activeSession ? <StatusPill value={activeSession.status} /> : null}
            <button className={`icon-button ${settingsOpen ? "active" : ""}`} type="button" aria-label="Settings" aria-controls="settings-drawer" aria-expanded={settingsOpen} title="Settings" onClick={() => setSettingsOpen((v) => !v)}>
              <Settings size={16} />
            </button>
          </div>
        </header>

        <div className={`toast ${status.tone}`} data-visible={toastVisible} role="status" aria-live="polite">
          {toastVisible ? status.message : null}
        </div>

        <div className="transcript" ref={transcriptRef} onScroll={handleTranscriptScroll}>
          <div className="transcript-inner">
            {activeSession ? (
              <>
                {messages.map((msg, i) => <MessageBlock key={msg.id} message={msg} employeeId={selectedEmployee} sessionId={activeSession.id} grouped={isGroupedContinuation(messages, i)} />)}
                {awaitingDecision ? <DecisionBar sendDecision={sendDecision} handoffOpen={handoffOpen} setHandoffOpen={setHandoffOpen} handoffAgent={handoffAgent} setHandoffAgent={setHandoffAgent} handoffNote={handoffNote} setHandoffNote={setHandoffNote} sendHandoff={sendHandoff} /> : null}
              </>
            ) : (
              <TranscriptEmpty selectedEmployee={selectedEmployee} activeAgent={activeAgent} agentDescriptors={agentDescriptors} />
            )}
          </div>
        </div>

        <form className="composer" onSubmit={(e) => { e.preventDefault(); void sendMessage(); }}>
          <div className="composer-toolbar">
            <AgentPicker activeAgent={activeAgent} agentPickerOpen={agentPickerOpen} setAgentPickerOpen={setAgentPickerOpen} pickAgent={pickAgent} />
            {activeRun ? <button type="button" className="cancel-run" onClick={() => void cancelActiveRun()}><CircleStop size={14} /> Cancel run</button> : null}
          </div>
          <div className="composer-input-wrap">
            {mentionOpen && filteredMentionAgents.length > 0 ? <MentionPopover filteredAgents={filteredMentionAgents} mentionIndex={mentionIndex} insertMention={insertMention} /> : null}
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
                onChange={(e) => { setComposerText(e.target.value); syncMentionState(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
                onKeyUp={(e) => { if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") syncMentionState(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length); }}
                onSelect={(e) => syncMentionState(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={(e) => { setIsComposing(false); syncMentionState(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length); }}
                onBlur={() => setMentionOpen(false)}
                onKeyDown={(e) => {
                  if (mentionOpen && filteredMentionAgents.length > 0) {
                    if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => (i + 1) % filteredMentionAgents.length); return; }
                    if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => (i - 1 + filteredMentionAgents.length) % filteredMentionAgents.length); return; }
                    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(filteredMentionAgents[mentionIndex]); return; }
                    if (e.key === "Escape") { e.preventDefault(); setMentionOpen(false); return; }
                  }
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); }
                }}
                rows={2}
              />
              <button type="submit" className="send-button" disabled={isRunning || !composerText.trim()} aria-label="Send" title="Send">
                <CornerDownLeft size={18} />
              </button>
            </div>
          </div>
        </form>
      </section>

      <SettingsDrawer
        open={settingsOpen} onClose={() => setSettingsOpen(false)} quickUsers={quickUsers}
        selectedEmployee={selectedEmployee} customEmployee={customEmployee} setCustomEmployee={setCustomEmployee}
        selectEmployee={selectEmployee} tokenInput={tokenInput} setTokenInput={setTokenInput} saveToken={saveToken}
        selectedSandbox={selectedSandbox} selectedNode={selectedNode} activeRun={activeRun} onCancelRun={cancelActiveRun}
      />
    </main>
  );
}
