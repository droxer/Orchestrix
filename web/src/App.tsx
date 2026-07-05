"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  logout, updateDaemonNodeAgentRoleOverrides,
} from "./api";
import { AGENT_NAMES } from "./types";
import type { AgentName, AgentTaskMode, CurrentUser, DaemonNodeMonitorRecord, RelayArtifact, RelaySession } from "./types";
import { LoginScreen } from "./components/LoginScreen";
import { type Theme, type Language } from "./components/PreferencesPanel";
import type { ConversationItem } from "./components/ConversationRow";
import { useRelayData } from "./hooks/useRelayData";
import { useRelayMutations } from "./hooks/useRelayMutations";
import { useMutationError } from "./hooks/useMutationError";
import { useAppHash } from "./hooks/useAppHash";
import { useSessionEvents } from "./hooks/useSessionEvents";
import { useLocalDaemonNodes } from "./hooks/useLocalDaemonNodes";
import { mergeVisibleDaemonNodes } from "./lib/daemonNodes";
import { routeComposerMessage } from "./lib/messageRouting";
import { effectiveAgentRoleMap, type AgentRoleMap } from "./lib/manageAgents";
import { applyTheme, readLanguage, readTheme, readTokens, selectedEmployeeKey, writeLanguage, writeTheme } from "./lib/appStorage";
import { canUseLocalControlPanel, localControlPanelNodes } from "./lib/controlPanel";
import { useRelayStore } from "./lib/store";
import { useAuthSession } from "./hooks/useAuthSession";
import { useActiveSession } from "./hooks/useActiveSession";
import { chooseSendAction, suppressActiveSessionDuringPendingSend } from "./lib/sendAction";
import { myConversationSessions, matchesConversationQuery, pickActiveConversationSession } from "./lib/conversations";
import { shouldTailSessionEvents } from "./lib/sessionEventStream";
import { useEmployeeProvisioning } from "./hooks/useEmployeeProvisioning";
import { isAwaitingFeedbackDecision, rerunAssignmentForSession } from "./lib/workflow";
import { useDialogs } from "./components/ui/DialogProvider";
import { AppShell, RouteFallback } from "./components/AppShell";
import { MainChatView } from "./components/MainChatView";
import type { ComposerHandle } from "./components/composer/Composer";
import type { DerivedMessage } from "./components/MessageBlock";
import { projectMessages } from "./components/MessageBlock";
import type { AppRoute } from "./lib/viewTypes";
import { visibleConversationArtifacts } from "./lib/conversationArtifacts";

const AdminConsole = lazy(() => import("./components/AdminConsole").then((m) => ({ default: m.AdminConsole })));
const BacklogPage = lazy(() => import("./components/BacklogPage").then((m) => ({ default: m.BacklogPage })));
const ChannelsPage = lazy(() => import("./components/ChannelsPage").then((m) => ({ default: m.ChannelsPage })));
const EmployeeWorkspacePage = lazy(() => import("./components/EmployeeWorkspacePage").then((m) => ({ default: m.EmployeeWorkspacePage })));
const RoutinePage = lazy(() => import("./components/RoutinePage").then((m) => ({ default: m.RoutinePage })));

const agents: AgentName[] = AGENT_NAMES;

const WORK_ROUTE_SKIP_IDS: Record<Exclude<AppRoute, "main">, string> = {
  workspace: "workspace-panel",
  backlog: "backlog-panel",
  routine: "routine-panel",
  channels: "channels-panel",
  admin: "admin-panel",
};

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
  const { reportMutationError } = useMutationError();
  const {
    renameSessionMutation,
    archiveSessionMutation,
    cancelRunMutation,
    recordDecisionMutation,
    runSandboxMutation,
    invalidateRelay,
  } = useRelayMutations();
  const selectedEmployee = useRelayStore((s) => s.selectedEmployee);
  const setSelectedEmployee = useRelayStore((s) => s.setSelectedEmployee);
  const selectedSessionId = useRelayStore((s) => s.selectedSessionId);
  const setSelectedSessionId = useRelayStore((s) => s.setSelectedSessionId);
  const tokens = useRelayStore((s) => s.tokens);
  const setTokens = useRelayStore((s) => s.setTokens);
  const [hydrated, setHydrated] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentName>("claude");
  const [composerMode, setComposerMode] = useState<AgentTaskMode>("action");
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [sidenavExpanded, setSidenavExpanded] = useState(true);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [language, setLanguage] = useState<Language>(readLanguage);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [artifactsDrawerOpen, setArtifactsDrawerOpen] = useState(false);
  const [initialArtifactId, setInitialArtifactId] = useState<string | null>(null);
  const [handoffAgent, setHandoffAgent] = useState<AgentName>("codex");
  const [handoffMode, setHandoffMode] = useState<AgentTaskMode>("action");
  const [handoffNote, setHandoffNote] = useState("");
  const [isRunning, setIsRunning] = useState(false);
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
  const localNodeAdoptionStartedRef = useRef(false);
  const composerRef = useRef<ComposerHandle>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const selectedEmployeeToken = tokens[selectedEmployee];
  const { sandboxes, nodes, sessions, tasks, isRefreshing, refresh, setSandboxes } = useRelayData(selectedEmployeeToken, Boolean(user));
  const { localNodes, refreshLocalDaemonNodes } = useLocalDaemonNodes(
    localControlPanelNodes,
    hydrated && user?.role === "admin" && canUseLocalControlPanel(),
  );
  const visibleNodes = useMemo(() => mergeVisibleDaemonNodes(nodes, localNodes), [nodes, localNodes]);
  const selectedSandbox = useMemo(() => sandboxes.find((s) => s.employeeId === selectedEmployee), [sandboxes, selectedEmployee]);
  const selectedNode = useMemo(() => visibleNodes.find((n) => n.employeeId === selectedEmployee || n.id === selectedSandbox?.id), [visibleNodes, selectedEmployee, selectedSandbox?.id]);
  const agentRoleLabels = useMemo<Partial<Record<AgentName, string>>>(() => {
    const roleMap = effectiveAgentRoleMap(selectedNode);
    return Object.fromEntries(
      agents.map((agent) => [agent, roleMap[agent] ? t(`agent_role.${roleMap[agent]}`) : t(`agent.${agent}.role`)]),
    ) as Partial<Record<AgentName, string>>;
  }, [selectedNode, t]);
  const agentDescriptors = useMemo<Record<AgentName, { role: string; blurb: string }>>(() => ({
    claude: { role: agentRoleLabels.claude ?? t("agent.claude.role"), blurb: t("agent.claude.blurb") },
    pi: { role: agentRoleLabels.pi ?? t("agent.pi.role"), blurb: t("agent.pi.blurb") },
    codex: { role: agentRoleLabels.codex ?? t("agent.codex.role"), blurb: t("agent.codex.blurb") },
    kimi: { role: agentRoleLabels.kimi ?? t("agent.kimi.role"), blurb: t("agent.kimi.blurb") },
  }), [agentRoleLabels, t]);
  // The logged-in user is themselves an employee; their conversations are the
  // sessions they own. The backend already owner-scopes /sessions, so this is
  // just the non-archived sessions sorted most-recent first.
  const myConversations = useMemo(
    () => myConversationSessions(sessions, selectedEmployee),
    [sessions, selectedEmployee],
  );
  const { activeSessionId, setActiveSessionId } = useActiveSession(selectedEmployee, myConversations);
  const activeSession = useMemo(
    () => pickActiveConversationSession({
      conversations: myConversations,
      selectedSessionId,
      activeSessionId,
      composingNew,
    }),
    [activeSessionId, composingNew, myConversations, selectedSessionId],
  );
  const visibleArtifacts = useMemo(() => visibleConversationArtifacts(activeSession), [activeSession]);

  const applySessionFromHash = useCallback((sessionId: string) => {
    setComposingNew(false);
    setSelectedSessionId(sessionId);
    setActiveSessionId(sessionId);
  }, [setActiveSessionId, setSelectedSessionId]);

  const clearPendingMessage = useCallback(() => {
    setPendingUserMessage(null);
  }, []);

  const {
    route,
    mobileView,
    navigateToRoute,
    navigateToMobileView,
    hrefForSideNavRoute,
    syncChatHash,
  } = useAppHash({
    composingNew,
    activeSessionId,
    selectedSessionId,
    activeSession,
    onApplySessionFromHash: applySessionFromHash,
    onClearPendingMessage: clearPendingMessage,
  });

  // Live SSE tail of the open conversation; merges new events into the
  // sessions cache so the active thread updates at push latency.
  useSessionEvents(activeSession?.id, Boolean(user) && shouldTailSessionEvents(activeSession?.status));

  const selectedToken = selectedSandbox ? (tokens[selectedSandbox.id] ?? tokens[selectedEmployee]) : tokens[selectedEmployee];
  const activeRun = activeSession ? selectedNode?.activeRuns.find((run) => run.sessionId === activeSession.id) : undefined;
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

  const skipLinkHref = useMemo(() => {
    if (route === "main") return mobileView === "threads" ? "#thread-panel" : "#chat-panel";
    return `#${WORK_ROUTE_SKIP_IDS[route]}`;
  }, [route, mobileView]);

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
    if ((route === "admin" || route === "channels") && user && user.role !== "admin") {
      navigateToRoute("main");
    }
  }, [navigateToRoute, route, user]);
  useEffect(() => {
    const el = transcriptRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [displayMessages.length, activeSession?.id]);

  useEffect(() => {
    setArtifactsDrawerOpen(false);
    setInitialArtifactId(null);
  }, [activeSession?.id]);

  useEffect(() => {
    applyTheme(theme);
    writeTheme(theme);
    // Re-resolve "system" when the OS color scheme changes.
    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(theme);
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

  function openConversation(sessionId: string, replace = false) {
    setComposingNew(false);
    setPendingUserMessage(null);
    setSelectedSessionId(sessionId);
    setActiveSessionId(sessionId);
    syncChatHash(sessionId, replace);
  }

  function startNewConversation() {
    setComposingNew(true);
    setPendingUserMessage(null);
    setSelectedSessionId(undefined);
    setActiveSessionId(null);
    composerRef.current?.clear();
    atBottomRef.current = true;
    syncChatHash(null);
  }

  function openArtifactsDrawer(artifact?: RelayArtifact) {
    if (!activeSession) return;
    setInitialArtifactId(artifact?.id ?? null);
    setArtifactsDrawerOpen(true);
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
      await renameSessionMutation.mutateAsync({ sessionId: session.id, title: next, token: selectedToken });
    } catch {
      // mutation onError surfaces a toast.
    }
  }

  async function closeConversation(sessionId: string) {
    try {
      await archiveSessionMutation.mutateAsync({ sessionId, token: selectedToken });
      if (activeSession?.id === sessionId) {
        setSelectedSessionId(undefined);
        setActiveSessionId(null);
        syncChatHash(null, true);
      }
    } catch {
      // mutation onError surfaces a toast.
    }
  }

  async function sendMessage() {
    const raw = composerRef.current?.getText().trim() ?? "";
    if (!raw) return;
    if (!selectedEmployee) return;
    const { agent: routedAgent, goal } = routeComposerMessage(raw, activeAgent, agents);
    if (!goal) return;
    if (routedAgent !== activeAgent) setActiveAgent(routedAgent);
    // When staging a new conversation, always create; otherwise continue the
    // open one. composingNew forces a fresh owner-scoped session here.
    const action = composingNew ? { kind: "create" as const } : chooseSendAction({ activeSessionId: activeSession?.id ?? null, session: activeSession });
    const sessionId = action.kind === "append" ? action.sessionId : undefined;
    const creatingSession = suppressActiveSessionDuringPendingSend(action);
    // Echo the turn immediately. For a continued session we mint the message id
    // here and hand it to the backend so the persisted event reconciles by id.
    const userMessageId = `evt_${crypto.randomUUID()}`;
    setPendingUserMessage({ id: userMessageId, text: goal });
    setIsRunning(true);
    composerRef.current?.clear();
    // While creating a fresh conversation, keep suppressing the previous active
    // thread so the optimistic user turn does not appear in the wrong transcript.
    if (!creatingSession) setComposingNew(false);
    navigateToRoute("main");
    atBottomRef.current = true;
    try {
      const { sandbox, token } = await provisionEmployeeSandbox(selectedEmployee, selectedToken);
      rememberSandboxToken(selectedEmployee, sandbox, token);
      const assignment = { agent: routedAgent, mode: composerMode };
      // The active session now tails live over SSE (useSessionEvents), so no
      // per-run polling loop is needed while the run is in flight.
      const done = await runSandboxMutation.mutateAsync({
        input: {
          sandboxId: sandbox.id,
          taskGoal: goal,
          assignments: [assignment],
          sessionId,
          ...(sessionId ? { userMessageId } : {}),
        },
        token,
      });
      setActiveSessionId(done.id);
      setSelectedSessionId(done.id);
      setComposingNew(false);
      syncChatHash(done.id, true);
      await refresh(undefined, token);
    } catch (error) {
      setPendingUserMessage(null);
      reportMutationError("Failed to send message", error, t("errors.send_message"));
    } finally { setIsRunning(false); }
  }

  async function cancelActiveRun() {
    if (!selectedSandbox || !activeRun) return;
    try {
      const session = await cancelRunMutation.mutateAsync({
        sandboxId: selectedSandbox.id,
        sessionId: activeRun.sessionId,
        token: selectedToken,
        reason: t("cancel.reason"),
      });
      setSelectedSessionId(session.id);
      syncChatHash(session.id, true);
    } catch {
      // mutation onError surfaces a toast.
    }
  }

  const handleComposerSend = useStableEvent(() => { void sendMessage(); });
  const handleCancelRun = useStableEvent(() => { void cancelActiveRun(); });

  async function updateAgentRoleOverrides(overrides: AgentRoleMap) {
    if (!selectedNode) return;
    try {
      await updateDaemonNodeAgentRoleOverrides(selectedNode.id, overrides, selectedToken);
      await invalidateRelay();
    } catch (error) {
      reportMutationError("Failed to update agent roles", error, t("errors.task_action"));
    }
  }

  async function sendDecision(kind: "approve" | "reject" | "rerun" | "mark_done") {
    if (!activeSession) return;
    if (kind === "rerun") {
      if (!selectedEmployee) return;
      setIsRunning(true);
      try {
        const { sandbox, token } = await provisionEmployeeSandbox(selectedEmployee, selectedToken);
        rememberSandboxToken(selectedEmployee, sandbox, token);
        const assignment = rerunAssignmentForSession(activeSession, activeAgent, composerMode);
        setActiveAgent(assignment.agent);
        setSelectedSessionId(activeSession.id);
        navigateToRoute("main");
        atBottomRef.current = true;
        const done = await runSandboxMutation.mutateAsync({
          input: {
            sandboxId: sandbox.id,
            taskGoal: activeSession.taskGoal,
            assignments: [assignment],
            sessionId: activeSession.id,
            decision: { kind: "rerun", targetAgent: assignment.agent },
          },
          token,
        });
        setSelectedSessionId(done.id);
        syncChatHash(done.id, true);
        await refresh(undefined, token);
      } catch (error) {
        reportMutationError("Failed to rerun assignment", error, t("errors.rerun_assignment"));
      } finally {
        setIsRunning(false);
      }
      return;
    }
    try {
      const session = await recordDecisionMutation.mutateAsync({
        sessionId: activeSession.id,
        kind,
        token: selectedToken,
      });
      setSelectedSessionId(session.id);
      syncChatHash(session.id, true);
    } catch {
      // mutation onError surfaces a toast.
    }
  }

  async function sendHandoff() {
    if (!activeSession) return;
    if (!selectedEmployee) return;
    setIsRunning(true);
    try {
      const { sandbox, token } = await provisionEmployeeSandbox(selectedEmployee, selectedToken);
      rememberSandboxToken(selectedEmployee, sandbox, token);
      const note = handoffNote.trim();
      const assignment = { agent: handoffAgent, mode: handoffMode };
      const done = await runSandboxMutation.mutateAsync({
        input: {
          sandboxId: sandbox.id,
          taskGoal: activeSession.taskGoal,
          assignments: [assignment],
          sessionId: activeSession.id,
          decision: { kind: "handoff", targetAgent: handoffAgent, ...(note ? { note } : {}) },
        },
        token,
      });
      setSelectedSessionId(done.id); setHandoffNote(""); setHandoffMode("action"); setHandoffOpen(false); setActiveAgent(handoffAgent);
      syncChatHash(done.id, true);
      await refresh(undefined, token);
    } catch (error) {
      reportMutationError("Failed to send handoff", error, t("errors.send_handoff"));
    } finally { setIsRunning(false); }
  }


  async function handleLogout() {
    try {
      await logout();
    } catch {
      // ignore
    }
    setUser(null);
    navigateToRoute("main");
    syncChatHash(null, true);
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
    <AppShell
      route={route}
      onNavigateRoute={navigateToRoute}
      hrefForRoute={hrefForSideNavRoute}
      mobileView={mobileView}
      onMobileViewChange={navigateToMobileView}
      sidenavExpanded={sidenavExpanded}
      setSidenavExpanded={setSidenavExpanded}
      prefsOpen={prefsOpen}
      setPrefsOpen={setPrefsOpen}
      skipLinkHref={skipLinkHref}
      activeConversationLabel={activeConversationLabel}
      user={user}
      onLogout={() => void handleLogout()}
      theme={theme}
      onThemeChange={setTheme}
      language={language}
      onLanguageChange={setLanguage}
      selectedNode={selectedNode}
      onAgentRoleOverridesChange={updateAgentRoleOverrides}
    >
      <Suspense fallback={<RouteFallback />}>
        {route === "admin" ? <AdminConsole /> : route === "channels" ? <ChannelsPage /> : route === "workspace" ? (
          <EmployeeWorkspacePage
            employeeId={selectedEmployee}
            currentUser={user}
            isRefreshing={isRefreshing}
            onRefresh={() => refresh()}
            onOpenConversation={openConversation}
          />
        ) : route === "backlog" ? (
          <BacklogPage
            tasks={tasks}
            sessions={sessions}
            nodes={visibleNodes}
            currentUser={user}
            isRefreshing={isRefreshing}
            onRefresh={() => refresh()}
            onOpenConversation={openConversation}
          />
        ) : route === "routine" ? (
          <RoutinePage
            tasks={tasks}
            sessions={sessions}
            nodes={visibleNodes}
            currentUser={user}
            isRefreshing={isRefreshing}
            onRefresh={() => refresh()}
            onOpenConversation={openConversation}
          />
        ) : (
          <MainChatView
            filteredConversations={filteredConversations}
            employeeQuery={employeeQuery}
            setEmployeeQuery={setEmployeeQuery}
            activeSession={activeSession}
            pendingUserMessage={pendingUserMessage}
            displayMessages={displayMessages}
            awaitingDecision={awaitingDecision}
            transcriptRef={transcriptRef}
            composerRef={composerRef}
            onTranscriptScroll={handleTranscriptScroll}
            onSelectConversation={openConversation}
            onNewConversation={startNewConversation}
            onRenameConversation={(session) => void renameConversation(session)}
            onCloseConversation={(id) => void closeConversation(id)}
            activeAgent={activeAgent}
            setActiveAgent={setActiveAgent}
            agentNames={agents}
            disabledAgents={selectedNode?.disabledAgents}
            agentHealth={selectedNode?.agents}
            runningAgent={activeRun?.agent}
            isRefreshing={isRefreshing}
            artifactCount={visibleArtifacts.length}
            visibleArtifacts={visibleArtifacts}
            artifactsDrawerOpen={artifactsDrawerOpen}
            initialArtifactId={initialArtifactId}
            onOpenArtifacts={openArtifactsDrawer}
            onCloseArtifactsDrawer={() => setArtifactsDrawerOpen(false)}
            onRefresh={() => void refresh()}
            onBackToThreads={() => navigateToMobileView("threads")}
            selectedEmployee={selectedEmployee}
            agentDescriptors={agentDescriptors}
            agentRoleLabels={agentRoleLabels}
            composerMode={composerMode}
            setComposerMode={setComposerMode}
            handoffOpen={handoffOpen}
            setHandoffOpen={setHandoffOpen}
            handoffAgent={handoffAgent}
            setHandoffAgent={setHandoffAgent}
            handoffMode={handoffMode}
            setHandoffMode={setHandoffMode}
            handoffNote={handoffNote}
            setHandoffNote={setHandoffNote}
            sendDecision={sendDecision}
            sendHandoff={sendHandoff}
            onAgentPicked={setActiveAgent}
            onSend={handleComposerSend}
            onCancelRun={handleCancelRun}
            running={Boolean(activeRun)}
          />
        )}
      </Suspense>
    </AppShell>
  );
}
