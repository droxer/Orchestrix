import type { AgentName, AgentTaskMode } from "./state.js";
import { mergeTokenUsage, type TokenUsage } from "./token-usage.js";
import type { CodexCollaborationEvent } from "./codex-collaboration.js";

export type AgentRole = "implementer" | "reviewer" | "planner" | "tester" | "fixer";
export type SessionStatus = "running" | "waiting_for_human" | "completed" | "failed" | "cancelled";
export type RelayArtifactKind = "plan" | "diff" | "review" | "test_output" | "command_log" | "summary" | "agent_output" | "workspace_file";
export type HumanDecisionKind = "approve" | "reject" | "cancel" | "rerun" | "handoff" | "mark_done";
export type WorkspaceLayout = "node-root" | "thread";

export interface AgentRun {
  id: string;
  agent: AgentName;
  /** Logical (employee) agent that ran this step. `agent` is only its executor
   * kind, which several named agents can share — this is the identity. */
  logicalAgentId?: string;
  /** Computer that executed this run; retained for legacy thread affinity. */
  daemonNodeId?: string;
  placementId?: string;
  agentVersion?: number;
  workspaceIdentity?: Record<string, unknown>;
  role?: AgentRole;
  mode: AgentTaskMode;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
  agentLog?: string;
  tokenUsage?: TokenUsage;
  artifactIds: string[];
}

export interface RelayArtifact {
  id: string;
  kind: RelayArtifactKind;
  title: string;
  path: string;
  createdAt: string;
  agentRunId?: string;
  bytes?: number;
  contentType?: string;
  workspaceRelativePath?: string;
  /** Backend-side content snapshot kept for generated workspace files. */
  snapshotPath?: string;
}

export interface HumanDecision {
  id: string;
  kind: HumanDecisionKind;
  createdAt: string;
  note?: string;
  targetAgent?: AgentName;
  /** Stable logical-agent identity when the decision targets a named agent. */
  targetAgentId?: string;
  /** Employee who made the decision, for governance/audit attribution. */
  actorEmployeeId?: string;
}

export interface RelaySession {
  id: string;
  workspacePath: string;
  /** Missing on historical sessions, which retain the legacy node-root layout. */
  workspaceLayout?: WorkspaceLayout;
  /** Daemon node selected as this thread's immutable runtime boundary. */
  daemonNodeId?: string;
  /** Stable managed Computer identity; survives daemon runtime replacement. */
  managedNodeId?: string;
  /** Employee who owns this session; their agent runs the work on their behalf. */
  ownerEmployeeId?: string;
  /** Named Team that originated this session, retained as immutable provenance. */
  teamId?: string;
  /** Optional human-set label for the conversation; falls back to taskGoal when unset. */
  title?: string;
  taskGoal: string;
  participants: string[];
  status: SessionStatus;
  phase: string;
  createdAt: string;
  updatedAt: string;
  currentAgent?: AgentName;
  pendingDecision?: "feedback";
  agentRuns: AgentRun[];
  artifacts: RelayArtifact[];
  decisions: HumanDecision[];
  events: RelayEvent[];
  finalOutcome?: string;
  archived?: boolean;
  tokenUsage?: TokenUsage;
}

export type RelayEvent =
  | {
      id: string;
      type: "session.created";
      sessionId: string;
      timestamp: string;
      workspacePath: string;
      workspaceLayout?: WorkspaceLayout;
      daemonNodeId?: string;
      managedNodeId?: string;
      ownerEmployeeId?: string;
      teamId?: string;
      taskGoal: string;
      participants: string[];
    }
  | {
      id: string;
      type: "user.message";
      sessionId: string;
      timestamp: string;
      text: string;
      actorEmployeeId?: string;
    }
  | {
      id: string;
      type: "session.status";
      sessionId: string;
      timestamp: string;
      status: SessionStatus;
      phase: string;
      pendingDecision?: RelaySession["pendingDecision"];
    }
  | {
      id: string;
      type: "agent.started";
      sessionId: string;
      timestamp: string;
      runId: string;
      agent: AgentName;
      /** Logical (employee) agent dispatched for this run; absent on legacy
       * runs and workflow dispatches that name only an executor kind. */
      logicalAgentId?: string;
      placementId?: string;
      daemonNodeId?: string;
      managedNodeId?: string;
      agentVersion?: number;
      workspaceIdentity?: Record<string, unknown>;
      role?: AgentRole;
      mode: AgentTaskMode;
    }
  | {
      id: string;
      type: "agent.output";
      sessionId: string;
      timestamp: string;
      runId: string;
      agent: AgentName;
      stream: "stdout" | "stderr";
      text: string;
      sequence?: number;
    }
  | {
      id: string;
      type: "agent.collaboration";
      sessionId: string;
      timestamp: string;
      runId: string;
      agent: AgentName;
      mode: AgentTaskMode;
      sequence: number;
      collaboration: CodexCollaborationEvent;
    }
  | {
      id: string;
      type: "artifact.created";
      sessionId: string;
      timestamp: string;
      artifact: RelayArtifact;
    }
  | {
      id: string;
      type: "human.decision";
      sessionId: string;
      timestamp: string;
      decision: HumanDecision;
    }
  | {
      id: string;
      type: "agent.completed";
      sessionId: string;
      timestamp: string;
      runId: string;
      agent: AgentName;
      status: AgentRun["status"];
      exitCode: number;
      agentLog?: string;
      tokenUsage?: TokenUsage;
    }
  | {
      id: string;
      type: "session.completed";
      sessionId: string;
      timestamp: string;
      outcome: string;
    }
  | {
      id: string;
      type: "session.failed";
      sessionId: string;
      timestamp: string;
      outcome: string;
    }
  | {
      id: string;
      type: "session.archived";
      sessionId: string;
      timestamp: string;
    }
  | {
      id: string;
      type: "session.runtime_affinity";
      sessionId: string;
      timestamp: string;
      managedNodeId: string;
    }
  | {
      id: string;
      type: "session.renamed";
      sessionId: string;
      timestamp: string;
      title: string;
    };

export function nowIso(): string {
  return new Date().toISOString();
}

export function newRelayId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function relayEvent<T extends RelayEvent["type"]>(
  type: T,
  sessionId: string,
  payload: Omit<Extract<RelayEvent, { type: T }>, "id" | "type" | "sessionId" | "timestamp">,
): Extract<RelayEvent, { type: T }> {
  return {
    id: newRelayId("evt"),
    type,
    sessionId,
    timestamp: nowIso(),
    ...payload,
  } as Extract<RelayEvent, { type: T }>;
}

export function materializeEvents(events: RelayEvent[]): RelaySession {
  const created = events.find((event): event is Extract<RelayEvent, { type: "session.created" }> => event.type === "session.created");
  if (!created) throw new Error("Relay session event log is missing session.created.");
  const session: RelaySession = {
    id: created.sessionId,
    workspacePath: created.workspacePath,
    ...(created.workspaceLayout ? { workspaceLayout: created.workspaceLayout } : {}),
    ...(created.daemonNodeId ? { daemonNodeId: created.daemonNodeId } : {}),
    ...(created.managedNodeId ? { managedNodeId: created.managedNodeId } : {}),
    ...(created.ownerEmployeeId ? { ownerEmployeeId: created.ownerEmployeeId } : {}),
    ...(created.teamId ? { teamId: created.teamId } : {}),
    taskGoal: created.taskGoal,
    participants: created.participants,
    status: "running",
    phase: "created",
    createdAt: created.timestamp,
    updatedAt: created.timestamp,
    agentRuns: [],
    artifacts: [],
    decisions: [],
    events: [],
    archived: false,
  };

  for (const event of events) {
    session.events.push(event);
    session.updatedAt = event.timestamp;
    if (event.type === "session.status") {
      session.status = event.status;
      session.phase = event.phase;
      session.pendingDecision = event.pendingDecision;
      if (!event.pendingDecision) delete session.pendingDecision;
      if (event.status !== "completed" && event.status !== "failed") delete session.finalOutcome;
    } else if (event.type === "agent.started") {
      // Threads created before node pinning adopt the computer their first
      // stamped run executed on.
      if (event.daemonNodeId && !session.daemonNodeId) session.daemonNodeId = event.daemonNodeId;
      if (event.managedNodeId && !session.managedNodeId) session.managedNodeId = event.managedNodeId;
      session.status = "running";
      session.phase = `${event.agent}:${event.mode}`;
      session.currentAgent = event.agent;
      session.agentRuns.push({
        id: event.runId,
        agent: event.agent,
        ...(event.logicalAgentId ? { logicalAgentId: event.logicalAgentId } : {}),
        ...(event.daemonNodeId ? { daemonNodeId: event.daemonNodeId } : {}),
        ...(event.role ? { role: event.role } : {}),
        ...(event.logicalAgentId ? { logicalAgentId: event.logicalAgentId } : {}),
        ...(event.placementId ? { placementId: event.placementId } : {}),
        ...(event.daemonNodeId ? { daemonNodeId: event.daemonNodeId } : {}),
        ...(event.agentVersion !== undefined ? { agentVersion: event.agentVersion } : {}),
        ...(event.workspaceIdentity ? { workspaceIdentity: event.workspaceIdentity } : {}),
        mode: event.mode,
        status: "running",
        startedAt: event.timestamp,
        artifactIds: [],
      });
    } else if (event.type === "agent.completed") {
      const run = session.agentRuns.find((item) => item.id === event.runId);
      if (run) {
        run.status = event.status;
        run.completedAt = event.timestamp;
        run.exitCode = event.exitCode;
        if (event.agentLog !== undefined) run.agentLog = event.agentLog;
        if (event.tokenUsage) run.tokenUsage = event.tokenUsage;
      }
      session.tokenUsage = mergeTokenUsage(session.agentRuns.map((item) => item.tokenUsage));
      session.currentAgent = undefined;
      session.phase = event.status === "completed"
        ? "agent_completed"
        : event.status === "cancelled" ? "cancelled" : "agent_failed";
    } else if (event.type === "artifact.created") {
      session.artifacts.push(event.artifact);
      if (event.artifact.agentRunId) {
        const run = session.agentRuns.find((item) => item.id === event.artifact.agentRunId);
        run?.artifactIds.push(event.artifact.id);
      }
    } else if (event.type === "human.decision") {
      session.decisions.push(event.decision);
      if (event.decision.kind === "handoff" && event.decision.targetAgent) {
        session.currentAgent = event.decision.targetAgent;
      }
      if (event.decision.kind === "cancel") {
        session.status = "cancelled";
        session.phase = "cancelled";
        delete session.pendingDecision;
      }
    } else if (event.type === "session.completed") {
      session.status = "completed";
      session.phase = "completed";
      session.finalOutcome = event.outcome;
      session.currentAgent = undefined;
      delete session.pendingDecision;
    } else if (event.type === "session.failed") {
      session.status = "failed";
      session.phase = "failed";
      session.finalOutcome = event.outcome;
      session.currentAgent = undefined;
      delete session.pendingDecision;
    } else if (event.type === "session.archived") {
      session.archived = true;
    } else if (event.type === "session.runtime_affinity") {
      if (!session.managedNodeId) session.managedNodeId = event.managedNodeId;
    } else if (event.type === "session.renamed") {
      session.title = event.title;
    }
  }
  return session;
}
