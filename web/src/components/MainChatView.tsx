"use client";

import { useMemo, type Dispatch, RefObject, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRightLeft, MessageCircleQuestion, Scan } from "lucide-react";
import { RelayMark } from "./RelayMark";
import type { AgentName, AgentTaskMode, EmployeeAgent, RelayArtifact, RelaySession } from "../types";
import { buildExecutorDisplayNameMap, displayNameForExecutor, mentionableAgents, type MentionableAgent } from "../lib/agentDisplayNames";
import type { ConversationItem } from "./ConversationRow";
import { ThreadPanel } from "./ThreadPanel";
import { ChatHeader } from "./ChatHeader";
import { TranscriptEmpty } from "./TranscriptEmpty";
import { MessageBlock, isGroupedContinuation, type DerivedMessage } from "./MessageBlock";
import { phaseDividerLabel } from "../lib/projectMessages";
import { DecisionBar } from "./composer/DecisionBar";
import { Composer, type ComposerHandle } from "./composer/Composer";
import { ArtifactLibraryDrawer } from "./artifact/ArtifactLibraryDrawer";

export type MainChatViewProps = {
  filteredConversations: ConversationItem[];
  employeeQuery: string;
  setEmployeeQuery: Dispatch<SetStateAction<string>>;
  activeSession: RelaySession | undefined;
  pendingUserMessage: { id: string; text: string } | null;
  displayMessages: DerivedMessage[];
  awaitingDecision: boolean;
  transcriptRef: RefObject<HTMLDivElement | null>;
  composerRef: RefObject<ComposerHandle | null>;
  onTranscriptScroll: () => void;
  onSelectConversation: (sessionId: string) => void;
  onNewConversation: () => void;
  onRenameConversation: (session: RelaySession) => void;
  onCloseConversation: (sessionId: string) => void;
  activeAgent: AgentName;
  logicalAgents: EmployeeAgent[];
  activeLogicalAgentId: string | null;
  onLogicalAgentPicked: (agent: EmployeeAgent) => void;
  runningAgent: AgentName | undefined;
  isRefreshing: boolean;
  artifactCount: number;
  visibleArtifacts: RelayArtifact[];
  artifactsDrawerOpen: boolean;
  initialArtifactId: string | null;
  onOpenArtifacts: (artifact?: RelayArtifact) => void;
  onCloseArtifactsDrawer: () => void;
  onRefresh: () => void;
  onBackToThreads: () => void;
  selectedEmployee: string;
  agentDescriptors: Record<AgentName, { blurb: string }>;
  composerMode: AgentTaskMode;
  setComposerMode: Dispatch<SetStateAction<AgentTaskMode>>;
  handoffOpen: boolean;
  setHandoffOpen: Dispatch<SetStateAction<boolean>>;
  handoffAgentId: string;
  setHandoffAgentId: Dispatch<SetStateAction<string>>;
  handoffMode: AgentTaskMode;
  setHandoffMode: Dispatch<SetStateAction<AgentTaskMode>>;
  handoffNote: string;
  setHandoffNote: Dispatch<SetStateAction<string>>;
  sendDecision: (kind: "approve" | "reject" | "rerun" | "mark_done") => Promise<void>;
  sendHandoff: () => Promise<void>;
  onAgentPicked: (agent: MentionableAgent) => void;
  onSend: () => void;
  onCancelRun: () => void;
  onRetryAgent: (agent: AgentName, mode: AgentTaskMode) => void;
  running: boolean;
};

export function MainChatView({
  filteredConversations,
  employeeQuery,
  setEmployeeQuery,
  activeSession,
  pendingUserMessage,
  displayMessages,
  awaitingDecision,
  transcriptRef,
  composerRef,
  onTranscriptScroll,
  onSelectConversation,
  onNewConversation,
  onRenameConversation,
  onCloseConversation,
  activeAgent,
  logicalAgents,
  activeLogicalAgentId,
  onLogicalAgentPicked,
  runningAgent,
  isRefreshing,
  artifactCount,
  visibleArtifacts,
  artifactsDrawerOpen,
  initialArtifactId,
  onOpenArtifacts,
  onCloseArtifactsDrawer,
  onRefresh,
  onBackToThreads,
  selectedEmployee,
  agentDescriptors,
  composerMode,
  setComposerMode,
  handoffOpen,
  setHandoffOpen,
  handoffAgentId,
  setHandoffAgentId,
  handoffMode,
  setHandoffMode,
  handoffNote,
  setHandoffNote,
  sendDecision,
  sendHandoff,
  onAgentPicked,
  onSend,
  onCancelRun,
  onRetryAgent,
  running,
}: MainChatViewProps) {
  const { t } = useTranslation();
  const mentionAgents = useMemo(() => mentionableAgents(logicalAgents), [logicalAgents]);
  const agentDisplayNames = useMemo(() => buildExecutorDisplayNameMap(logicalAgents), [logicalAgents]);
  const activeAgentDisplayName = useMemo(() => {
    const logical = logicalAgents.find((agent) => agent.id === activeLogicalAgentId && !agent.deletedAt);
    return logical?.displayName ?? displayNameForExecutor(activeAgent, logicalAgents);
  }, [activeAgent, activeLogicalAgentId, logicalAgents]);
  const runningAgentDisplayName = useMemo(
    () => (runningAgent ? displayNameForExecutor(runningAgent, logicalAgents) : undefined),
    [logicalAgents, runningAgent],
  );

  return (
    <>
      <ThreadPanel
        conversations={filteredConversations}
        query={employeeQuery}
        setQuery={setEmployeeQuery}
        selectedSessionId={activeSession?.id}
        onSelectConversation={onSelectConversation}
        onNewConversation={onNewConversation}
        onRenameConversation={onRenameConversation}
        onCloseConversation={onCloseConversation}
      />

      <section id="chat-panel" className="chat-panel" aria-label={t("nav.conversations")} tabIndex={-1}>
        <ChatHeader
          activeAgent={activeAgent}
          logicalAgents={logicalAgents}
          activeLogicalAgentId={activeLogicalAgentId}
          onLogicalAgentPicked={onLogicalAgentPicked}
          activeSession={activeSession}
          runningAgent={runningAgent}
          runningAgentDisplayName={runningAgentDisplayName}
          isRefreshing={isRefreshing}
          artifactCount={artifactCount}
          onOpenArtifacts={onOpenArtifacts}
          onRefresh={onRefresh}
          onBackToThreads={onBackToThreads}
        />

        <div className="transcript" ref={transcriptRef} onScroll={onTranscriptScroll}>
          <div className="transcript-inner">
            {activeSession || pendingUserMessage ? (
              <>
                {displayMessages.map((msg, i) => {
                  const phaseLabel = phaseDividerLabel(displayMessages, i, t);
                  const prev = i > 0 ? displayMessages[i - 1] : undefined;
                  const isHandoff =
                    msg.kind === "agent" && prev?.kind === "agent" && prev.agent !== msg.agent;
                  // The generic agent-phase marker carries the Relay product
                  // mark — "the agent" as a product — while each turn header
                  // keeps its specific executor glyph. Ask/Review/Handoff keep
                  // their own semantic lucide icons.
                  const isAgentPhase =
                    msg.kind === "agent" && !isHandoff && msg.mode === "action";
                  const PhaseIcon =
                    msg.kind === "agent"
                      ? isHandoff
                        ? ArrowRightLeft
                        : msg.mode === "ask"
                          ? MessageCircleQuestion
                          : msg.mode === "review"
                            ? Scan
                            : null
                      : null;
                  return (
                    <div key={msg.id} className="transcript-turn">
                      {phaseLabel ? (
                        <div className="transcript-phase" role="separator" aria-label={phaseLabel}>
                          <span className="transcript-phase-node" aria-hidden="true" />
                          <span className="transcript-phase-label">
                            {isAgentPhase ? (
                              <RelayMark width={12} height={12} className="transcript-phase-icon transcript-phase-mark" />
                            ) : PhaseIcon ? (
                              <PhaseIcon size={12} className="transcript-phase-icon" aria-hidden="true" />
                            ) : null}
                            {phaseLabel}
                          </span>
                        </div>
                      ) : null}
                      <MessageBlock
                        message={msg}
                        sessionId={activeSession?.id ?? ""}
                        grouped={isGroupedContinuation(displayMessages, i)}
                        agentDisplayNames={agentDisplayNames}
                        onOpenArtifact={onOpenArtifacts}
                        onRetryAgent={onRetryAgent}
                        retryDisabled={running}
                      />
                    </div>
                  );
                })}
                {awaitingDecision ? (
                  <DecisionBar
                    logicalAgents={logicalAgents}
                    sendDecision={sendDecision}
                    handoffOpen={handoffOpen}
                    setHandoffOpen={setHandoffOpen}
                    handoffAgentId={handoffAgentId}
                    setHandoffAgentId={setHandoffAgentId}
                    handoffMode={handoffMode}
                    setHandoffMode={setHandoffMode}
                    handoffNote={handoffNote}
                    setHandoffNote={setHandoffNote}
                    sendHandoff={sendHandoff}
                  />
                ) : null}
              </>
            ) : (
              <TranscriptEmpty
                selectedEmployee={selectedEmployee}
                activeAgent={activeAgent}
                activeAgentDisplayName={activeAgentDisplayName}
                agentDescriptors={agentDescriptors}
              />
            )}
          </div>
        </div>

        <Composer
          ref={composerRef}
          mentionAgents={mentionAgents}
          composerMode={composerMode}
          setComposerMode={setComposerMode}
          activeAgentDisplayName={activeAgentDisplayName}
          selectedEmployee={selectedEmployee}
          running={running}
          onAgentPicked={onAgentPicked}
          onSend={onSend}
          onCancelRun={onCancelRun}
        />
      </section>

      <ArtifactLibraryDrawer
        open={artifactsDrawerOpen}
        onClose={onCloseArtifactsDrawer}
        sessionId={activeSession?.id ?? ""}
        artifacts={visibleArtifacts}
        initialArtifactId={initialArtifactId ?? undefined}
      />
    </>
  );
}
