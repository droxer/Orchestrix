"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavConversations, NavPreferences } from "./components/icons";
import {
  cancelRun, createSession, logout,
  recordDecision, recordHandoff, runSandbox,
} from "./api";
import type { AgentName, AgentTaskMode, ControlPanelDaemonNodeRecord, CurrentUser } from "./types";
import { TranscriptEmpty } from "./components/TranscriptEmpty";
import { MessageBlock, projectMessages, isGroupedContinuation } from "./components/MessageBlock";
import type { DerivedMessage } from "./components/MessageBlock";
import { AdminConsole } from "./components/AdminConsole";
import { LoginScreen } from "./components/LoginScreen";
import { McpPage } from "./components/McpPage";
import { SkillsPage } from "./components/SkillsPage";
import { PreferencesDialog } from "./components/PreferencesDialog";
import { type Theme, type Language } from "./components/PreferencesPanel";
import type { EmployeeContact } from "./components/ConversationRow";
import { DecisionBar } from "./components/composer/DecisionBar";
import { Composer } from "./components/composer/Composer";
import { useRelayData } from "./hooks/useRelayData";
import { useSessionEvents } from "./hooks/useSessionEvents";
import { useLocalDaemonNodes } from "./hooks/useLocalDaemonNodes";
import { mergeVisibleDaemonNodes } from "./lib/daemonNodes";
import { applyTheme, readLanguage, readTheme, readTokens, selectedEmployeeKey, writeLanguage, writeTheme } from "./lib/appStorage";
import { canUseLocalControlPanel, localControlPanelNodes, sessionBelongsToEmployee } from "./lib/controlPanel";
import { useRelayStore } from "./lib/store";
import { useAuthSession } from "./hooks/useAuthSession";
import { useComposer } from "./hooks/useComposer";
import { useEmployeeProvisioning } from "./hooks/useEmployeeProvisioning";
import { SideNav } from "./components/SideNav";
import { ThreadPanel } from "./components/ThreadPanel";
import { ChatHeader } from "./components/ChatHeader";
import type { AppRoute, MobileView } from "./lib/viewTypes";
import "./i18n";

// Mirrors AGENT_REGISTRY in relay-core. Kept as a local literal so the browser
// bundle never imports node-only runtime; the Record<AgentName, …>
// types below fail to compile if this drifts from the AgentName union.
const agents: AgentName[] = ["claude", "pi", "codex", "kimi"];



// ── App ───────────────────────────────────────────────────────────────────────

export function App() {
  const { t, i18n } = useTranslation();
  const selectedEmployee = useRelayStore((s) => s.selectedEmployee);
  const setSelectedEmployee = useRelayStore((s) => s.setSelectedEmployee);
  const selectedSessionId = useRelayStore((s) => s.selectedSessionId);
  const setSelectedSessionId = useRelayStore((s) => s.setSelectedSessionId);
  const tokens = useRelayStore((s) => s.tokens);
  const setTokens = useRelayStore((s) => s.setTokens);
  const status = useRelayStore((s) => s.status);
  const setStatus = useRelayStore((s) => s.setStatus);
  const [hydrated, setHydrated] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentName>("claude");
  const [composerMode, setComposerMode] = useState<AgentTaskMode>("implement");
  const composer = useComposer({ agentNames: agents, onAgentPicked: setActiveAgent });
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>("chat");
  const [route, setRoute] = useState<AppRoute>("main");
  const [sidenavExpanded, setSidenavExpanded] = useState(true);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [language, setLanguage] = useState<Language>(readLanguage);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffAgent, setHandoffAgent] = useState<AgentName>("codex");
  const [handoffMode, setHandoffMode] = useState<AgentTaskMode>("implement");
  const [handoffNote, setHandoffNote] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const { user, authChecked, setUser } = useAuthSession();
  const statusSeenRef = useRef(false);
  const localNodeAdoptionStartedRef = useRef(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const selectedEmployeeToken = tokens[selectedEmployee];
  const { sandboxes, nodes, sessions, isRefreshing, refresh, setSandboxes } = useRelayData(setStatus, selectedEmployeeToken, Boolean(user));
  const { localNodes, refreshLocalDaemonNodes } = useLocalDaemonNodes(
    localControlPanelNodes,
    hydrated && user?.role === "admin" && canUseLocalControlPanel(),
  );
  const visibleNodes = useMemo(() => mergeVisibleDaemonNodes(nodes, localNodes), [nodes, localNodes]);
  const agentDescriptors = useMemo<Record<AgentName, { role: string; blurb: string }>>(() => ({
    claude: { role: t("agent.claude.role"), blurb: t("agent.claude.blurb") },
    pi: { role: t("agent.pi.role"), blurb: t("agent.pi.blurb") },
    codex: { role: t("agent.codex.role"), blurb: t("agent.codex.blurb") },
    kimi: { role: t("agent.kimi.role"), blurb: t("agent.kimi.blurb") },
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

  // Live SSE tail of the open conversation; merges new events into the
  // sessions cache so the active thread updates at push latency.
  useSessionEvents(activeSession?.id, Boolean(user));

  const selectedToken = selectedSandbox ? (tokens[selectedSandbox.id] ?? tokens[selectedEmployee]) : tokens[selectedEmployee];
  const activeRun = selectedNode?.activeRuns[0];
  const messages = useMemo<DerivedMessage[]>(() => projectMessages(activeSession, t), [activeSession, t]);
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
  const filteredEmployees = useMemo(() => {
    const q = employeeQuery.trim().toLowerCase();
    if (!q) return employeeContacts;
    return employeeContacts.filter((c) => c.id.toLowerCase().includes(q) || (c.lastSession?.taskGoal.toLowerCase() ?? "").includes(q));
  }, [employeeContacts, employeeQuery]);

  const refreshWithToken = useCallback(async (tokenOverride?: string) => {
    await refresh(undefined, tokenOverride);
  }, [refresh]);

  const { provisionEmployeeSandbox, rememberSandboxToken, adoptLocalDaemonNodes } = useEmployeeProvisioning({
    nodes,
    setSandboxes,
    refreshLocalDaemonNodes,
    refreshWithToken,
  });

  useEffect(() => {
    if (!authChecked) return;
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
  }, [authChecked]);
  useEffect(() => {
    if (!hydrated || !user || localNodeAdoptionStartedRef.current) return;
    localNodeAdoptionStartedRef.current = true;
    void adoptLocalDaemonNodes();
  }, [adoptLocalDaemonNodes, hydrated, user]);
  // Admin local-node polling now lives in useLocalDaemonNodes (refetchInterval).
  useEffect(() => {
    if (!hydrated) return;
    if (selectedEmployee) {
      localStorage.setItem(selectedEmployeeKey, selectedEmployee);
    } else {
      localStorage.removeItem(selectedEmployeeKey);
    }
  }, [selectedEmployee, hydrated]);
  useEffect(() => {
    if (!hydrated || employeeContacts.length === 0) return;
    if (!employeeContacts.some((contact) => contact.id === selectedEmployee)) {
      setSelectedEmployee(employeeContacts[0].id);
    }
  }, [employeeContacts, hydrated, selectedEmployee]);
  useEffect(() => { setSelectedSessionId(undefined); }, [activeAgent, selectedEmployee]);
  useEffect(() => {
    if (route === "admin" && user && user.role !== "admin") {
      setRoute("main");
    }
  }, [route, user]);
  useEffect(() => {
    const el = transcriptRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, activeSession?.id]);

  useEffect(() => {
    applyTheme(theme);
    writeTheme(theme);
  }, [theme]);

  useEffect(() => {
    writeLanguage(language);
    document.documentElement.lang = language;
    document.title = i18n.t("app.title");
    if (i18n.language !== language) {
      void i18n.changeLanguage(language);
    }
  }, [i18n, language]);

  function handleTranscriptScroll(): void {
    const el = transcriptRef.current;
    if (el) atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }

  async function selectEmployee(employeeId: string) {
    const next = employeeId.trim().replace(/^@/, "");
    if (!next) return;
    setSelectedEmployee(next); setMobileView("chat");
    const token = tokens[next];
    try {
      setStatus({ tone: "info", message: t("toast.opening_workspace", { employee: next }) });
      const { sandbox, token: savedToken } = await provisionEmployeeSandbox(next, token);
      rememberSandboxToken(next, sandbox, savedToken);
      setStatus({ tone: "good", message: t("toast.workspace_ready", { employee: next }) });
      await refreshWithToken(savedToken);
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
    setTokens(nextTokens);
    if (selectedEmployee === employeeId) setSelectedEmployee("");
  }

  async function sendMessage() {
    const raw = composer.composerText.trim();
    if (!raw) return;
    if (!selectedEmployee) {
      setStatus({ tone: "warn", message: t("toast.no_node_selected") });
      return;
    }
    const mm = new RegExp(`^@(${agents.join("|")})(?:\\s+|$)`, "i").exec(raw);
    const routedAgent: AgentName = (mm?.[1].toLowerCase() as AgentName | undefined) ?? activeAgent;
    const goal = mm ? raw.slice(mm[0].length).trim() : raw;
    if (!goal) { setStatus({ tone: "warn", message: t("toast.add_task", { agent: routedAgent }) }); return; }
    setIsRunning(true);
    try {
      const { sandbox, token } = await provisionEmployeeSandbox(selectedEmployee, selectedToken);
      rememberSandboxToken(selectedEmployee, sandbox, token);
      const assignment = { agent: routedAgent, mode: composerMode };
      const session = await createSession({ taskGoal: goal, assignments: [assignment], workspacePath: sandbox.workspacePath, ownerEmployeeId: selectedEmployee }, token);
      setSelectedSessionId(session.id); composer.setComposerText(""); composer.setMentionOpen(false);
      setMobileView("chat"); atBottomRef.current = true;
      await refresh(undefined, token);
      // The active session now tails live over SSE (useSessionEvents), so no
      // per-run polling loop is needed while the run is in flight.
      const done = await runSandbox({ sandboxId: sandbox.id, taskGoal: goal, assignments: [assignment], sessionId: session.id }, token);
      setSelectedSessionId(done.id);
      setStatus({ tone: "good", message: t("toast.message_sent", { employee: selectedEmployee, agent: routedAgent }) });
      await refresh(undefined, token);
    } catch (err) {
      setStatus({ tone: "bad", message: err instanceof Error ? err.message : String(err) });
    } finally { setIsRunning(false); }
  }

  async function cancelActiveRun() {
    if (!selectedSandbox || !activeRun) return;
    try {
      const session = await cancelRun(selectedSandbox.id, activeRun.sessionId, selectedToken, t("cancel.reason"));
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
      const session = await recordHandoff(activeSession.id, handoffAgent, handoffMode, handoffNote.trim() || undefined, selectedToken);
      setSelectedSessionId(session.id); setHandoffNote(""); setHandoffMode("implement"); setHandoffOpen(false); setActiveAgent(handoffAgent);
      setStatus({ tone: "good", message: t("toast.handed_to", { agent: handoffAgent }) });
      await refresh();
    } catch (err) {
      setStatus({ tone: "bad", message: err instanceof Error ? err.message : String(err) });
    }
  }


  async function handleLogout() {
    try {
      await logout();
    } catch {
      // ignore
    }
    setUser(null);
    setRoute("main");
  }

  if (!authChecked) {
    return (
      <main className="login-screen">
        <div className="login-card">
          <p className="login-subtitle">{t("login.checking")}</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return <LoginScreen onAuthenticated={(authenticatedUser) => setUser(authenticatedUser)} />;
  }

  return (
    <main className="messenger-shell" data-settings="closed" data-mobile-view={mobileView} data-route={route} data-sidenav={sidenavExpanded ? "open" : "closed"}>
      <a className="skip-link" href="#chat-panel">{t("skip_to_conversation")}</a>

      <div className="mobile-topbar" aria-label={t("nav.conversations")}>
        <button type="button" className={mobileView === "threads" ? "active" : ""} aria-label={t("nav.conversations")} aria-pressed={mobileView === "threads"} onClick={() => setMobileView("threads")}>
          <NavConversations size={16} /><span>{t("nav.chats")}</span>
        </button>
        <button type="button" className={mobileView === "chat" ? "active" : ""} aria-pressed={mobileView === "chat"} onClick={() => setMobileView("chat")}>
          <span translate={selectedEmployee ? "no" : undefined}>{selectedEmployeeLabel}</span>
        </button>
        <button type="button" className={`mobile-settings ${prefsOpen ? "active" : ""}`} aria-label={t("nav.settings")} aria-haspopup="dialog" aria-expanded={prefsOpen} onClick={() => setPrefsOpen((v) => !v)}>
          <NavPreferences size={16} />
        </button>
      </div>

      <SideNav
        sidenavExpanded={sidenavExpanded}
        setSidenavExpanded={setSidenavExpanded}
        route={route}
        setRoute={setRoute}
        isAdmin={user.role === "admin"}
        prefsOpen={prefsOpen}
        setPrefsOpen={setPrefsOpen}
        onLogout={() => void handleLogout()}
      />

      {route === "admin" ? <AdminConsole /> : route === "mcp" ? <McpPage /> : route === "skills" ? <SkillsPage /> : (<>

      <ThreadPanel
        employees={filteredEmployees}
        employeeQuery={employeeQuery}
        setEmployeeQuery={setEmployeeQuery}
        selectedEmployee={selectedEmployee}
        onSelectEmployee={(id) => void selectEmployee(id)}
        onRemoveEmployee={removeEmployee}
      />

      <section id="chat-panel" className="chat-panel" aria-label={t("nav.conversations")} tabIndex={-1}>
        <ChatHeader
          selectedEmployee={selectedEmployee}
          running={Boolean(activeRun)}
          activeAgent={activeAgent}
          setActiveAgent={setActiveAgent}
          agentNames={agents}
          activeSession={activeSession}
          isRefreshing={isRefreshing}
          onRefresh={() => void refresh()}
          onBackToThreads={() => setMobileView("threads")}
        />

        <div className={`toast ${status.tone}`} data-visible={toastVisible} role="status" aria-live="polite">
          {toastVisible ? status.message : null}
        </div>

        <div className="transcript" ref={transcriptRef} onScroll={handleTranscriptScroll}>
          <div className="transcript-inner">
            {activeSession ? (
              <>
                {messages.map((msg, i) => <MessageBlock key={msg.id} message={msg} employeeId={selectedEmployee} sessionId={activeSession.id} grouped={isGroupedContinuation(messages, i)} />)}
                {awaitingDecision ? <DecisionBar agentNames={agents} sendDecision={sendDecision} handoffOpen={handoffOpen} setHandoffOpen={setHandoffOpen} handoffAgent={handoffAgent} setHandoffAgent={setHandoffAgent} handoffMode={handoffMode} setHandoffMode={setHandoffMode} handoffNote={handoffNote} setHandoffNote={setHandoffNote} sendHandoff={sendHandoff} /> : null}
              </>
            ) : (
              <TranscriptEmpty selectedEmployee={selectedEmployee} activeAgent={activeAgent} agentDescriptors={agentDescriptors} />
            )}
          </div>
        </div>

        <Composer
          composer={composer}
          composerMode={composerMode}
          setComposerMode={setComposerMode}
          activeAgent={activeAgent}
          selectedEmployee={selectedEmployee}
          running={Boolean(activeRun)}
          onSend={() => void sendMessage()}
          onCancelRun={() => void cancelActiveRun()}
        />
      </section>

      </>)}

      <PreferencesDialog
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        preferences={{
          theme,
          onThemeChange: setTheme,
          language,
          onLanguageChange: setLanguage,
        }}
      />
    </main>
  );
}
