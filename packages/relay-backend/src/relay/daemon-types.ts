import type {
  AgentName,
  CodexTaskMode,
  DaemonNodeCommand,
  DaemonNodeEvent,
} from "relay-core";
import type { SessionStore } from "./session.js";
import type { TaskStore } from "./task.js";

export type SandboxStatus = "provisioning" | "ready" | "running" | "stopped" | "failed";

export interface SandboxRecord {
  id: string;
  employeeId: string;
  workspacePath?: string;
  status: SandboxStatus;
  agents: Record<AgentName, "unknown" | "ready" | "failed">;
  /** Plaintext UI token returned only during provisioning. */
  token?: string;
  /** Deprecated UI-token hash retained for compatibility with persisted records. */
  tokenHash?: string;
  uiTokenHash?: string;
  nodeTokenHash?: string;
  /** Plaintext daemon-node token shown only on the local control panel. */
  nodeToken?: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  lastError?: string;
}

export interface SandboxRunAssignment {
  agent: AgentName;
  mode?: CodexTaskMode;
}

export interface SandboxRunRequest {
  taskGoal: string;
  assignments: SandboxRunAssignment[];
  sessionId?: string;
}

export interface SandboxBackend {
  provision(input: { employeeId: string; workspacePath?: string; token?: string; nodeToken?: string }): Promise<SandboxRecord>;
  get(sandboxId: string): Promise<SandboxRecord | undefined>;
  list(): Promise<SandboxRecord[]>;
  run(sandboxId: string, request: SandboxRunRequest): Promise<import("./session.js").RelaySession>;
  cancelRun?(sandboxId: string, sessionId: string, reason: string): Promise<import("./session.js").RelaySession>;
}

export interface DaemonNodeActiveRun {
  commandId: string;
  sessionId: string;
  runId: string;
  agent: AgentName;
  mode: CodexTaskMode;
  taskGoal: string;
  workspacePath?: string;
  startedAt: string;
}

export interface DaemonNodeMonitorRecord extends Omit<SandboxRecord, "token" | "tokenHash" | "uiTokenHash" | "nodeTokenHash" | "nodeToken"> {
  queuedCommandCount: number;
  activeRuns: DaemonNodeActiveRun[];
  online: boolean;
  stale: boolean;
  lastSeenAgeMs?: number;
}

export interface ControlPanelDaemonNodeRecord extends DaemonNodeMonitorRecord {
  nodeToken?: string;
}

export interface TrackedDaemonNodeActiveRun extends DaemonNodeActiveRun {
  sandboxId: string;
}

export type DaemonCompletionEvent = Extract<DaemonNodeEvent, { type: "run.completed" | "run.failed" | "run.cancelled" }>;

export interface DaemonNodeRegistryOptions {
  now?: () => number;
  livenessTimeoutMs?: number;
}

export type DaemonCommandStatus = "queued" | "dispatched" | "completed" | "failed" | "cancelled";
export type DaemonRunStatus = "running" | "completed" | "failed" | "cancelled";

export interface DaemonCommandRecord {
  id: string;
  nodeId: string;
  command: DaemonNodeCommand;
  status: DaemonCommandStatus;
  createdAt: string;
  updatedAt: string;
  dispatchedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface DaemonRunRecord extends DaemonNodeActiveRun {
  nodeId: string;
  status: DaemonRunStatus;
  completedAt?: string;
  exitCode?: number;
  error?: string;
}

export type DaemonEvent =
  | {
      id: string;
      type: "daemon.node.registered";
      timestamp: string;
      node: SandboxRecord;
    }
  | {
      id: string;
      type: "daemon.node.seen";
      timestamp: string;
      nodeId: string;
      patch: Pick<Partial<SandboxRecord>, "status" | "lastError" | "lastSeenAt">;
    }
  | {
      id: string;
      type: "daemon.command.queued" | "daemon.command.dispatched";
      timestamp: string;
      nodeId: string;
      commandId: string;
    }
  | {
      id: string;
      type: "daemon.command.completed" | "daemon.command.failed" | "daemon.command.cancelled";
      timestamp: string;
      nodeId: string;
      commandId: string;
      runId?: string;
      exitCode?: number;
      error?: string;
    };

export interface DaemonStore {
  registerNode(input: SandboxRecord): Promise<SandboxRecord>;
  markNodeSeen(nodeId: string, patch?: Pick<Partial<SandboxRecord>, "status" | "lastError">): Promise<SandboxRecord | undefined>;
  getNode(nodeId: string): Promise<SandboxRecord | undefined>;
  listNodes(): Promise<SandboxRecord[]>;
  enqueueCommand(nodeId: string, command: DaemonNodeCommand): Promise<DaemonCommandRecord>;
  takeQueuedCommands(nodeId: string, limit?: number): Promise<DaemonCommandRecord[]>;
  queuedCommandCount(nodeId: string): Promise<number>;
  listActiveRuns(nodeId?: string): Promise<DaemonRunRecord[]>;
  markCommandCompleted(nodeId: string, event: Extract<DaemonNodeEvent, { type: "run.completed" }>): Promise<void>;
  markCommandFailed(nodeId: string, event: Extract<DaemonNodeEvent, { type: "run.failed" }>): Promise<void>;
  markCommandCancelled(nodeId: string, event: Extract<DaemonNodeEvent, { type: "run.cancelled" }>): Promise<void>;
  appendDaemonEvent(event: DaemonEvent): Promise<void>;
}

export interface RelayDaemonOptions {
  port?: number;
  host?: string;
  backend?: SandboxBackend;
  daemonStore?: DaemonStore;
  store?: SessionStore;
  taskStore?: TaskStore;
}

export interface RelayDaemonResponse {
  status: number;
  contentType: string;
  body: string;
  /** Raw bytes for binary assets; takes precedence over `body` when set. */
  bodyBytes?: Buffer;
}
