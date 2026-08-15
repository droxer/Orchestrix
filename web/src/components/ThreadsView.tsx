"use client";

import { useMemo, useState, type Dispatch, RefObject, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { ActionRoute } from "./icons";
import { RelayMark } from "./RelayMark";
import type { AgentName, AgentTeam, DaemonNodeMonitorRecord, EmployeeAgent, ProjectRecord, RelayArtifact, RelaySession } from "../types";
import {
  buildExecutorDisplayNameMap,
  buildLogicalAgentImageMap,
  buildLogicalAgentNameMap,
  displayNameForExecutor,
} from "../lib/agentDisplayNames";
import type { ThreadItem } from "./ThreadRow";
import type { MentionCandidate } from "../lib/mentions";
import { ThreadListPanel } from "./ThreadListPanel";
import { ThreadHeader } from "./ThreadHeader";
import { TranscriptEmpty } from "./TranscriptEmpty";
import { MessageBlock, isGroupedContinuation, type DerivedMessage } from "./MessageBlock";
import { phaseDividerLabel } from "../lib/projectMessages";
import { DecisionBar } from "./composer/DecisionBar";
import { Composer, type ComposerHandle } from "./composer/Composer";
import { ThreadSpacePanel } from "./space/ThreadSpacePanel";
import { buildSpaceItems, threadHasMultipleProducers } from "../lib/threadSpace";
import { ProjectDrawer } from "./ProjectDrawer";

export type ThreadsViewProps = {
  directoryMode: "threads" | "projects";
  filteredThreads: ThreadItem[];
  projects: ProjectRecord[];
  selectedProjectId: string | null;
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
  onSelectProject: (projectId: string | null) => void;
  onNewThread: (projectId?: string | null) => void;
  onRenameThread: (session: RelaySession) => void;
  onCloseThread: (sessionId: string) => void;
  activeAgent: AgentName;
  logicalAgents: EmployeeAgent[];
  selectableLogicalAgents: EmployeeAgent[];
  activeLogicalAgentId: string | null;
  onLogicalAgentPicked: (agent: EmployeeAgent) => void;
  composerTeams: AgentTeam[];
  activeTeamId: string | null;
  onTeamPicked: (team: AgentTeam) => void;
  teamLocked: boolean;
  artifactCount: number;
  visibleArtifacts: RelayArtifact[];
  spaceOpen: boolean;
  spaceArtifactId: string | null;
  spaceWidth: number;
  threadListHidden: boolean;
  onOpenArtifacts: (artifact?: RelayArtifact) => void;
  onToggleSpace: () => void;
  onCloseSpace: () => void;
  onSelectSpaceArtifact: (artifactId: string | null) => void;
  onSpaceResize: (width: number, commit: boolean) => void;
  onSpaceResizeActive: (active: boolean) => void;
  onToggleThreadList: () => void;
  onBackToThreads: () => void;
  selectedEmployee: string;
  initializingThread: boolean;
  projectName?: string;
  projectReadOnly?: boolean;
  runtimeNodes: DaemonNodeMonitorRecord[];
  runtimeNodeId: string | null;
  selectedRuntimeNode: DaemonNodeMonitorRecord | null;
  activeRuntimeNode: DaemonNodeMonitorRecord | null;
  /** Agents `@` may name in this thread. */
  mentionCandidates: MentionCandidate[];
  /** Agents in the thread's room, resolved for the header strip. */
  threadParticipants: EmployeeAgent[];
  onRuntimeNodeChange: (nodeId: string) => void;
  handoffOpen: boolean;
  setHandoffOpen: Dispatch<SetStateAction<boolean>>;
  handoffAgentId: string;
  setHandoffAgentId: Dispatch<SetStateAction<string>>;
  handoffNote: string;
  setHandoffNote: Dispatch<SetStateAction<string>>;
  sendDecision: (kind: "approve" | "reject" | "rerun" | "mark_done") => Promise<void>;
  sendHandoff: () => Promise<void>;
  onSend: () => void;
  onCancelRun: () => void;
  onRetryAgent: (agent: AgentName, agentId?: string) => void;
  running: boolean;
};

export function ThreadsView({
  directoryMode,
  filteredThreads,
  projects,
  selectedProjectId,
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
  onSelectProject,
  onNewThread,
  onRenameThread,
  onCloseThread,
  activeAgent,
  logicalAgents,
  selectableLogicalAgents,
  activeLogicalAgentId,
  onLogicalAgentPicked,
  composerTeams,
  activeTeamId,
  onTeamPicked,
  teamLocked,
  artifactCount,
  visibleArtifacts,
  spaceOpen,
  spaceArtifactId,
  spaceWidth,
  threadListHidden,
  onOpenArtifacts,
  onToggleSpace,
  onCloseSpace,
  onSelectSpaceArtifact,
  onSpaceResize,
  onSpaceResizeActive,
  onToggleThreadList,
  onBackToThreads,
  selectedEmployee,
  initializingThread,
  projectName,
  projectReadOnly,
  runtimeNodes,
  runtimeNodeId,
  selectedRuntimeNode,
  activeRuntimeNode,
  mentionCandidates,
  threadParticipants,
  onRuntimeNodeChange,
  handoffOpen,
  setHandoffOpen,
  handoffAgentId,
  setHandoffAgentId,
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
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const agentDisplayNames = useMemo(() => buildExecutorDisplayNameMap(logicalAgents), [logicalAgents]);
  const logicalAgentNames = useMemo(() => buildLogicalAgentNameMap(logicalAgents), [logicalAgents]);
  const logicalAgentImages = useMemo(() => buildLogicalAgentImageMap(logicalAgents), [logicalAgents]);
  const activeLogicalAgent = useMemo(
    () => logicalAgents.find((agent) => agent.id === activeLogicalAgentId && !agent.deletedAt),
    [activeLogicalAgentId, logicalAgents],
  );
  const activeAgentDisplayName = useMemo(
    () => activeLogicalAgent?.displayName ?? displayNameForExecutor(activeAgent, logicalAgents),
    [activeAgent, activeLogicalAgent, logicalAgents],
  );
  const spaceItems = useMemo(
    () => buildSpaceItems(visibleArtifacts, activeSession?.agentRuns, logicalAgentNames, agentDisplayNames),
    [visibleArtifacts, activeSession?.agentRuns, logicalAgentNames, agentDisplayNames],
  );
  const spaceShowProducer = useMemo(
    () => threadHasMultipleProducers(activeSession?.agentRuns),
    [activeSession?.agentRuns],
  );

  return (
    <>
      <ThreadListPanel
        directoryMode={directoryMode}
        threads={filteredThreads}
        projects={projects}
        query={threadQuery}
        setQuery={setThreadQuery}
        selectedSessionId={activeSession?.id}
        selectedProjectId={selectedProjectId}
        onSelectThread={onSelectThread}
        onSelectProject={onSelectProject}
        onCreateProject={() => setProjectDrawerOpen(true)}
        onNewThread={onNewThread}
        onRenameThread={onRenameThread}
        onCloseThread={onCloseThread}
      />

      <section id="chat-panel" className="chat-panel" aria-label={t("nav.threads")} tabIndex={-1}>
        <ThreadHeader
          activeSession={activeSession}
          participants={threadParticipants}
          artifactCount={artifactCount}
          spaceOpen={spaceOpen}
          threadListHidden={threadListHidden}
          onToggleSpace={onToggleSpace}
          onToggleThreadList={onToggleThreadList}
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
                  const PhaseIcon = msg.kind === "agent" && isHandoff ? ActionRoute : null;
                  return (
                    <div key={msg.id} className="transcript-turn">
                      {phaseLabel ? (
                        <div className="transcript-phase" role="separator" aria-label={phaseLabel}>
                          <span className="transcript-phase-node" aria-hidden="true" />
                          <span className="transcript-phase-label">
                            {!isHandoff ? (
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
                        logicalAgentImages={logicalAgentImages}
                        onOpenArtifact={onOpenArtifacts}
                        onRetryAgent={onRetryAgent}
                        retryDisabled={running}
                      />
                    </div>
                  );
                })}
                {awaitingDecision ? (
                  <DecisionBar
                    logicalAgents={selectableLogicalAgents}
                    sendDecision={sendDecision}
                    handoffOpen={handoffOpen}
                    setHandoffOpen={setHandoffOpen}
                    handoffAgentId={handoffAgentId}
                    setHandoffAgentId={setHandoffAgentId}
                    handoffNote={handoffNote}
                    setHandoffNote={setHandoffNote}
                    sendHandoff={sendHandoff}
                  />
                ) : null}
              </>
            ) : (
              <TranscriptEmpty
                selectedEmployee={selectedEmployee}
                onSuggestion={(text) => {
                  composerRef.current?.setText(text);
                  composerRef.current?.focus();
                }}
              />
            )}
          </div>
        </div>

        <Composer
          ref={composerRef}
          logicalAgents={selectableLogicalAgents}
          activeLogicalAgentId={activeLogicalAgentId}
          onLogicalAgentPicked={onLogicalAgentPicked}
          teams={composerTeams}
          activeTeamId={activeTeamId}
          onTeamPicked={onTeamPicked}
          teamLocked={teamLocked}
          activeAgentDisplayName={activeAgentDisplayName}
          selectedEmployee={selectedEmployee}
          initializingThread={initializingThread}
          projectName={projectName}
          readOnly={projectReadOnly}
          runtimeNodes={runtimeNodes}
          runtimeNodeId={runtimeNodeId}
          selectedRuntimeNode={selectedRuntimeNode}
          activeRuntimeNode={activeRuntimeNode}
          mentionCandidates={mentionCandidates}
          onRuntimeNodeChange={onRuntimeNodeChange}
          running={running}
          onSend={onSend}
          onCancelRun={onCancelRun}
        />
      </section>

      {spaceOpen && activeSession ? (
        <ThreadSpacePanel
          sessionId={activeSession.id}
          items={spaceItems}
          showProducer={spaceShowProducer}
          selectedArtifactId={spaceArtifactId}
          onSelectArtifact={onSelectSpaceArtifact}
          onClose={onCloseSpace}
          width={spaceWidth}
          onResize={onSpaceResize}
          onResizeActive={onSpaceResizeActive}
        />
      ) : null}
      <ProjectDrawer
        open={projectDrawerOpen}
        agents={logicalAgents}
        computers={runtimeNodes}
        onClose={() => setProjectDrawerOpen(false)}
        onCreated={(project) => onSelectProject(project.id)}
      />
    </>
  );
}
