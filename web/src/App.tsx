"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionRemove, NavConversations, NavPreferences } from "./components/icons";
import {
  archiveSession, cancelRun, logout, recordDecision, renameSession, runSandbox,
} from "./api";
import { AGENT_NAMES } from "./types";
import type { AgentName, AgentTaskMode, ControlPanelDaemonNodeRecord, CurrentUser, RelaySession } from "./types";
import { TranscriptEmpty } from "./components/TranscriptEmpty";
import { MessageBlock, projectMessages, isGroupedContinuation } from "./components/MessageBlock";
import type { DerivedMessage } from "./components/MessageBlock";
import { AdminConsole } from "./components/AdminConsole";
import { LoginScreen } from "./components/LoginScreen";
import { McpPage } from "./components/McpPage";
import { SkillsPage } from "./components/SkillsPage";
import { PreferencesDialog } from "./components/PreferencesDialog";
import { type Theme, type Language } from "./components/PreferencesPanel";
import type { ConversationItem } from "./components/ConversationRow";
import { DecisionBar } from "./components/composer/DecisionBar";
import { Composer, type ComposerHandle } from "./components/composer/Composer";
import { useRelayData } from "./hooks/useRelayData";
import { useSessionEvents } from "./hooks/useSessionEvents";
import { useLocalDaemonNodes } from "./hooks/useLocalDaemonNodes";
import { mergeVisibleDaemonNodes } from "./lib/daemonNodes";
import { routeComposerMessage } from "./lib/messageRouting";
import { applyTheme, readLanguage, readTheme, readTokens, selectedEmployeeKey, writeLanguage, writeTheme } from "./lib/appStorage";
import { canUseLocalControlPanel, localControlPanelNodes } from "./lib/controlPanel";
import { useRelayStore } from "./lib/store";
import { useAuthSession } from "./hooks/useAuthSession";
import { useActiveSession } from "./hooks/useActiveSession";
import { chooseSendAction } from "./lib/sendAction";
import { myConversationSessions, matchesConversationQuery } from "./lib/conversations";
import { useEmployeeProvisioning } from "./hooks/useEmployeeProvisioning";
import { isAwaitingFeedbackDecision, rerunAssignmentForSession } from "./lib/workflow";
import { useDialogs } from "./components/ui/DialogProvider";
import { SideNav } from "./components/SideNav";
import { ThreadPanel } from "./components/ThreadPanel";
import { ChatHeader } from "./components/ChatHeader";
import type { AppRoute, MobileView } from "./lib/viewTypes";
import "./i18n";

const agents: AgentName[] = AGENT_NAMES;

function useStableEvent<TArgs extends unknown[], TResult>(handler: (...args: TArgs) => TResult): (...args: TArgs) => TResult {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });
  return useCallback((...args: TArgs) => handlerRef.current(...args), []);
}

// ── App ───────────────────────────────────────────────────────────────────────

export function App() {
  const { t, i18n } = useTranslation();
  const { prompt } = useDialogs();
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
  const [composerMode, setComposerMode] = useState<AgentTaskMode>("action");
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>("chat");
  const [route, setRoute] = useState<AppRoute>("main");
  const [sidenavExpanded, setSidenavExpanded] = useState(true);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [language, setLanguage] = useState<Language>(readLanguage);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffAgent, setHandoffAgent] = useState<AgentName>("codex");
  const [handoffMode, setHandoffMode] = useState<AgentTaskMode>("action");
  const [handoffNote, setHandoffNote] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  // True while the composer is staging a brand-new conversation: suppresses the
  // fall-back to the most-recent session so the transcript shows the empty state
  // and the next send creates a fresh owner-scoped session.
  const [composingNew, setComposingNew] = useState(false);
  // Optimistic echo of the just-sent turn: shown immediately so the user sees
  // their message without waiting for the provision + run round-trip. It is
  // hidden once the persisted turn arrives (matched by id for a continued
  // session, or by text for the goal of a freshly created one).
  const [pendingUserMessage, setPendingUserMessage] = useState<{ id: string; text: string } | null>(null);
  const { user, authChecked, setUser } = useAuthSession();
  const statusSeenRef = useRef(false);
  const localNodeAdoptionStartedRef = useRef(false);
  const composerRef = useRef<ComposerHandle>(null);
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
    // Errors persist until dismissed — they're often long and actionable, so
    // auto-hiding them after 4s loses the message before it can be read.
    if (status.tone === "bad") return;
    const timer = window.setTimeout(() => setToastVisible(false), 4000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const selectedSandbox = useMemo(() => sandboxes.find((s) => s.employeeId === selectedEmployee), [sandboxes, selectedEmployee]);
  const selectedNode = useMemo(() => visibleNodes.find((n) => n.employeeId === selectedEmployee || n.id === selectedSandbox?.id), [visibleNodes, selectedEmployee, selectedSandbox?.id]);
  // The logged-in user is themselves an employee; their conversations are the
  // sessions they own. The backend already owner-scopes /sessions, so this is
  // just the non-archived sessions sorted most-recent first.
  const myConversations = useMemo(
    () => myConversationSessions(sessions, selectedEmployee),
    [sessions, selectedEmployee],
  );
  const { activeSessionId, setActiveSessionId } = useActiveSession(selectedEmployee, myConversations);
  const activeSession = useMemo(() => {
    if (composingNew) return undefined;
    if (selectedSessionId) { const p = sessions.find((s) => s.id === selectedSessionId); if (p) return p; }
    if (activeSessionId) { const p = myConversations.find((s) => s.id === activeSessionId); if (p) return p; }
    return myConversations[0];
  }, [composingNew, selectedSessionId, sessions, myConversations, activeSessionId]);

  // Live SSE tail of the open conversation; merges new events into the
  // sessions cache so the active thread updates at push latency.
  useSessionEvents(activeSession?.id, Boolean(user));

  const selectedToken = selectedSandbox ? (tokens[selectedSandbox.id] ?? tokens[selectedEmployee]) : tokens[selectedEmployee];
  const activeRun = selectedNode?.activeRuns[0];
  const messages = useMemo<DerivedMessage[]>(() => projectMessages(activeSession, t), [activeSession, t]);
  const displayMessages = useMemo<DerivedMessage[]>(() => {
    if (!pendingUserMessage) return messages;
    const present = messages.some(
      (m) => m.kind === "user" && (m.id === pendingUserMessage.id || m.text === pendingUserMessage.text),
    );
    if (present) return messages;
    return [
      ...messages,
      { kind: "user", id: pendingUserMessage.id, timestamp: new Date().toISOString(), text: pendingUserMessage.text },
    ];
  }, [messages, pendingUserMessage]);
  useEffect(() => {
    if (!pendingUserMessage) return;
    const present = messages.some(
      (m) => m.kind === "user" && (m.id === pendingUserMessage.id || m.text === pendingUserMessage.text),
    );
    if (present) setPendingUserMessage(null);
  }, [messages, pendingUserMessage]);

  const activeConversationLabel = activeSession
    ? (activeSession.title?.trim() || activeSession.taskGoal)
    : t("thread.new_conversation");

  const awaitingDecision = useMemo(() => isAwaitingFeedbackDecision(activeSession), [activeSession]);

  const conversations = useMemo<ConversationItem[]>(() => {
    const runningBy = new Map((selectedNode?.activeRuns ?? []).map((run) => [run.sessionId, run.agent]));
    return myConversations.map((session) => ({ session, runningAgent: runningBy.get(session.id) }));
  }, [myConversations, selectedNode?.activeRuns]);
  const filteredConversations = useMemo(
    () => conversations.filter((c) => matchesConversationQuery(c.session, employeeQuery)),
    [conversations, employeeQuery],
  );

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
    setTokens(readTokens());
    // The logged-in user is their own employee; their conversations are the
    // sessions they own. Pin the selection to self so the chat view always
    // shows the current employee's own work (never another employee's).
    const myEmployeeId = user?.employeeId ?? user?.username ?? "";
    if (myEmployeeId) setSelectedEmployee(myEmployeeId);
    setHydrated(true);
  }, [authChecked, user]);
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
    const disabled = selectedNode?.disabledAgents ?? [];
    if (disabled.length === 0) return;
    if (disabled.includes(activeAgent)) {
      const fallback = agents.find((a) => !disabled.includes(a));
      if (fallback && fallback !== activeAgent) setActiveAgent(fallback);
    }
    if (disabled.includes(handoffAgent)) {
      const fallback = agents.find((a) => !disabled.includes(a));
      if (fallback && fallback !== handoffAgent) setHandoffAgent(fallback);
    }
  }, [selectedNode?.disabledAgents, activeAgent, handoffAgent]);
  useEffect(() => {
    if (route === "admin" && user && user.role !== "admin") {
      setRoute("main");
    }
  }, [route, user]);
  useEffect(() => {
    const el = transcriptRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [displayMessages.length, activeSession?.id]);

  useEffect(() => {
    applyTheme(theme);
    writeTheme(theme);
    // "system" no longer rides a CSS media query, so re-resolve on OS change.
    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
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

  function openConversation(sessionId: string) {
    setComposingNew(false);
    setPendingUserMessage(null);
    setSelectedSessionId(sessionId);
    setActiveSessionId(sessionId);
    setMobileView("chat");
  }

  function startNewConversation() {
    setComposingNew(true);
    setPendingUserMessage(null);
    setSelectedSessionId(undefined);
    setActiveSessionId(null);
    composerRef.current?.clear();
    setMobileView("chat");
    atBottomRef.current = true;
  }

  async function renameConversation(session: RelaySession) {
    const current = session.title?.trim() || session.taskGoal;
    const result = await prompt({
      title: t("conversation.rename_prompt"),
      defaultValue: current,
      confirmLabel: t("conversation.rename"),
    });
    const next = result?.trim();
    if (!next || next === current) return;
    try {
      await renameSession(session.id, next, selectedToken);
      await refresh();
    } catch (err) {
      setStatus({ tone: "bad", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function closeConversation(sessionId: string) {
    try {
      await archiveSession(sessionId, selectedToken);
      if (activeSession?.id === sessionId) {
        setSelectedSessionId(undefined);
        setActiveSessionId(null);
      }
      await refresh();
    } catch (err) {
      setStatus({ tone: "bad", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function sendMessage() {
    const raw = composerRef.current?.getText().trim() ?? "";
    if (!raw) return;
    if (!selectedEmployee) {
      setStatus({ tone: "warn", message: t("toast.no_node_selected") });
      return;
    }
    const { agent: routedAgent, goal } = routeComposerMessage(raw, activeAgent, agents);
    if (!goal) { setStatus({ tone: "warn", message: t("toast.add_task", { agent: routedAgent }) }); return; }
    if (routedAgent !== activeAgent) setActiveAgent(routedAgent);
    // When staging a new conversation, always create; otherwise continue the
    // open one. composingNew forces a fresh owner-scoped session here.
    const action = composingNew ? { kind: "create" as const } : chooseSendAction({ activeSessionId: activeSession?.id ?? null, session: activeSession });
    const sessionId = action.kind === "append" ? action.sessionId : undefined;
    // Echo the turn immediately. For a continued session we mint the message id
    // here and hand it to the backend so the persisted event reconciles by id.
    const userMessageId = `evt_${crypto.randomUUID()}`;
    setPendingUserMessage({ id: userMessageId, text: goal });
    setIsRunning(true);
    composerRef.current?.clear();
    setComposingNew(false);
    setMobileView("chat"); atBottomRef.current = true;
    try {
      const { sandbox, token } = await provisionEmployeeSandbox(selectedEmployee, selectedToken);
      rememberSandboxToken(selectedEmployee, sandbox, token);
      const assignment = { agent: routedAgent, mode: composerMode };
      // The active session now tails live over SSE (useSessionEvents), so no
      // per-run polling loop is needed while the run is in flight.
      const done = await runSandbox(
        { sandboxId: sandbox.id, taskGoal: goal, assignments: [assignment], sessionId, ...(sessionId ? { userMessageId } : {}) },
        token,
      );
      setActiveSessionId(done.id);
      setSelectedSessionId(done.id);
      setStatus({ tone: "good", message: t("toast.message_sent", { employee: selectedEmployee, agent: routedAgent }) });
      await refresh(undefined, token);
    } catch (err) {
      setPendingUserMessage(null);
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

  const handleComposerSend = useStableEvent(() => { void sendMessage(); });
  const handleCancelRun = useStableEvent(() => { void cancelActiveRun(); });

  async function sendDecision(kind: "approve" | "reject" | "rerun" | "mark_done") {
    if (!activeSession) return;
    if (kind === "rerun") {
      if (!selectedEmployee) {
        setStatus({ tone: "warn", message: t("toast.no_node_selected") });
        return;
      }
      setIsRunning(true);
      try {
        const { sandbox, token } = await provisionEmployeeSandbox(selectedEmployee, selectedToken);
        rememberSandboxToken(selectedEmployee, sandbox, token);
        const assignment = rerunAssignmentForSession(activeSession, activeAgent, composerMode);
        setActiveAgent(assignment.agent);
        setSelectedSessionId(activeSession.id);
        setMobileView("chat"); atBottomRef.current = true;
        const done = await runSandbox({
          sandboxId: sandbox.id,
          taskGoal: activeSession.taskGoal,
          assignments: [assignment],
          sessionId: activeSession.id,
          decision: { kind: "rerun", targetAgent: assignment.agent },
        }, token);
        setSelectedSessionId(done.id);
        setStatus({ tone: "good", message: t("toast.decision_recorded", { kind: t("decision.rerun") }) });
        await refresh(undefined, token);
      } catch (err) {
        setStatus({ tone: "bad", message: err instanceof Error ? err.message : String(err) });
      } finally {
        setIsRunning(false);
      }
      return;
    }
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
    if (!selectedEmployee) {
      setStatus({ tone: "warn", message: t("toast.no_node_selected") });
      return;
    }
    setIsRunning(true);
    try {
      const { sandbox, token } = await provisionEmployeeSandbox(selectedEmployee, selectedToken);
      rememberSandboxToken(selectedEmployee, sandbox, token);
      const note = handoffNote.trim();
      const assignment = { agent: handoffAgent, mode: handoffMode };
      const taskGoal = note ? `${activeSession.taskGoal}\n\nHandoff note:\n${note}` : activeSession.taskGoal;
      const done = await runSandbox({
        sandboxId: sandbox.id,
        taskGoal,
        assignments: [assignment],
        sessionId: activeSession.id,
        decision: { kind: "handoff", targetAgent: handoffAgent, ...(note ? { note } : {}) },
      }, token);
      setSelectedSessionId(done.id); setHandoffNote(""); setHandoffMode("action"); setHandoffOpen(false); setActiveAgent(handoffAgent);
      setStatus({ tone: "good", message: t("toast.handed_to", { agent: handoffAgent }) });
      await refresh(undefined, token);
    } catch (err) {
      setStatus({ tone: "bad", message: err instanceof Error ? err.message : String(err) });
    } finally { setIsRunning(false); }
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
      <main className="login-checking">
        <p className="login-checking-text">{t("login.checking")}</p>
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
          <span>{activeConversationLabel}</span>
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
        conversations={filteredConversations}
        query={employeeQuery}
        setQuery={setEmployeeQuery}
        selectedSessionId={activeSession?.id}
        onSelectConversation={openConversation}
        onNewConversation={startNewConversation}
        onRenameConversation={(session) => void renameConversation(session)}
        onCloseConversation={(id) => void closeConversation(id)}
      />

      <section id="chat-panel" className="chat-panel" aria-label={t("nav.conversations")} tabIndex={-1}>
        <ChatHeader
          activeAgent={activeAgent}
          setActiveAgent={setActiveAgent}
          agentNames={agents}
          disabledAgents={selectedNode?.disabledAgents}
          agentHealth={selectedNode?.agents}
          activeSession={activeSession}
          isRefreshing={isRefreshing}
          onRefresh={() => void refresh()}
          onBackToThreads={() => setMobileView("threads")}
        />

        <div
          className={`toast ${status.tone}`}
          data-visible={toastVisible}
          role={status.tone === "bad" ? "alert" : "status"}
          aria-live={status.tone === "bad" ? "assertive" : "polite"}
        >
          {toastVisible ? (
            <>
              <span className="toast-message">{status.message}</span>
              {status.tone === "bad" ? (
                <button
                  type="button"
                  className="toast-dismiss"
                  aria-label={t("toast.dismiss")}
                  onClick={() => setToastVisible(false)}
                >
                  <ActionRemove size={14} />
                </button>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="transcript" ref={transcriptRef} onScroll={handleTranscriptScroll}>
          <div className="transcript-inner">
            {activeSession || pendingUserMessage ? (
              <>
                {displayMessages.map((msg, i) => <MessageBlock key={msg.id} message={msg} sessionId={activeSession?.id ?? ""} grouped={isGroupedContinuation(displayMessages, i)} />)}
                {awaitingDecision ? <DecisionBar agentNames={agents} disabledAgents={selectedNode?.disabledAgents} sendDecision={sendDecision} handoffOpen={handoffOpen} setHandoffOpen={setHandoffOpen} handoffAgent={handoffAgent} setHandoffAgent={setHandoffAgent} handoffMode={handoffMode} setHandoffMode={setHandoffMode} handoffNote={handoffNote} setHandoffNote={setHandoffNote} sendHandoff={sendHandoff} /> : null}
              </>
            ) : (
              <TranscriptEmpty selectedEmployee={selectedEmployee} activeAgent={activeAgent} agentDescriptors={agentDescriptors} />
            )}
          </div>
        </div>

        <Composer
          ref={composerRef}
          agentNames={agents}
          disabledAgents={selectedNode?.disabledAgents}
          composerMode={composerMode}
          setComposerMode={setComposerMode}
          activeAgent={activeAgent}
          selectedEmployee={selectedEmployee}
          running={Boolean(activeRun)}
          onAgentPicked={setActiveAgent}
          onSend={handleComposerSend}
          onCancelRun={handleCancelRun}
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
