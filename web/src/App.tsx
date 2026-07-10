"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { logout } from "./api";
import { AGENT_NAMES } from "./types";
import type { AgentName, AgentTaskMode, CurrentUser, DaemonNodeMonitorRecord, EmployeeAgent, RelayArtifact, RelaySession } from "./types";
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
import { formatDispatchError } from "./lib/agentReadiness";
import { applyTheme, readLanguage, readTheme, readTokens, selectedEmployeeKey, writeLanguage, writeTheme } from "./lib/appStorage";
import { canUseLocalControlPanel } from "./lib/controlPanel";
import { useRelayStore } from "./lib/store";
import { useAuthSession } from "./hooks/useAuthSession";
import { useClientMounted } from "./hooks/useClientMounted";
import { useActiveSession } from "./hooks/useActiveSession";
import { chooseSendAction, suppressActiveSessionDuringPendingSend } from "./lib/sendAction";
import { myConversationSessions, matchesConversationQuery, pickActiveConversationSession } from "./lib/conversations";
import { shouldTailSessionEvents } from "./lib/sessionEventStream";
import { useEmployeeProvisioning } from "./hooks/useEmployeeProvisioning";
import { useEmployeeAgents } from "./hooks/useEmployeeAgents";
import { isAwaitingFeedbackDecision, rerunAssignmentForSession } from "./lib/workflow";
import { useDialogs } from "./components/ui/DialogProvider";
import { AppShell, RouteFallback } from "./components/AppShell";
import { MainChatView } from "./components/MainChatView";
import type { ComposerHandle } from "./components/composer/Composer";
import type { DerivedMessage } from "./components/MessageBlock";
import { projectMessages } from "./components/MessageBlock";
import type { AppRoute } from "./lib/viewTypes";
import { visibleConversationArtifacts } from "./lib/conversationArtifacts";
import {
  canCancelConversationRun,
  conversationCancelNodeId,
  findActiveRunOwnerForSession,
  isConversationRunInFlight,
} from "./lib/conversationRunning";

const AdminConsole = lazy(() => import("./components/AdminConsole").then((m) => ({ default: m.AdminConsole })));
const BacklogPage = lazy(() => import("./components/BacklogPage").then((m) => ({ default: m.BacklogPage })));
const ChannelsPage = lazy(() => import("./components/ChannelsPage").then((m) => ({ default: m.ChannelsPage })));
const EmployeeWorkspacePage = lazy(() => import("./components/EmployeeWorkspacePage").then((m) => ({ default: m.EmployeeWorkspacePage })));
const RoutinePage = lazy(() => import("./components/RoutinePage").then((m) => ({ default: m.RoutinePage })));
const AgentsPage = lazy(() => import("./components/AgentsPage").then((m) => ({ default: m.AgentsPage })));

const agents: AgentName[] = AGENT_NAMES;

const WORK_ROUTE_SKIP_IDS: Record<Exclude<AppRoute, "main">, string> = {
  workspace: "workspace-panel",
  backlog: "backlog-panel",
  routine: "routine-panel",
  agents: "agents-panel",
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
    runLogicalAgentsMutation,
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
  const [activeLogicalAgentId, setActiveLogicalAgentId] = useState<string | null>(null);
  const [composerMode, setComposerMode] = useState<AgentTaskMode>("action");
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [sidenavExpanded, setSidenavExpanded] = useState(true);
  const [theme, setTheme] = useState<Theme>("system");
  const [language, setLanguage] = useState<Language>("en");
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [artifactsDrawerOpen, setArtifactsDrawerOpen] = useState(false);
  const [initialArtifactId, setInitialArtifactId] = useState<string | null>(null);
  const [handoffAgentId, setHandoffAgentId] = useState<string>("");
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
  const mounted = useClientMounted();
  const { agents: logicalAgents } = useEmployeeAgents(user?.employeeId);
  const localNodeAdoptionStartedRef = useRef(false);
  const composerRef = useRef<ComposerHandle>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const selectedEmployeeToken = tokens[selectedEmployee];
  const { sandboxes, nodes, sessions, tasks, isRefreshing, refresh, setSandboxes } = useRelayData(selectedEmployeeToken, Boolean(user));
  const { localNodes, refreshLocalDaemonNodes } = useLocalDaemonNodes(
    hydrated && user?.role === "admin" && canUseLocalControlPanel(),
  );
  const visibleNodes = useMemo(() => mergeVisibleDaemonNodes(nodes, localNodes), [nodes, localNodes]);
  const selectedSandbox = useMemo(() => sandboxes.find((s) => s.employeeId === selectedEmployee), [sandboxes, selectedEmployee]);
  const selectedNode = useMemo(() => visibleNodes.find((n) => n.employeeId === selectedEmployee || n.id === selectedSandbox?.id), [visibleNodes, selectedEmployee, selectedSandbox?.id]);
  const activeLogicalAgent = useMemo(
    () => logicalAgents.find((agent) => agent.id === activeLogicalAgentId),
    [activeLogicalAgentId, logicalAgents],
  );
  const logicalExecutorHealth = useMemo(() => Object.fromEntries(
    agents.map((executorKind) => [
      executorKind,
      logicalAgents.some((agent) => agent.executorKind === executorKind && agent.availability === "ready")
        ? "ready"
        : "failed",
    ]),
  ) as Partial<Record<AgentName, "ready" | "failed">>, [logicalAgents]);
  const unavailableLogicalExecutors = useMemo(() => agents.filter(
    (executorKind) => logicalExecutorHealth[executorKind] !== "ready",
  ), [logicalExecutorHealth]);
  const agentRoleLabels = useMemo<Partial<Record<AgentName, string>>>(() => Object.fromEntries(
    agents.map((executorKind) => {
      return [executorKind, t(`agent.${executorKind}.role`)];
    }),
  ) as Partial<Record<AgentName, string>>, [logicalAgents, t]);
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
  const activeRunOwner = useMemo(
    () => findActiveRunOwnerForSession(visibleNodes, activeSession?.id),
    [visibleNodes, activeSession?.id],
  );
  const activeRun = activeRunOwner?.run;
  const conversationRunning = isConversationRunInFlight({
    activeRun,
    session: activeSession,
    pendingSend: pendingUserMessage !== null,
    dispatchingRun: isRunning,
  });
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
    const runningBy = new Map(visibleNodes.flatMap((node) => node.activeRuns.map((run) => [run.sessionId, run.agent] as const)));
    return myConversations.map((session) => ({ session, runningAgent: runningBy.get(session.id) }));
  }, [myConversations, visibleNodes]);
  const filteredConversations = useMemo(
    () => conversations.filter((c) => matchesConversationQuery(c.session, employeeQuery)),
    [conversations, employeeQuery],
  );

  const refreshWithToken = useCallback(async (tokenOverride?: string) => {
    await refresh(undefined, tokenOverride);
  }, [refresh]);

  const { adoptLocalDaemonNodes } = useEmployeeProvisioning({
    nodes,
    setSandboxes,
    refreshLocalDaemonNodes,
    refreshWithToken,
  });

  useEffect(() => {
    if (!mounted) return;
    setTheme(readTheme());
    setLanguage(readLanguage());
  }, [mounted]);

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
    if (logicalAgents.length === 0) {
      setActiveLogicalAgentId(null);
      return;
    }
    const selected = logicalAgents.find((agent) => agent.id === activeLogicalAgentId && agent.availability === "ready")
      ?? logicalAgents.find((agent) => agent.availability === "ready")
      ?? logicalAgents[0];
    setActiveLogicalAgentId(selected.id);
    setActiveAgent(selected.executorKind);
    if (!logicalAgents.some((agent) => agent.id === handoffAgentId && agent.availability === "ready")) {
      setHandoffAgentId(logicalAgents.find((agent) => agent.availability === "ready")?.id ?? "");
    }
  }, [activeLogicalAgentId, handoffAgentId, logicalAgents]);
  useEffect(() => {
    if ((route === "admin" || route === "channels") && user && user.role !== "admin") {
      navigateToRoute("main");
    }
  }, [navigateToRoute, route, user]);
  useEffect(() => {
    const el = transcriptRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [displayMessages.length, activeSession?.id]);

  // The effect above only fires when a block is added or the session changes.
  // A single agent turn streaming a long response grows one block's height
  // without changing the count, so in a conversation tall enough to overflow
  // the transcript the new output scrolls below the fold and the view freezes
  // at the start of the response. Observe the content height and keep the
  // transcript pinned to the newest output whenever the user is at the bottom.
  useEffect(() => {
    const el = transcriptRef.current;
    const content = el?.firstElementChild;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [activeSession?.id]);

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

  function openAgentWorkspace(agent: EmployeeAgent) {
    setActiveLogicalAgentId(agent.id);
    setActiveAgent(agent.executorKind);
    navigateToRoute("workspace");
  }

  function startConversationWithAgent(agent: EmployeeAgent) {
    setActiveLogicalAgentId(agent.id);
    setActiveAgent(agent.executorKind);
    startNewConversation();
    navigateToRoute("main");
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
    if (conversationRunning) return;
    const goal = raw;
    const routedAgent = activeAgent;
    if (!goal) return;
    const routedLogicalAgent = activeLogicalAgent?.availability === "ready" ? activeLogicalAgent : undefined;
    if (!routedLogicalAgent) {
      reportMutationError("Agent not ready for dispatch", null, t("errors.agent_not_ready", { agent: routedAgent }));
      return;
    }
    if (routedAgent !== activeAgent) setActiveAgent(routedAgent);
    if (routedLogicalAgent) setActiveLogicalAgentId(routedLogicalAgent.id);
    // When staging a new conversation, always create; otherwise continue the
    // open one. composingNew forces a fresh owner-scoped session here.
    const action = composingNew ? { kind: "create" as const } : chooseSendAction({ activeSessionId: activeSession?.id ?? null, session: activeSession });
    const sessionId = action.kind === "append" ? action.sessionId : undefined;
    const creatingSession = suppressActiveSessionDuringPendingSend(action);
    // Echo the turn immediately. For a continued session we mint the message id
    // here and hand it to the backend so the persisted event reconciles by id.
    const userMessageId = `evt_${crypto.randomUUID()}`;
    // While creating a fresh conversation, keep suppressing the previous active
    // thread so the optimistic user turn does not appear in the wrong transcript.
    if (!creatingSession) setComposingNew(false);
    // Route synchronization clears any pending message when it reapplies an
    // existing session from the URL. Navigate before adding this optimistic
    // turn so that cleanup cannot erase the message in the same render batch.
    navigateToRoute("main");
    setPendingUserMessage({ id: userMessageId, text: goal });
    setIsRunning(true);
    composerRef.current?.clear();
    atBottomRef.current = true;
    try {
      const done = await runLogicalAgentsMutation.mutateAsync({
        taskGoal: goal,
        assignments: [{ agentId: routedLogicalAgent.id, mode: composerMode }],
        sessionId,
        ...(sessionId ? { userMessageId } : {}),
      });
      setActiveSessionId(done.id);
      setSelectedSessionId(done.id);
      setComposingNew(false);
      syncChatHash(done.id, true);
      await refresh();
    } catch (error) {
      setPendingUserMessage(null);
      reportMutationError(
        "Failed to send message",
        error,
        formatDispatchError(error, t) ?? t("errors.send_message"),
      );
    } finally { setIsRunning(false); }
  }

  async function cancelActiveRun() {
    if (!activeSession) return;
    if (!canCancelConversationRun({ activeRun, session: activeSession })) return;
    const cancelNodeId = conversationCancelNodeId({ node: activeRunOwner?.node ?? selectedNode, sandbox: selectedSandbox });
    if (!cancelNodeId) return;
    try {
      const session = await cancelRunMutation.mutateAsync({
        sandboxId: cancelNodeId,
        sessionId: activeRun?.sessionId ?? activeSession.id,
        token: tokens[cancelNodeId] ?? selectedToken,
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
  const handleRetryAgent = useStableEvent((agent: AgentName, mode: AgentTaskMode) => { void retryAgentMessage(agent, mode); });

  async function sendDecision(kind: "approve" | "reject" | "rerun" | "mark_done") {
    if (!activeSession) return;
    if (kind === "rerun") {
      if (!selectedEmployee) return;
      if (conversationRunning) return;
      setIsRunning(true);
      try {
        const assignment = rerunAssignmentForSession(activeSession, activeAgent, composerMode);
        const logicalAgent = logicalAgents.find(
          (agent) => agent.executorKind === assignment.agent && agent.availability === "ready",
        );
        if (!logicalAgent) {
          reportMutationError(
            "Agent not ready for rerun",
            null,
            t("errors.agent_not_ready", { agent: assignment.agent }),
          );
          return;
        }
        setActiveAgent(assignment.agent);
        setSelectedSessionId(activeSession.id);
        navigateToRoute("main");
        atBottomRef.current = true;
        const done = await runLogicalAgentsMutation.mutateAsync({
            taskGoal: activeSession.taskGoal,
            assignments: [{ agentId: logicalAgent.id, mode: assignment.mode }],
            sessionId: activeSession.id,
            decision: { kind: "rerun", targetAgent: assignment.agent },
          });
        setSelectedSessionId(done.id);
        syncChatHash(done.id, true);
        await refresh();
      } catch (error) {
        reportMutationError(
          "Failed to rerun assignment",
          error,
          formatDispatchError(error, t) ?? t("errors.rerun_assignment"),
        );
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

  async function retryAgentMessage(agent: AgentName, mode: AgentTaskMode) {
    if (!activeSession) return;
    if (!selectedEmployee) return;
    if (conversationRunning) return;
    setIsRunning(true);
    try {
      const logicalAgent = logicalAgents.find(
        (candidate) => candidate.executorKind === agent && candidate.availability === "ready",
      );
      if (!logicalAgent) {
        reportMutationError("Agent not ready for retry", null, t("errors.agent_not_ready", { agent }));
        return;
      }
      setActiveAgent(agent);
      setComposerMode(mode);
      setSelectedSessionId(activeSession.id);
      navigateToRoute("main");
      atBottomRef.current = true;
      const done = await runLogicalAgentsMutation.mutateAsync({
          taskGoal: activeSession.taskGoal,
          assignments: [{ agentId: logicalAgent.id, mode }],
          sessionId: activeSession.id,
          decision: { kind: "rerun", targetAgent: agent },
        });
      setSelectedSessionId(done.id);
      syncChatHash(done.id, true);
      await refresh();
    } catch (error) {
      reportMutationError(
        "Failed to retry agent response",
        error,
        formatDispatchError(error, t) ?? t("errors.rerun_assignment"),
      );
    } finally {
      setIsRunning(false);
    }
  }

  async function sendHandoff() {
    if (!activeSession) return;
    if (!selectedEmployee) return;
    if (conversationRunning) return;
    const logicalAgent = logicalAgents.find(
      (agent) => agent.id === handoffAgentId && agent.availability === "ready",
    );
    if (!logicalAgent) {
      reportMutationError("Agent not ready for handoff", null, t("errors.agent_not_ready", { agent: handoffAgentId }));
      return;
    }
    setIsRunning(true);
    try {
      const note = handoffNote.trim();
      const done = await runLogicalAgentsMutation.mutateAsync({
          taskGoal: activeSession.taskGoal,
          assignments: [{ agentId: logicalAgent.id, mode: handoffMode }],
          sessionId: activeSession.id,
          decision: { kind: "handoff", targetAgent: logicalAgent.executorKind, ...(note ? { note } : {}) },
        });
      setSelectedSessionId(done.id); setHandoffNote(""); setHandoffMode("action"); setHandoffOpen(false); setActiveAgent(logicalAgent.executorKind); setActiveLogicalAgentId(logicalAgent.id);
      syncChatHash(done.id, true);
      await refresh();
    } catch (error) {
      reportMutationError(
        "Failed to send handoff",
        error,
        formatDispatchError(error, t) ?? t("errors.send_handoff"),
      );
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

  if (!mounted || !authChecked) {
    return (
      <main className="login-checking" aria-busy="true">
        <p className="login-checking-text" suppressHydrationWarning>
          {mounted ? t("login.checking") : "Checking authentication…"}
        </p>
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
    >
      <Suspense fallback={<RouteFallback />}>
        {route === "admin" ? <AdminConsole currentUser={user} /> : route === "channels" ? <ChannelsPage /> : route === "workspace" ? (
          <EmployeeWorkspacePage
            employeeId={selectedEmployee}
            agent={activeLogicalAgent}
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
        ) : route === "agents" ? (
          <AgentsPage
            currentUser={user}
            isRefreshing={isRefreshing}
            onRefresh={() => refresh()}
            onOpenWorkspace={openAgentWorkspace}
            onStartConversation={startConversationWithAgent}
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
            agentNames={agents}
            disabledAgents={unavailableLogicalExecutors}
            agentHealth={logicalExecutorHealth}
            logicalAgents={logicalAgents}
            activeLogicalAgentId={activeLogicalAgentId}
            onLogicalAgentPicked={(agent: EmployeeAgent) => {
              setActiveLogicalAgentId(agent.id);
              setActiveAgent(agent.executorKind);
            }}
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
            handoffAgentId={handoffAgentId}
            setHandoffAgentId={setHandoffAgentId}
            handoffMode={handoffMode}
            setHandoffMode={setHandoffMode}
            handoffNote={handoffNote}
            setHandoffNote={setHandoffNote}
            sendDecision={sendDecision}
            sendHandoff={sendHandoff}
            onAgentPicked={setActiveAgent}
            onSend={handleComposerSend}
            onCancelRun={handleCancelRun}
            onRetryAgent={handleRetryAgent}
            running={conversationRunning}
          />
        )}
      </Suspense>
    </AppShell>
  );
}
