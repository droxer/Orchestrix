import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { getAgent } from "./agents.js";
import { REPO_ROOT } from "./env.js";
import type { AgentName, ReviewVerdict } from "./state.js";
import { mergeTokenUsage, type TokenUsage } from "./token-usage.js";

export type AgentRole = "implementer" | "reviewer" | "planner" | "tester" | "fixer";
export type SessionStatus = "running" | "waiting_for_human" | "completed" | "failed" | "cancelled";
export type RelayArtifactKind = "plan" | "diff" | "review" | "test_output" | "command_log" | "summary" | "agent_output";
export type HumanDecisionKind = "approve" | "reject" | "cancel" | "rerun" | "handoff" | "mark_done";

export interface AgentRun {
  id: string;
  agent: AgentName;
  role: AgentRole;
  mode: "action" | "review";
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
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
}

export interface HumanDecision {
  id: string;
  kind: HumanDecisionKind;
  createdAt: string;
  note?: string;
  targetAgent?: AgentName;
  /** Employee who made the decision, for governance/audit attribution. */
  actorEmployeeId?: string;
}

export interface RelaySession {
  id: string;
  workspacePath: string;
  /** Employee who owns this session; their agent runs the work on their behalf. */
  ownerEmployeeId?: string;
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
  reviewVerdict?: ReviewVerdict;
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
      ownerEmployeeId?: string;
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
      role: AgentRole;
      mode: "action" | "review";
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
      tokenUsage?: TokenUsage;
    }
  | {
      id: string;
      type: "review.verdict";
      sessionId: string;
      timestamp: string;
      runId: string;
      agent: AgentName;
      verdict: ReviewVerdict;
      feedback: string;
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
      type: "session.renamed";
      sessionId: string;
      timestamp: string;
      title: string;
    };

export interface SessionStore {
  createSession(input: {
    workspacePath: string;
    ownerEmployeeId?: string;
    taskGoal: string;
    participants?: string[];
    status?: SessionStatus;
    pendingDecision?: RelaySession["pendingDecision"];
  }): Promise<RelaySession>;
  appendEvent(sessionId: string, event: RelayEvent): Promise<RelaySession>;
  getSession(sessionId: string): Promise<RelaySession>;
  listSessions(): Promise<RelaySession[]>;
  writeArtifact(sessionId: string, input: {
    kind: RelayArtifactKind;
    title: string;
    body: string;
    extension?: string;
    agentRunId?: string;
  }): Promise<RelayArtifact>;
  artifactPath(sessionId: string, artifactId: string): Promise<string>;
  readArtifact(sessionId: string, artifactId: string): Promise<string>;
}

export interface AgentEventSink {
  agentOutput(runId: string, agent: AgentName, stream: "stdout" | "stderr", text: string): void | Promise<void>;
}

export const DEFAULT_RELAY_DATA_DIR = resolve(REPO_ROOT, ".relay");

export function nowIso(): string {
  return new Date().toISOString();
}

export function newRelayId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function roleForAgent(agent: AgentName, mode: "action" | "review" = "action"): AgentRole {
  if (mode === "review") return "reviewer";
  return getAgent(agent).actionRole;
}

export class LocalSessionStore implements SessionStore {
  private readonly sessionsDir: string;

  constructor(public readonly rootDir = DEFAULT_RELAY_DATA_DIR) {
    this.sessionsDir = join(this.rootDir, "sessions");
    mkdirSync(this.sessionsDir, { recursive: true });
  }

  async createSession(input: {
    workspacePath: string;
    ownerEmployeeId?: string;
    taskGoal: string;
    participants?: string[];
    status?: SessionStatus;
    pendingDecision?: RelaySession["pendingDecision"];
  }): Promise<RelaySession> {
    const sessionId = newRelayId("ses");
    const dir = this.sessionDir(sessionId);
    mkdirSync(join(dir, "artifacts"), { recursive: true });
    const event = relayEvent("session.created", sessionId, {
      workspacePath: input.workspacePath,
      ...(input.ownerEmployeeId ? { ownerEmployeeId: input.ownerEmployeeId } : {}),
      taskGoal: input.taskGoal,
      participants: input.participants ?? ["human"],
    });
    const events: RelayEvent[] = [event];
    if (input.status || input.pendingDecision) {
      events.push(relayEvent("session.status", sessionId, {
        status: input.status ?? "running",
        phase: input.pendingDecision ? `waiting:${input.pendingDecision}` : "created",
        pendingDecision: input.pendingDecision,
      }));
    }
    const session = materializeEvents(events);
    writeFileSync(this.eventsPath(sessionId), events.map((item) => JSON.stringify(item)).join("\n") + "\n");
    writeFileSync(this.snapshotPath(sessionId), `${JSON.stringify(session, null, 2)}\n`);
    return session;
  }

  async appendEvent(sessionId: string, event: RelayEvent): Promise<RelaySession> {
    mkdirSync(this.sessionDir(sessionId), { recursive: true });
    appendFileSync(this.eventsPath(sessionId), `${JSON.stringify(event)}\n`);
    const session = materializeEvents(this.readEvents(sessionId));
    writeFileSync(this.snapshotPath(sessionId), `${JSON.stringify(session, null, 2)}\n`);
    return session;
  }

  async getSession(sessionId: string): Promise<RelaySession> {
    const snapshot = this.snapshotPath(sessionId);
    if (existsSync(snapshot)) {
      return JSON.parse(readFileSync(snapshot, "utf8")) as RelaySession;
    }
    return materializeEvents(this.readEvents(sessionId));
  }

  async listSessions(): Promise<RelaySession[]> {
    if (!existsSync(this.sessionsDir)) return [];
    return readdirSync(this.sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.getSessionSync(entry.name))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async writeArtifact(sessionId: string, input: {
    kind: RelayArtifactKind;
    title: string;
    body: string;
    extension?: string;
    agentRunId?: string;
  }): Promise<RelayArtifact> {
    const artifactId = newRelayId("art");
    const extension = input.extension ?? "txt";
    const artifactDir = join(this.sessionDir(sessionId), "artifacts");
    mkdirSync(artifactDir, { recursive: true });
    const path = join(artifactDir, `${artifactId}.${extension}`);
    writeFileSync(path, input.body);
    return {
      id: artifactId,
      kind: input.kind,
      title: input.title,
      path,
      createdAt: nowIso(),
      agentRunId: input.agentRunId,
      bytes: Buffer.byteLength(input.body),
    };
  }

  async artifactPath(sessionId: string, artifactId: string): Promise<string> {
    const artifact = this.getSessionSync(sessionId).artifacts.find((item) => item.id === artifactId);
    if (!artifact) throw new Error(`Unknown artifact ${artifactId} in session ${sessionId}.`);
    return artifact.path;
  }

  async readArtifact(sessionId: string, artifactId: string): Promise<string> {
    return readFileSync(await this.artifactPath(sessionId, artifactId), "utf8");
  }

  private getSessionSync(sessionId: string): RelaySession {
    const snapshot = this.snapshotPath(sessionId);
    if (existsSync(snapshot)) {
      return JSON.parse(readFileSync(snapshot, "utf8")) as RelaySession;
    }
    return materializeEvents(this.readEvents(sessionId));
  }

  private readEvents(sessionId: string): RelayEvent[] {
    const path = this.eventsPath(sessionId);
    if (!existsSync(path)) throw new Error(`Unknown Relay session ${sessionId}.`);
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RelayEvent);
  }

  private sessionDir(sessionId: string): string {
    return join(this.sessionsDir, basename(sessionId));
  }

  private eventsPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), "events.jsonl");
  }

  private snapshotPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), "snapshot.json");
  }
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
    ...(created.ownerEmployeeId ? { ownerEmployeeId: created.ownerEmployeeId } : {}),
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
      session.status = "running";
      session.phase = `${event.agent}:${event.mode}`;
      session.currentAgent = event.agent;
      session.agentRuns.push({
        id: event.runId,
        agent: event.agent,
        role: event.role,
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
    } else if (event.type === "review.verdict") {
      session.reviewVerdict = event.verdict;
      session.phase = `review:${event.verdict}`;
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
    } else if (event.type === "session.renamed") {
      session.title = event.title;
    }
  }
  return session;
}
