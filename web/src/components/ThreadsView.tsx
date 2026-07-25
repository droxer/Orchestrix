"use client";

import { useMemo, type Dispatch, RefObject, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRightLeft, MessageCircleQuestion, Scan } from "lucide-react";
import { RelayMark } from "./RelayMark";
import type { AgentName, AgentTaskMode, EmployeeAgent, RelayArtifact, RelaySession } from "../types";
import {
  buildExecutorDisplayNameMap,
  buildLogicalAgentNameMap,
  displayNameForExecutor,
  labelForAgentRun,
} from "../lib/agentDisplayNames";
import type { ThreadItem } from "./ThreadRow";
import { ThreadListPanel } from "./ThreadListPanel";
import { ThreadHeader } from "./ThreadHeader";
import { TranscriptEmpty } from "./TranscriptEmpty";
import { MessageBlock, isGroupedContinuation, type DerivedMessage } from "./MessageBlock";
import { phaseDividerLabel } from "../lib/projectMessages";
import { DecisionBar } from "./composer/DecisionBar";
import { Composer, type ComposerHandle } from "./composer/Composer";
import { ArtifactsDrawer } from "./artifact/ArtifactsDrawer";

export type ThreadsViewProps = {
  filteredThreads: ThreadItem[];
  threadQuery: string;
  setThreadQuery: Dispatch<SetStateAction<string>>;
  activeSession: RelaySession | undefined;
  pendingUserMessage: { id: string; text: string } | null;
  displayMessages: DerivedMessage[];
  awaitingDecision: boolean;
  transcriptRef: RefObject<HTMLDivElement | null>;
  composerRef: RefObject<ComposerHandle | null>;
  onTranscriptScroll: () => void;
  onSelectThread: (sessionId: string) => void;
  onNewThread: () => void;
  onRenameThread: (session: RelaySession) => void;
  onCloseThread: (sessionId: string) => void;
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
  onSend: () => void;
  onCancelRun: () => void;
  onRetryAgent: (agent: AgentName, mode: AgentTaskMode, agentId?: string) => void;
  running: boolean;
};

export function ThreadsView({
  filteredThreads,
  threadQuery,
  setThreadQuery,
  activeSession,
  pendingUserMessage,
  displayMessages,
  awaitingDecision,
  transcriptRef,
  composerRef,
  onTranscriptScroll,
  onSelectThread,
  onNewThread,
  onRenameThread,
  onCloseThread,
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
  onSend,
  onCancelRun,
  onRetryAgent,
  running,
}: ThreadsViewProps) {
  const { t } = useTranslation();
  const agentDisplayNames = useMemo(() => buildExecutorDisplayNameMap(logicalAgents), [logicalAgents]);
  const logicalAgentNames = useMemo(() => buildLogicalAgentNameMap(logicalAgents), [logicalAgents]);
  const activeAgentDisplayName = useMemo(() => {
    const logical = logicalAgents.find((agent) => agent.id === activeLogicalAgentId && !agent.deletedAt);
    return logical?.displayName ?? displayNameForExecutor(activeAgent, logicalAgents);
  }, [activeAgent, activeLogicalAgentId, logicalAgents]);
  // Name the agent actually running this thread. The in-flight run carries the
  // logical agent id; without it the executor kind would name whichever agent
  // happens to share that kind.
  const runningAgentDisplayName = useMemo(() => {
    if (!runningAgent) return undefined;
    const runningRun = activeSession?.agentRuns.find((run) => run.status === "running");
    return labelForAgentRun(
      { agent: runningAgent, agentId: runningRun?.logicalAgentId },
      logicalAgentNames,
      agentDisplayNames,
    );
  }, [activeSession, agentDisplayNames, logicalAgentNames, runningAgent]);

  return (
    <>
      <ThreadListPanel
        threads={filteredThreads}
        query={threadQuery}
        setQuery={setThreadQuery}
        selectedSessionId={activeSession?.id}
        onSelectThread={onSelectThread}
        onNewThread={onNewThread}
        onRenameThread={onRenameThread}
        onCloseThread={onCloseThread}
      />

      <section id="chat-panel" className="chat-panel" aria-label={t("nav.threads")} tabIndex={-1}>
        <ThreadHeader
          activeSession={activeSession}
          runningAgent={runningAgent}
          runningAgentDisplayName={runningAgentDisplayName}
          isRefreshing={isRefreshing}
          artifactCount={artifactCount}
          onOpenArtifacts={onOpenArtifacts}
          onRefresh={onRefresh}
          onBackToThreads={onBackToThreads}
        />

        <div className="transcript" ref={transcriptRef} onScroll={onTranscriptScroll} role="log" aria-live="polite" aria-atomic="false">
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
                        logicalAgentNames={logicalAgentNames}
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
          composerMode={composerMode}
          setComposerMode={setComposerMode}
          activeAgent={activeAgent}
          logicalAgents={logicalAgents}
          activeLogicalAgentId={activeLogicalAgentId}
          onLogicalAgentPicked={onLogicalAgentPicked}
          activeAgentDisplayName={activeAgentDisplayName}
          selectedEmployee={selectedEmployee}
          running={running}
          onSend={onSend}
          onCancelRun={onCancelRun}
        />
      </section>

      <ArtifactsDrawer
        open={artifactsDrawerOpen}
        onClose={onCloseArtifactsDrawer}
        sessionId={activeSession?.id ?? ""}
        artifacts={visibleArtifacts}
        initialArtifactId={initialArtifactId ?? undefined}
      />
    </>
  );
}
