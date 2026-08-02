import type { AgentName, AgentState, AgentTaskMode } from "./state.js";
import type { TokenUsage } from "./token-usage.js";
import type { CodexCollaborationEvent } from "./codex-collaboration.js";

export type DaemonNodeStatus = "ready" | "busy" | "stopped";
export type DaemonNodeSandboxMode = "none" | "boxlite";
export type DaemonAgentAdapter = "cli" | "service";
export type DaemonAgentHealthStatus = "ready" | "failed";

/** Runtime capability advertised by a daemon. Logical employee agents are
 * control-plane identities and are connected to these capabilities by placements. */
export interface DaemonExecutorCapability {
  executorKind: AgentName;
  status: DaemonAgentHealthStatus;
  adapter: DaemonAgentAdapter;
  maxConcurrentRuns: number;
  inventory?: DaemonAgentInventory;
  configurationFingerprint?: string;
}

export interface DaemonAgentHealth {
  status: DaemonAgentHealthStatus;
  detail?: string;
  version?: string;
  adapter?: DaemonAgentAdapter;
}

export type DaemonMcpTransport = "stdio" | "sse" | "http";

/** A SKILL.md directory installed in an agent's home inside the node. */
export interface DaemonAgentSkill {
  name: string;
  namespace?: string;
  description?: string;
}

/** An MCP server configured for an agent CLI inside the node. */
export interface DaemonAgentMcpServer {
  name: string;
  transport: DaemonMcpTransport;
  command?: string;
}

/** What an agent CLI actually has installed inside the node. */
export interface DaemonAgentInventory {
  skills: DaemonAgentSkill[];
  mcpServers: DaemonAgentMcpServer[];
}

export const DAEMON_NODE_PROTOCOL_VERSION = 1 as const;
export const DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = [1];

/**
 * Daemon-advertised optional behaviors. "generated-files" means the daemon
 * detects document-type files created or changed by a run and reports them
 * in its run.completed event, so the backend never has to walk the workspace
 * itself (which only works when they share a filesystem).
 */
export type DaemonNodeCapability = "generated-files" | "workspace-read" | "workspace-read-shared" | "structured-agent-events" | "thread-workspaces";
export const DAEMON_CAPABILITY_GENERATED_FILES: DaemonNodeCapability = "generated-files";
/** The daemon can serve agent-home file listings and reads via workspace commands. */
export const DAEMON_CAPABILITY_WORKSPACE_READ: DaemonNodeCapability = "workspace-read";
/** The daemon can serve the node's shared workspace root via scope: "shared" workspace commands. */
export const DAEMON_CAPABILITY_WORKSPACE_READ_SHARED: DaemonNodeCapability = "workspace-read-shared";
/** The daemon emits normalized nested-agent lifecycle events in addition to raw output. */
export const DAEMON_CAPABILITY_STRUCTURED_AGENT_EVENTS: DaemonNodeCapability = "structured-agent-events";
/** The daemon executes each thread below its configured node workspace root. */
export const DAEMON_CAPABILITY_THREAD_WORKSPACES: DaemonNodeCapability = "thread-workspaces";

/** A workspace file a run created or changed, reported by the daemon. */
export interface DaemonGeneratedFile {
  /** Path relative to the run's thread workspace (posix separators). */
  relativePath: string;
  title: string;
  bytes: number;
  contentType: string;
  /**
   * Base64 file content for files small enough to snapshot, so the backend
   * can serve the artifact even without access to the daemon's filesystem
   * and after the workspace copy is deleted or rewritten.
   */
  contentBase64?: string;
}

export interface DaemonNodeRegistration {
  sandboxId: string;
  employeeId?: string;
  token: string;
  workspacePath?: string;
  workspaceId?: string;
  sandboxMode?: DaemonNodeSandboxMode;
  protocolVersion: number;
  supportedAgents: AgentName[];
  executorCapabilities?: DaemonExecutorCapability[];
  capabilities?: DaemonNodeCapability[];
  agentHealth?: Partial<Record<AgentName, DaemonAgentHealth>>;
  agentInventory?: Partial<Record<AgentName, DaemonAgentInventory>>;
  maxConcurrentRuns?: number;
  runCapacityByMode?: Partial<Record<AgentTaskMode, number>>;
  status?: DaemonNodeStatus;
}

export interface DaemonNodeHeartbeatSettings {
  /** Recommended renewal cadence chosen by the backend. */
  intervalMs: number;
  /** Time since the last accepted observation before the node is offline. */
  timeoutMs: number;
  /** Backend timestamp for the accepted renewal. */
  observedAt?: string;
}

export interface DaemonNodeHeartbeat {
  activeCommandLeases: Array<{ commandId: string; leaseId?: string }>;
}

export interface DaemonNodeRegistrationResponse {
  heartbeat?: DaemonNodeHeartbeatSettings;
}

export interface DaemonNodeHeartbeatResponse {
  heartbeat: DaemonNodeHeartbeatSettings;
}

export interface DaemonNodeRunCommand {
  id: string;
  type: "run.start";
  leaseId?: string;
  leaseExpiresAt?: string;
  attempt?: number;
  sessionId: string;
  runId: string;
  taskGoal: string;
  agent: AgentName;
  logicalAgentId?: string;
  placementId?: string;
  agentVersion?: number;
  mode: AgentTaskMode;
  workspacePath?: string;
  state?: AgentState;
}

export interface DaemonNodeCancelCommand {
  id: string;
  type: "run.cancel";
  leaseId?: string;
  leaseExpiresAt?: string;
  attempt?: number;
  commandId: string;
  sessionId: string;
  runId: string;
  agent: AgentName;
  mode: AgentTaskMode;
  reason: string;
}

export interface DaemonWorkspaceEntry {
  name: string;
  path: string;
  kind: "directory" | "file";
  bytes: number | null;
  updatedAt: string;
}

/**
 * Which base directory a workspace command reads: an agent's personal home
 * ("agent-home", the default) or the node's shared workspace root ("shared",
 * only sent to daemons advertising the workspace-read-shared capability).
 */
export type DaemonWorkspaceScope = "agent-home" | "shared";

export interface DaemonWorkspaceListCommand {
  id: string;
  type: "workspace.list";
  leaseId?: string;
  leaseExpiresAt?: string;
  attempt?: number;
  /** Thread workspace to read. Omitted only for node-root administration. */
  sessionId?: string;
  scope?: DaemonWorkspaceScope;
  /** Required for agent-home scope; optional for shared scope. */
  agentId?: string;
  path: string;
}

export interface DaemonWorkspaceReadCommand {
  id: string;
  type: "workspace.read";
  leaseId?: string;
  leaseExpiresAt?: string;
  attempt?: number;
  /** Thread workspace to read. Omitted only for node-root administration. */
  sessionId?: string;
  scope?: DaemonWorkspaceScope;
  /** Required for agent-home scope; optional for shared scope. */
  agentId?: string;
  path: string;
}

export type DaemonWorkspaceErrorCode = "invalid-path" | "not-found" | "is-directory" | "io-error";

export type DaemonNodeCommand = DaemonNodeRunCommand | DaemonNodeCancelCommand | DaemonWorkspaceListCommand | DaemonWorkspaceReadCommand;

export type DaemonNodeEvent =
  | {
      type: "run.output";
      commandId: string;
      leaseId?: string;
      sessionId: string;
      runId: string;
      agent: AgentName;
      stream: "stdout" | "stderr";
      text: string;
      sequence: number;
    }
  | {
      type: "run.collaboration";
      commandId: string;
      leaseId?: string;
      sessionId: string;
      runId: string;
      agent: AgentName;
      mode: AgentTaskMode;
      collaboration: CodexCollaborationEvent;
      sequence: number;
    }
  | {
      type: "run.completed";
      commandId: string;
      leaseId?: string;
      sessionId: string;
      runId: string;
      agent: AgentName;
      mode: AgentTaskMode;
      exitCode: number;
      agentLog: string;
      tokenUsage?: TokenUsage;
      generatedFiles?: DaemonGeneratedFile[];
    }
  | {
      type: "run.failed";
      commandId: string;
      leaseId?: string;
      sessionId: string;
      runId: string;
      agent: AgentName;
      mode: AgentTaskMode;
      error: string;
      agentLog?: string;
      exitCode?: number;
    }
  | {
      type: "run.cancelled";
      commandId: string;
      leaseId?: string;
      sessionId: string;
      runId: string;
      agent: AgentName;
      mode: AgentTaskMode;
      reason: string;
    }
  | {
      type: "workspace.listing";
      commandId: string;
      leaseId?: string;
      agentId?: string;
      path: string;
      exists: boolean;
      entries: DaemonWorkspaceEntry[];
    }
  | {
      type: "workspace.file";
      commandId: string;
      leaseId?: string;
      agentId?: string;
      path: string;
      bytes: number;
      isBinary: boolean;
      truncated: boolean;
      contentBase64?: string;
    }
  | {
      type: "workspace.error";
      commandId: string;
      leaseId?: string;
      agentId?: string;
      path: string;
      code: DaemonWorkspaceErrorCode;
      message: string;
    };
