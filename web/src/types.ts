import type {
  AgentName,
  AgentRole,
  AgentTaskMode,
  ControlPanelDaemonNodeRecord,
  DaemonAgentInventory,
  DaemonAgentMcpServer,
  DaemonAgentSkill,
  DaemonMcpTransport,
  DaemonNodeMonitorRecord,
  RelayArtifact,
  RelayTask,
  RelaySession,
  SandboxRecord,
  SessionStatus,
  TaskPriority,
  TaskRoutineCadence,
  TaskRoutineType,
  TaskStatus,
  TokenUsage,
} from "relay-core";

export type {
  AgentName,
  AgentRole,
  AgentTaskMode,
  ControlPanelDaemonNodeRecord,
  DaemonAgentInventory,
  DaemonAgentMcpServer,
  DaemonAgentSkill,
  DaemonMcpTransport,
  DaemonNodeMonitorRecord,
  RelayArtifact,
  RelayTask,
  RelaySession,
  SandboxRecord,
  SessionStatus,
  TaskPriority,
  TaskRoutineCadence,
  TaskRoutineType,
  TaskStatus,
  TokenUsage,
};

/**
 * Canonical agent ordering for web surfaces. Mirrors AGENT_REGISTRY in
 * relay-core/src/agents.ts (which isn't importable here because web bundles
 * can't pull node-only modules — see CLAUDE.md). Update both when adding an
 * agent.
 */
export const AGENT_NAMES: AgentName[] = ["claude", "pi", "codex", "kimi"];

/** Single tone vocabulary for every status surface (toasts, pills, dots, stream status, system rows). */
export type Tone = "good" | "bad" | "warn" | "info" | "neutral";

export interface SessionsResponse {
  sessions: RelaySession[];
}

export interface ArtifactIndexItem extends RelayArtifact {
  sessionId: string;
  sessionTitle?: string;
  taskGoal?: string;
  ownerEmployeeId?: string;
  workspacePath?: string;
  sessionUpdatedAt?: string;
  taskId?: string;
}

export interface ArtifactsResponse {
  artifacts: ArtifactIndexItem[];
}

export interface TaskArtifactsResponse {
  taskId: string;
  artifacts: ArtifactIndexItem[];
}

export interface AgentArtifactsResponse {
  agentId: string;
  artifacts: ArtifactIndexItem[];
}

export interface WorkspaceBriefSession {
  id: string;
  title?: string;
  taskGoal?: string;
  status?: RelaySession["status"];
  phase?: string;
  workspacePath?: string;
  ownerEmployeeId?: string;
  currentAgent?: AgentName;
  pendingDecision?: RelaySession["pendingDecision"];
  artifactCount: number;
  runCount: number;
  updatedAt?: string;
  createdAt?: string;
}

export interface WorkspaceBriefTask {
  id: string;
  title?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  ownerEmployeeId?: string;
  assigneeEmployeeId?: string;
  assignedAgent?: AgentName;
  assignedAgentId?: string;
  dueDate?: string;
  isRoutine: boolean;
  routineType?: TaskRoutineType;
  routineCadence?: TaskRoutineCadence;
  routineNextRunDate?: string;
  routineEnabled: boolean;
  linkedSessionIds: string[];
  updatedAt?: string;
  createdAt?: string;
}

export interface WorkspaceBriefResponse {
  employeeId: string;
  workspacePath?: string;
  primaryNode?: DaemonNodeMonitorRecord | null;
  nodes: DaemonNodeMonitorRecord[];
  activeRuns: DaemonNodeMonitorRecord["activeRuns"];
  sessions: WorkspaceBriefSession[];
  tasks: WorkspaceBriefTask[];
  artifacts: ArtifactIndexItem[];
  metrics: {
    nodeCount: number;
    activeRunCount: number;
    sessionCount: number;
    activeSessionCount: number;
    taskCount: number;
    activeTaskCount: number;
    artifactCount: number;
  };
  generatedAt: string;
}

export type WorkspaceFileKind = "directory" | "file";

export interface WorkspaceFileEntry {
  name: string;
  path: string;
  kind: WorkspaceFileKind;
  bytes?: number | null;
  updatedAt: string;
}

export type AgentWorkspaceSource = "live" | "snapshot";

export interface AgentWorkspaceFilesResponse {
  agentId: string;
  source: AgentWorkspaceSource;
  nodeId?: string;
  path: string;
  exists: boolean;
  entries: WorkspaceFileEntry[];
  generatedAt: string;
}

export interface AgentWorkspaceFileResponse {
  agentId: string;
  source: AgentWorkspaceSource;
  nodeId?: string;
  path: string;
  exists: boolean;
  isBinary: boolean;
  bytes: number;
  content: string | null;
  truncated: boolean;
  limitBytes: number;
  generatedAt: string;
}

export interface TasksResponse {
  tasks: RelayTask[];
}

export interface SandboxesResponse {
  sandboxes: SandboxRecord[];
}

export interface DaemonNodesResponse {
  nodes: DaemonNodeMonitorRecord[];
}

export interface ControlPanelDaemonNodesResponse {
  nodes: ControlPanelDaemonNodeRecord[];
}

export interface EmployeeRecord {
  id: string;
  displayName: string;
  email?: string;
  departmentId?: string;
  departmentName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ControlPanelEmployeesResponse {
  employees: EmployeeRecord[];
}

export interface CreateControlPanelEmployeeInput {
  employeeId: string;
  username: string;
  password: string;
  nodeId?: string;
  email?: string;
  displayName?: string;
}

export interface CreateControlPanelEmployeeResponse {
  employee: EmployeeRecord;
  user: CurrentUser;
  node?: ControlPanelDaemonNodeRecord;
}

export interface AssignControlPanelDaemonNodeResponse {
  employee: EmployeeRecord;
  node: ControlPanelDaemonNodeRecord;
}

export interface UnassignControlPanelDaemonNodeResponse {
  node: ControlPanelDaemonNodeRecord;
}

export interface CreateControlPanelDaemonNodeInput {
  employeeId?: string;
  workspacePath?: string;
  /** "boxlite" = managed BoxLite VM (default); "none" = local host processes. */
  sandboxMode?: "boxlite" | "none";
}

export interface CreateControlPanelDaemonNodeResponse {
  node: ControlPanelDaemonNodeRecord;
  sandboxToken?: string;
  nodeToken?: string;
  daemonCommand?: string;
  daemonEnv: Record<string, string>;
}

export type ManagedNodePhase =
  | "requested"
  | "allocating"
  | "bootstrapping"
  | "registering"
  | "ready"
  | "draining"
  | "stopped"
  | "deleting"
  | "deleted"
  | "failed";

export interface ManagedNodeRecord {
  id: string;
  displayName: string;
  employeeId?: string;
  assignmentMode: "dedicated" | "pooled" | "shared";
  provider: string;
  profile: string;
  sandboxMode: "boxlite";
  workspacePolicy: Record<string, unknown>;
  desiredState: "running" | "stopped" | "deleted";
  generation: number;
  phase: ManagedNodePhase;
  activeAttemptId?: string;
  activeDaemonNodeId?: string;
  conditions: Array<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateManagedNodeInput {
  employeeId: string;
  sandboxMode: "boxlite";
}

export interface CreateManagedNodeResponse {
  node: ManagedNodeRecord;
}

export type LogicalAgentAvailability = "ready" | "busy" | "pending" | "offline";

export interface AgentPlacement {
  id: string;
  agentId: string;
  employeeId: string;
  daemonNodeId: string;
  executorKind: AgentName;
  desiredState: "active" | "draining" | "removed";
  status: "pending" | "ready" | "busy" | "offline" | "incompatible" | "failed";
  priority: number;
  agentVersion: number;
  workspacePolicy: Record<string, unknown>;
  conditions: Array<{ reason: string; message: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeAgent {
  id: string;
  employeeId: string;
  displayName: string;
  executorKind: AgentName;
  instructions?: string;
  skillPolicy: Record<string, unknown>;
  toolPolicy: Record<string, unknown>;
  modelPolicy: Record<string, unknown>;
  enabled: boolean;
  version: number;
  availability: LogicalAgentAvailability;
  placements: AgentPlacement[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface EmployeeAgentsResponse {
  agents: EmployeeAgent[];
}

export interface AgentRunInput {
  taskGoal: string;
  assignments: Array<{
    agentId: string;
    mode: AgentTaskMode;
    role?: AgentRole;
  }>;
  sessionId?: string;
  userMessageId?: string;
  decision?: {
    kind: "rerun" | "handoff";
    targetAgent: AgentName;
    note?: string;
  };
}

export interface RunInput {
  sandboxId: string;
  taskGoal: string;
  assignments: Array<{
    agentId?: string;
    agent: AgentName;
    mode: AgentTaskMode;
    role?: AgentRole;
  }>;
  sessionId?: string;
  /** Client-generated id for the follow-up user message, so the optimistic echo
   * reconciles with the persisted event by id. Ignored for new sessions. */
  userMessageId?: string;
  decision?: {
    kind: "rerun" | "handoff";
    note?: string;
    targetAgent?: AgentName;
  };
}

export interface CreateSessionInput {
  taskGoal: string;
  assignments: RunInput["assignments"];
  workspacePath?: string;
  ownerEmployeeId?: string;
}

export interface TaskMutationInput {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  dueDate?: string;
  isRoutine?: boolean;
  routineType?: TaskRoutineType;
  routineCadence?: TaskRoutineCadence;
  routineNextRunDate?: string;
  routineEnabled?: boolean;
  assigneeEmployeeId?: string;
  assignedAgent?: AgentName;
  assignedAgentId?: string;
}

export interface CreateTaskInput extends TaskMutationInput {
  title: string;
}

export interface StartTaskResponse {
  task: RelayTask;
  session: RelaySession | null;
}

export interface ApiErrorBody {
  error?: string;
}

export type UserRole = "admin" | "user";

export interface CurrentUser {
  id: string;
  username: string;
  email?: string;
  role: UserRole;
  employeeId?: string;
  displayName?: string;
}

export type ChatProvider = "discord" | "telegram" | "lark";
export type ChatIntegrationStatus = "draft" | "active" | "degraded" | "disabled";

export interface ChatIdentityLink {
  id: string;
  externalUserId: string;
  employeeId: string;
  displayName?: string | null;
  defaultAgentId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatAllowedConversation {
  id: string;
  conversationId: string;
  threadId?: string | null;
  label: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatIntegration {
  id: string;
  provider: ChatProvider;
  displayName: string;
  tenantId?: string | null;
  status: ChatIntegrationStatus;
  config: Record<string, string | number | boolean>;
  health: {
    ok: boolean;
    message: string;
    lastCheckedAt?: string | null;
  };
  secretConfigured: boolean;
  secretKeys: string[];
  identityLinkCount: number;
  allowedConversationCount: number;
  identityLinks: ChatIdentityLink[];
  allowedConversations: ChatAllowedConversation[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatIntegrationsResponse {
  integrations: ChatIntegration[];
}
