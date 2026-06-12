"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AtSign, Check, ChevronRight, CircleStop, CornerDownLeft, GitBranch,
  MessageCircle, Plug2, Plus, RefreshCw, Search, Settings, Sparkles, Terminal, Users,
} from "lucide-react";
import {
  cancelRun, createSession, listControlPanelDaemonNodes, provisionSandbox,
  recordDecision, recordHandoff, runSandbox,
} from "./api";
import type { AgentName, CodexTaskMode, ControlPanelDaemonNodeRecord, SandboxRecord, Tone } from "./types";
import { RelayMark } from "./components/RelayMark";
import { EmployeeAvatar } from "./components/EmployeeAvatar";
import { StatusPill } from "./components/StatusPill";
import { TranscriptEmpty } from "./components/TranscriptEmpty";
import { MessageBlock, projectMessages, isGroupedContinuation } from "./components/MessageBlock";
import type { DerivedMessage } from "./components/MessageBlock";
import { AdminConsole } from "./components/AdminConsole";
import { McpPage } from "./components/McpPage";
import { SkillsPage } from "./components/SkillsPage";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { PreferencesDrawer } from "./components/PreferencesDrawer";
import { SUPPORTED_LANGUAGES, type Theme, type Language } from "./components/PreferencesDrawer";
import { ConversationRow } from "./components/ConversationRow";
import type { EmployeeContact } from "./components/ConversationRow";
import { useRelayData } from "./hooks/useRelayData";
import { mergeVisibleDaemonNodes, shouldClaimLocalDaemonNode } from "./lib/daemonNodes";
import "./i18n";

const agents: AgentName[] = ["claude", "pi", "codex"];
const tokenStorageKey = "relay-web.tokens";
const selectedEmployeeKey = "relay-web.selectedEmployee";
const themeStorageKey = "relay-web.theme";
const languageStorageKey = "relay-web.language";
const AGENT_INITIALS: Record<AgentName, string> = { claude: "C", pi: "π", codex: "X" };

function defaultModeForAgent(agent: AgentName): CodexTaskMode {
  return agent === "codex" ? "review" : "implement";
}

type TokenMap = Record<string, string>;
type MobileView = "threads" | "chat";
type AppRoute = "main" | "admin" | "mcp" | "skills";

function readTokens(): TokenMap {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(tokenStorageKey) ?? "null") as TokenMap ?? {}; }
  catch { return {}; }
}

function writeTokens(tokens: TokenMap): void {
  if (typeof window !== "undefined") localStorage.setItem(tokenStorageKey, JSON.stringify(tokens));
}

function readTheme(): Theme {
  if (typeof window === "undefined") return "system";
  return (localStorage.getItem(themeStorageKey) as Theme | null) ?? "system";
}

function readLanguage(): Language {
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem(languageStorageKey);
  return SUPPORTED_LANGUAGES.includes(stored as Language) ? stored as Language : "en";
}

function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

function canUseLocalControlPanel(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "::1";
}

function newBrowserSandboxToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return `tok_${btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
}

async function localControlPanelNodes(): Promise<ControlPanelDaemonNodeRecord[]> {
  if (!canUseLocalControlPanel()) return [];
  try {
    return (await listControlPanelDaemonNodes()).nodes;
  } catch {
    return [];
  }
}

function sessionBelongsToEmployee(
  session: { workspacePath: string },
  employeeId: string,
  sandbox?: SandboxRecord,
  node?: { workspacePath?: string },
): boolean {
  if (sandbox && session.workspacePath === sandbox.workspacePath) return true;
  if (node?.workspacePath && session.workspacePath === node.workspacePath) return true;
  return session.workspacePath === `/workspace/${employeeId}` || session.workspacePath.endsWith(`/${employeeId}`);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AgentPicker({ activeAgent, agentPickerOpen, setAgentPickerOpen, pickAgent }: {
  activeAgent: AgentName; agentPickerOpen: boolean;
  setAgentPickerOpen: (v: boolean) => void; pickAgent: (a: AgentName) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="agent-picker-wrap">
      <button type="button" className="agent-picker-trigger" aria-label={t("composer.choose_agent")} aria-controls="agent-picker" aria-expanded={agentPickerOpen} onClick={() => setAgentPickerOpen(!agentPickerOpen)}>
        <AtSign size={14} /><span translate="no">{activeAgent}</span>
      </button>
      {agentPickerOpen ? (
        <div id="agent-picker" className="agent-picker" aria-label={t("composer.choose_agent")}>
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
  const { t } = useTranslation();
  return (
    <div id="mention-popover" className="mention-popover agent-picker" role="listbox" aria-label={t("composer.address_agent")}>
      {filteredAgents.map((a, i) => (
        <button key={a} id={`mention-option-${i}`} type="button" role="option" aria-selected={i === mentionIndex} className={i === mentionIndex ? "active" : ""} onMouseDown={(e) => { e.preventDefault(); insertMention(a); }}>
          <span className="agent-avatar" aria-hidden="true">{AGENT_INITIALS[a]}</span>
          <span translate="no">@{a}</span>
          <span className="mention-role">{t(`agent.${a}.role`)}</span>
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
  const { t } = useTranslation();
  return (
    <>
      <div className="decision-bar">
        <button type="button" onClick={() => void sendDecision("approve")}><Check size={14} /> {t("decision.approve")}</button>
        <button type="button" onClick={() => void sendDecision("rerun")}>{t("decision.rerun")}</button>
        <button type="button" onClick={() => void sendDecision("mark_done")}>{t("decision.mark_done")}</button>
        <button type="button" className="danger-soft" onClick={() => void sendDecision("reject")}>{t("decision.reject")}</button>
        <button type="button" className="primary" aria-controls="handoff-panel" aria-expanded={handoffOpen} onClick={() => setHandoffOpen(!handoffOpen)}>
          <GitBranch size={14} /> {t("decision.handoff")}
        </button>
      </div>
      {handoffOpen ? (
        <div id="handoff-panel" className="handoff-panel">
          <div className="handoff-row">
            <label htmlFor="handoff-agent">{t("handoff.route_to")}</label>
            <select id="handoff-agent" name="handoff-agent" value={handoffAgent} onChange={(e) => setHandoffAgent(e.target.value as AgentName)}>
              {agents.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <input aria-label={t("handoff.note_placeholder")} name="handoff-note" autoComplete="off" placeholder={t("handoff.note_placeholder")} value={handoffNote} onChange={(e) => setHandoffNote(e.target.value)} />
          <div className="handoff-actions">
            <button type="button" onClick={() => setHandoffOpen(false)}>{t("handoff.cancel")}</button>
            <button type="button" className="primary" onClick={() => void sendHandoff()}>{t("handoff.send")}</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export function App() {
  const { t, i18n } = useTranslation();
  const [selectedEmployee, setSelectedEmployee] = useState("");
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
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>("chat");
  const [route, setRoute] = useState<AppRoute>("main");
  const [sidenavExpanded, setSidenavExpanded] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [language, setLanguage] = useState<Language>(readLanguage);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffAgent, setHandoffAgent] = useState<AgentName>("codex");
  const [handoffNote, setHandoffNote] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<{ tone: Tone; message: string }>({ tone: "info", message: t("toast.open_workspace_to_begin") });
  const [toastVisible, setToastVisible] = useState(false);
  const [localNodes, setLocalNodes] = useState<ControlPanelDaemonNodeRecord[]>([]);
  const statusSeenRef = useRef(false);
  const localNodeAdoptionStartedRef = useRef(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const selectedEmployeeToken = tokens[selectedEmployee];
  const { sandboxes, nodes, sessions, isRefreshing, refresh, setSandboxes } = useRelayData(setStatus, selectedEmployeeToken);
  const visibleNodes = useMemo(() => mergeVisibleDaemonNodes(nodes, localNodes), [nodes, localNodes]);
  const agentDescriptors = useMemo<Record<AgentName, { role: string; blurb: string }>>(() => ({
    claude: { role: t("agent.claude.role"), blurb: t("agent.claude.blurb") },
    pi: { role: t("agent.pi.role"), blurb: t("agent.pi.blurb") },
    codex: { role: t("agent.codex.role"), blurb: t("agent.codex.blurb") },
  }), [t]);

  useEffect(() => {
    if (!statusSeenRef.current) { statusSeenRef.current = true; return; }
    setToastVisible(true);
    const t = window.setTimeout(() => setToastVisible(false), 4000);
    return () => window.clearTimeout(t);
  }, [status]);

  const selectedSandbox = useMemo(() => sandboxes.find((s) => s.employeeId === selectedEmployee), [sandboxes, selectedEmployee]);
  const selectedNode = useMemo(() => visibleNodes.find((n) => n.employeeId === selectedEmployee || n.id === selectedSandbox?.id), [visibleNodes, selectedEmployee, selectedSandbox?.id]);
  const sandboxWorkspace = selectedSandbox?.workspacePath ?? selectedNode?.workspacePath;
  const sandboxSessions = useMemo(() => sessions.filter((s) => !sandboxWorkspace || s.workspacePath === sandboxWorkspace), [sessions, sandboxWorkspace]);
  const threadSessions = useMemo(() => sandboxSessions.filter((s) => s.agentRuns.some((r) => r.agent === activeAgent)), [sandboxSessions, activeAgent]);
  const activeSession = useMemo(() => {
    if (selectedSessionId) { const p = sessions.find((s) => s.id === selectedSessionId); if (p) return p; }
    return threadSessions[0];
  }, [selectedSessionId, sessions, threadSessions]);

  const selectedToken = selectedSandbox ? (tokens[selectedSandbox.id] ?? tokens[selectedEmployee]) : tokens[selectedEmployee];
  const activeRun = selectedNode?.activeRuns[0];
  const messages = useMemo<DerivedMessage[]>(() => projectMessages(activeSession), [activeSession]);
  const selectedEmployeeLabel = selectedEmployee ? `@${selectedEmployee}` : t("thread.no_employee_selected");

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
    // 1. Seed from persisted tokens — employees appear immediately on load, before any API response
    for (const key of Object.keys(tokens)) {
      if (key.startsWith("sbx_")) continue;
      byId.set(key, { id: key, sandbox: undefined, node: undefined, activeRun: undefined, sessionCount: 0 });
    }
    // 2. Enrich with live daemon nodes (adds status + active run data)
    for (const node of visibleNodes) {
      const eid = node.employeeId ?? sandboxes.find((s) => s.id === node.id)?.employeeId;
      if (!eid) continue;
      byId.set(eid, {
        id: eid,
        sandbox: sandboxes.find((s) => s.id === node.id || s.employeeId === eid),
        node,
        activeRun: node.activeRuns[0],
        sessionCount: 0,
      });
    }
    // 3. Enrich with provisioned sandboxes not yet backed by a node
    for (const sandbox of sandboxes) {
      if (!sandbox.employeeId) continue;
      const existing = byId.get(sandbox.employeeId);
      if (existing && existing.node) continue;
      byId.set(sandbox.employeeId, {
        id: sandbox.employeeId,
        sandbox,
        node: existing?.node,
        activeRun: existing?.activeRun,
        sessionCount: 0,
      });
    }
    for (const c of byId.values()) {
      const rel = sessions.filter((s) => sessionBelongsToEmployee(s, c.id, c.sandbox, c.node));
      c.sessionCount = rel.length; c.lastSession = rel[0];
    }
    return [...byId.values()].sort((a, b) => {
      if (a.id === selectedEmployee) return -1;
      if (b.id === selectedEmployee) return 1;
      if (a.activeRun && !b.activeRun) return -1;
      if (b.activeRun && !a.activeRun) return 1;
      return a.id.localeCompare(b.id);
    });
  }, [visibleNodes, sandboxes, selectedEmployee, sessions, tokens]);
  const registeredEmployeeIds = useMemo(() => employeeContacts.map((contact) => contact.id), [employeeContacts]);

  const filteredEmployees = useMemo(() => {
    const q = employeeQuery.trim().toLowerCase();
    if (!q) return employeeContacts;
    return employeeContacts.filter((c) => c.id.toLowerCase().includes(q) || (c.lastSession?.taskGoal.toLowerCase() ?? "").includes(q));
  }, [employeeContacts, employeeQuery]);

  const refreshWithToken = useCallback(async (tokenOverride?: string) => {
    await refresh(undefined, tokenOverride);
  }, [refresh]);

  const refreshLocalDaemonNodes = useCallback(async () => {
    const nextNodes = await localControlPanelNodes();
    setLocalNodes(nextNodes);
    return nextNodes;
  }, []);

  const adoptLocalDaemonNodes = useCallback(async () => {
    const controlPanelNodes = await refreshLocalDaemonNodes();
    const claimable = controlPanelNodes.filter((node) => shouldClaimLocalDaemonNode(node, nodes));
    if (claimable.length === 0) return;

    const nextTokens = { ...tokens };
    const adoptedSandboxes: SandboxRecord[] = [];
    for (const node of claimable) {
      if (!node.nodeToken) continue;
      const uiToken = newBrowserSandboxToken();
      try {
        const sandbox = await provisionSandbox(node.employeeId, uiToken, node.nodeToken);
        nextTokens[node.employeeId] = uiToken;
        nextTokens[sandbox.id] = uiToken;
        adoptedSandboxes.push(sandbox);
      } catch {
        // A node may already belong to another browser token; leave it untouched.
      }
    }

    if (adoptedSandboxes.length === 0) return;
    setTokens(nextTokens);
    writeTokens(nextTokens);
    setSandboxes((cur) => [
      ...adoptedSandboxes,
      ...cur.filter((sandbox) => !adoptedSandboxes.some((adopted) => adopted.id === sandbox.id)),
    ]);
    setStatus({
      tone: "info",
      message: t("toast.connected_nodes", { count: adoptedSandboxes.length }),
    });
    await refreshWithToken(nextTokens[selectedEmployee] ?? nextTokens[adoptedSandboxes[0].id]);
  }, [nodes, refreshLocalDaemonNodes, refreshWithToken, selectedEmployee, setSandboxes, t, tokens]);

  useEffect(() => {
    const stored = localStorage.getItem(selectedEmployeeKey);
    const storedTokens = readTokens();
    setTokens(storedTokens);
    if (stored) {
      setSelectedEmployee(stored);
    } else {
      const firstEmployeeToken = Object.keys(storedTokens).find((key) => !key.startsWith("sbx_"));
      if (firstEmployeeToken) setSelectedEmployee(firstEmployeeToken);
    }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated || localNodeAdoptionStartedRef.current) return;
    localNodeAdoptionStartedRef.current = true;
    void adoptLocalDaemonNodes();
  }, [adoptLocalDaemonNodes, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    void refreshLocalDaemonNodes();
    const timer = window.setInterval(() => void refreshLocalDaemonNodes(), 3000);
    return () => window.clearInterval(timer);
  }, [hydrated, refreshLocalDaemonNodes]);
  useEffect(() => {
    if (!hydrated) return;
    if (selectedEmployee) {
      localStorage.setItem(selectedEmployeeKey, selectedEmployee);
      setTokenInput(tokens[selectedEmployee] ?? "");
    } else {
      localStorage.removeItem(selectedEmployeeKey);
      setTokenInput("");
    }
  }, [selectedEmployee, tokens, hydrated]);
  useEffect(() => {
    if (!hydrated || employeeContacts.length === 0) return;
    if (!employeeContacts.some((contact) => contact.id === selectedEmployee)) {
      setSelectedEmployee(employeeContacts[0].id);
    }
  }, [employeeContacts, hydrated, selectedEmployee]);
  useEffect(() => { setSelectedSessionId(undefined); }, [activeAgent, selectedEmployee]);
  useEffect(() => {
    const el = transcriptRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, activeSession?.id]);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(languageStorageKey, language);
    document.documentElement.lang = language;
    void i18n.changeLanguage(language);
  }, [i18n, language]);

  function handleTranscriptScroll(): void {
    const el = transcriptRef.current;
    if (el) atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }

  async function selectEmployee(employeeId: string) {
    const next = employeeId.trim().replace(/^@/, "");
    if (!next) return;
    setSelectedEmployee(next); setMobileView("chat");
    let token = next === selectedEmployee ? tokenInput.trim() || tokens[next] : tokens[next];
    let nodeToken: string | undefined;
    try {
      setStatus({ tone: "info", message: t("toast.opening_workspace", { employee: next }) });
      if (!token) {
        const node = (await localControlPanelNodes()).find((item) => item.employeeId === next);
        if (node?.nodeToken) {
          token = newBrowserSandboxToken();
          nodeToken = node.nodeToken;
        }
      }
      const sandbox = await provisionSandbox(next, token, nodeToken);
      const nextTokens = { ...tokens };
      const savedToken = sandbox.token ?? token;
      if (savedToken) {
        nextTokens[sandbox.id] = savedToken;
        nextTokens[next] = savedToken;
        setTokens(nextTokens); writeTokens(nextTokens);
      }
      setSandboxes((cur) => [sandbox, ...cur.filter((s) => s.id !== sandbox.id)]);
      setStatus({ tone: "good", message: t("toast.workspace_ready", { employee: next }) });
      await refreshWithToken(nextTokens[sandbox.id] ?? nextTokens[next] ?? token);
    } catch (err) {
      setStatus({ tone: "bad", message: err instanceof Error ? err.message : String(err) });
    }
  }

  function removeEmployee(employeeId: string) {
    const nextTokens = { ...tokens };
    delete nextTokens[employeeId];
    // Also remove any sandbox token keys that belong to this employee
    for (const key of Object.keys(nextTokens)) {
      if (nextTokens[key] === tokens[employeeId] && key.startsWith("sbx_")) {
        delete nextTokens[key];
      }
    }
    setTokens(nextTokens); writeTokens(nextTokens);
    if (selectedEmployee === employeeId) setSelectedEmployee("");
  }

  function saveToken() {
    const token = tokenInput.trim();
    const nextTokens = { ...tokens };
    if (selectedSandbox) nextTokens[selectedSandbox.id] = token;
    nextTokens[selectedEmployee] = token;
    setTokens(nextTokens); writeTokens(nextTokens);
    setStatus({ tone: "info", message: token ? t("toast.token_saved") : t("toast.token_cleared") });
  }

  async function sendMessage() {
    const raw = composerText.trim();
    if (!raw) return;
    if (!selectedEmployee) {
      setStatus({ tone: "warn", message: t("toast.no_node_selected") });
      return;
    }
    const mm = /^@(claude|pi|codex)(?:\s+|$)/i.exec(raw);
    const routedAgent: AgentName = (mm?.[1].toLowerCase() as AgentName | undefined) ?? activeAgent;
    const goal = mm ? raw.slice(mm[0].length).trim() : raw;
    if (!goal) { setStatus({ tone: "warn", message: t("toast.add_task", { agent: routedAgent }) }); return; }
    if (!selectedSandbox) {
      setStatus({ tone: "warn", message: t("toast.open_sandbox") });
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
        setStatus({ tone: "good", message: t("toast.message_sent", { employee: selectedEmployee, agent: routedAgent }) });
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
      setStatus({ tone: "warn", message: t("toast.cancel_requested", { sessionId: activeRun.sessionId }) });
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
      setStatus({ tone: "good", message: t("toast.decision_recorded", { kind: t(`decision.${kind}`) }) });
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
      setStatus({ tone: "good", message: t("toast.handed_to", { agent: handoffAgent }) });
      await refresh();
    } catch (err) {
      setStatus({ tone: "bad", message: err instanceof Error ? err.message : String(err) });
    }
  }

  function pickAgent(agent: AgentName) { setActiveAgent(agent); setAgentPickerOpen(false); }

  const filteredMentionAgents = mentionQuery ? agents.filter((a) => a.startsWith(mentionQuery)) : agents;

  return (
    <main className="messenger-shell" data-settings={settingsOpen ? "open" : "closed"} data-mobile-view={mobileView} data-route={route} data-sidenav={sidenavExpanded ? "open" : "closed"}>
      <a className="skip-link" href="#chat-panel">{t("skip_to_conversation")}</a>

      <div className="mobile-topbar" aria-label={t("nav.conversations")}>
        <button type="button" className={mobileView === "threads" ? "active" : ""} aria-label={t("nav.conversations")} aria-pressed={mobileView === "threads"} onClick={() => setMobileView("threads")}>
          <MessageCircle size={16} /><span>{t("nav.chats")}</span>
        </button>
        <button type="button" className={mobileView === "chat" ? "active" : ""} aria-pressed={mobileView === "chat"} onClick={() => setMobileView("chat")}>
          <span translate={selectedEmployee ? "no" : undefined}>{selectedEmployeeLabel}</span>
        </button>
        <button type="button" className={`mobile-settings ${settingsOpen ? "active" : ""}`} aria-label={t("nav.settings")} aria-controls="settings-drawer" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((v) => !v)}>
          <Settings size={16} />
        </button>
      </div>

      <aside className="sidenav-panel" aria-label="Relay" data-expanded={sidenavExpanded ? "true" : "false"}>
        <div className="sidenav-brand" aria-hidden="true">
          <RelayMark width={28} height={19} />
          <span className="sidenav-brand-word">Relay</span>
        </div>
        <nav className="sidenav-nav" aria-label={t("nav.conversations")}>
          <button
            className={`sidenav-btn ${route === "main" ? "active" : ""}`}
            type="button"
            aria-label={t("nav.conversations")}
            aria-pressed={route === "main"}
            title={t("nav.conversations")}
            onClick={() => setRoute("main")}
          >
            <MessageCircle size={18} />
            <span>{t("nav.conversations")}</span>
          </button>
          <button
            className={`sidenav-btn ${settingsOpen ? "active" : ""}`}
            type="button"
            aria-label={t("nav.sandboxes")}
            aria-pressed={settingsOpen}
            title={t("nav.sandboxes")}
            onClick={() => setSettingsOpen((v) => !v)}
          >
            <Users size={18} />
            <span>{t("nav.sandboxes")}</span>
          </button>
          <button
            className={`sidenav-btn ${route === "admin" ? "active" : ""}`}
            type="button"
            aria-label={t("nav.admin_label")}
            aria-pressed={route === "admin"}
            title={t("nav.admin_label")}
            onClick={() => setRoute((r) => r === "admin" ? "main" : "admin")}
          >
            <Terminal size={18} />
            <span>{t("nav.admin")}</span>
          </button>
          <button
            className={`sidenav-btn ${route === "mcp" ? "active" : ""}`}
            type="button"
            aria-label={t("nav.mcp_label")}
            aria-pressed={route === "mcp"}
            title={t("nav.mcp_label")}
            onClick={() => setRoute((r) => r === "mcp" ? "main" : "mcp")}
          >
            <Plug2 size={18} />
            <span>{t("nav.mcp")}</span>
          </button>
          <button
            className={`sidenav-btn ${route === "skills" ? "active" : ""}`}
            type="button"
            aria-label={t("nav.skills_label")}
            aria-pressed={route === "skills"}
            title={t("nav.skills_label")}
            onClick={() => setRoute((r) => r === "skills" ? "main" : "skills")}
          >
            <Sparkles size={18} />
            <span>{t("nav.skills")}</span>
          </button>
        </nav>
        <div className="sidenav-bottom">
          <button
            type="button"
            aria-label={sidenavExpanded ? t("nav.collapse_sidebar") : t("nav.expand_sidebar")}
            className="sidenav-btn sidenav-toggle"
            onClick={() => setSidenavExpanded((v) => !v)}
            title={sidenavExpanded ? t("nav.collapse_sidebar") : t("nav.expand_sidebar")}
          >
            <ChevronRight size={16} className={sidenavExpanded ? "sidenav-chevron-open" : ""} />
            <span>{sidenavExpanded ? t("nav.collapse") : t("nav.expand")}</span>
          </button>
          <button
            type="button"
            aria-label={t("nav.refresh")}
            className="sidenav-btn"
            onClick={() => void refresh()}
            title={t("nav.refresh")}
          >
            <RefreshCw size={16} className={isRefreshing ? "spin" : ""} />
            <span>{t("nav.refresh")}</span>
          </button>
          <button
            className={`sidenav-btn ${preferencesOpen ? "active" : ""}`}
            type="button"
            aria-controls="preferences-drawer"
            aria-expanded={preferencesOpen}
            aria-label={t("nav.preferences")}
            title={t("nav.preferences")}
            onClick={() => setPreferencesOpen((v) => !v)}
          >
            <Settings size={18} />
            <span>{t("nav.preferences")}</span>
          </button>
        </div>
      </aside>

      {route === "admin" ? <AdminConsole /> : route === "mcp" ? <McpPage /> : route === "skills" ? <SkillsPage /> : (<>

      <aside className="thread-panel" aria-label={t("nav.conversations")}>
        <div className="conversation-header">
          <div className="conversation-heading">
            <h1>{t("thread.messages")}<small className="mono conversation-heading-count">{filteredEmployees.length.toString().padStart(2, "0")}</small></h1>
          </div>
        </div>
        <form className="people-search conversation-search" onSubmit={(e) => {
          e.preventDefault();
          const q = employeeQuery.trim().replace(/^@/, "");
          if (q) { void selectEmployee(q); setEmployeeQuery(""); }
        }}>
          <Search size={16} />
          <input aria-label={t("thread.search_label")} name="employee-search" autoComplete="off" spellCheck={false} placeholder={t("thread.search_placeholder")} value={employeeQuery} onChange={(e) => setEmployeeQuery(e.target.value)} />
          {employeeQuery.trim() ? (
            <button type="submit" className="search-connect-btn" aria-label={t("thread.connect_to", { name: employeeQuery.trim().replace(/^@/, "") })} title={t("thread.connect_hint")}>
              <Plus size={13} />
            </button>
          ) : null}
        </form>
        <section className="conversation-list" aria-label={t("nav.conversations")}>
          {filteredEmployees.map((c) => <ConversationRow key={c.id} contact={c} selected={selectedEmployee === c.id} onSelect={(id) => void selectEmployee(id)} onRemove={removeEmployee} />)}
          {filteredEmployees.length === 0 && !employeeQuery.trim() ? (
            <p className="conversation-empty">{t("thread.no_nodes")}</p>
          ) : null}
          {filteredEmployees.length === 0 && employeeQuery.trim() ? (
            <button
              className="conversation-row conversation-connect-hint"
              type="button"
              onClick={() => { const q = employeeQuery.trim().replace(/^@/, ""); if (q) { void selectEmployee(q); setEmployeeQuery(""); } }}
            >
              <span className="connect-hint-icon" aria-hidden="true"><Plus size={14} /></span>
              <span className="conversation-copy">
                <span className="conversation-name"><strong translate="no">@{employeeQuery.trim().replace(/^@/, "")}</strong></span>
                <span className="conversation-preview">{t("thread.connect_hint")}</span>
              </span>
            </button>
          ) : null}
        </section>
      </aside>

      <section id="chat-panel" className="chat-panel" aria-label={t("nav.conversations")} tabIndex={-1}>
        <header className="chat-header">
          <div className="chat-title">
            <button className="mobile-back-button" type="button" onClick={() => setMobileView("threads")}>
              <MessageCircle size={16} /><span>{t("nav.conversations")}</span>
            </button>
            <EmployeeAvatar employeeId={selectedEmployee} running={Boolean(activeRun)} />
            <div>
              <p>
                {selectedEmployee ? (
                  <span translate="no">@{selectedEmployee}</span>
                ) : (
                  <span>{t("thread.no_employee_selected")}</span>
                )}
                <span className="header-separator" aria-hidden="true" />
                <span translate="no">{activeAgent}</span>
                {activeSession ? <><span className="header-separator" aria-hidden="true" /><span className="session-id">{activeSession.id.slice(0, 8)}</span></> : null}
              </p>
              <h2>{activeSession ? activeSession.taskGoal : t("thread.new_conversation")}</h2>
            </div>
          </div>
          <div className="chat-tools">
            <div className="header-agent-tabs" aria-label={t("thread.talk_to_agent")}>
              {agents.map((a) => <button key={a} type="button" aria-pressed={a === activeAgent} className={a === activeAgent ? "active" : ""} onClick={() => setActiveAgent(a)}><span translate="no">@{a}</span></button>)}
            </div>
            {activeSession ? <StatusPill value={activeSession.status} /> : null}
            <button className={`icon-button ${settingsOpen ? "active" : ""}`} type="button" aria-label={t("nav.settings")} aria-controls="settings-drawer" aria-expanded={settingsOpen} title={t("nav.settings")} onClick={() => setSettingsOpen((v) => !v)}>
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
            {activeRun ? <button type="button" className="cancel-run" onClick={() => void cancelActiveRun()}><CircleStop size={14} /> {t("composer.cancel_run")}</button> : null}
          </div>
          <div className="composer-input-wrap">
            {mentionOpen && filteredMentionAgents.length > 0 ? <MentionPopover filteredAgents={filteredMentionAgents} mentionIndex={mentionIndex} insertMention={insertMention} /> : null}
            <div className="composer-input">
              <textarea
                ref={textareaRef}
                aria-label={selectedEmployee
                  ? t("composer.aria_label", { employee: selectedEmployee, agent: activeAgent })
                  : t("composer.aria_label_no_employee", { agent: activeAgent })}
                aria-controls={mentionOpen ? "mention-popover" : undefined}
                aria-expanded={mentionOpen}
                aria-activedescendant={mentionOpen ? `mention-option-${mentionIndex}` : undefined}
                name="message"
                placeholder={selectedEmployee
                  ? t("composer.placeholder", { employee: selectedEmployee })
                  : t("composer.placeholder_no_employee")}
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
              <button type="submit" className="send-button" disabled={isRunning || !composerText.trim()} aria-label={t("composer.send")} title={t("composer.send")}>
                <CornerDownLeft size={18} />
              </button>
            </div>
          </div>
        </form>
      </section>

      </>)}

      <PreferencesDrawer
        open={preferencesOpen}
        onClose={() => setPreferencesOpen(false)}
        theme={theme}
        onThemeChange={setTheme}
        language={language}
        onLanguageChange={setLanguage}
      />

      <SettingsDrawer
        open={settingsOpen && route === "main"} onClose={() => setSettingsOpen(false)} registeredEmployees={registeredEmployeeIds}
        selectedEmployee={selectedEmployee}
        selectEmployee={selectEmployee} tokenInput={tokenInput} setTokenInput={setTokenInput} saveToken={saveToken}
        selectedSandbox={selectedSandbox} selectedNode={selectedNode} activeRun={activeRun} onCancelRun={cancelActiveRun}
      />
    </main>
  );
}
