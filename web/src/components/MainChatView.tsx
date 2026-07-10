"use client";

import type { Dispatch, RefObject, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { AgentName, AgentTaskMode, DaemonNodeMonitorRecord, RelayArtifact, RelaySession } from "../types";
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
  setActiveAgent: Dispatch<SetStateAction<AgentName>>;
  agentNames: AgentName[];
  disabledAgents: AgentName[] | undefined;
  agentHealth: DaemonNodeMonitorRecord["agents"] | undefined;
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
  agentDescriptors: Record<AgentName, { role: string; blurb: string }>;
  agentRoleLabels: Partial<Record<AgentName, string>>;
  composerMode: AgentTaskMode;
  setComposerMode: Dispatch<SetStateAction<AgentTaskMode>>;
  handoffOpen: boolean;
  setHandoffOpen: Dispatch<SetStateAction<boolean>>;
  handoffAgent: AgentName;
  setHandoffAgent: Dispatch<SetStateAction<AgentName>>;
  handoffMode: AgentTaskMode;
  setHandoffMode: Dispatch<SetStateAction<AgentTaskMode>>;
  handoffNote: string;
  setHandoffNote: Dispatch<SetStateAction<string>>;
  sendDecision: (kind: "approve" | "reject" | "rerun" | "mark_done") => Promise<void>;
  sendHandoff: () => Promise<void>;
  onAgentPicked: (agent: AgentName) => void;
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
  setActiveAgent,
  agentNames,
  disabledAgents,
  agentHealth,
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
  agentRoleLabels,
  composerMode,
  setComposerMode,
  handoffOpen,
  setHandoffOpen,
  handoffAgent,
  setHandoffAgent,
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
          setActiveAgent={setActiveAgent}
          agentNames={agentNames}
          disabledAgents={disabledAgents}
          agentHealth={agentHealth}
          activeSession={activeSession}
          runningAgent={runningAgent}
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
                  return (
                    <div key={msg.id} className="transcript-turn">
                      {phaseLabel ? (
                        <div className="transcript-phase" role="separator" aria-label={phaseLabel}>
                          <span className="transcript-phase-node" aria-hidden="true" />
                          <span className="transcript-phase-label">{phaseLabel}</span>
                        </div>
                      ) : null}
                      <MessageBlock
                        message={msg}
                        sessionId={activeSession?.id ?? ""}
                        grouped={isGroupedContinuation(displayMessages, i)}
                        onOpenArtifact={onOpenArtifacts}
                        onRetryAgent={onRetryAgent}
                        retryDisabled={running}
                      />
                    </div>
                  );
                })}
                {awaitingDecision ? (
                  <DecisionBar
                    agentNames={agentNames}
                    disabledAgents={disabledAgents}
                    sendDecision={sendDecision}
                    handoffOpen={handoffOpen}
                    setHandoffOpen={setHandoffOpen}
                    handoffAgent={handoffAgent}
                    setHandoffAgent={setHandoffAgent}
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
                agentDescriptors={agentDescriptors}
              />
            )}
          </div>
        </div>

        <Composer
          ref={composerRef}
          agentNames={agentNames}
          disabledAgents={disabledAgents}
          agentHealth={agentHealth}
          composerMode={composerMode}
          setComposerMode={setComposerMode}
          activeAgent={activeAgent}
          agentRoleLabels={agentRoleLabels}
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
