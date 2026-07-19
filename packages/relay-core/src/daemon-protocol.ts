import type { AgentName, AgentTaskMode } from "./state.js";
import type { DaemonAgentAdapter, DaemonAgentInventory, DaemonNodeSandboxMode } from "./daemon-node-protocol.js";
import type { AgentRole } from "./session-store.js";

export type SandboxStatus = "provisioning" | "ready" | "busy" | "running" | "stopped" | "failed";

export interface SandboxRecord {
  id: string;
  employeeId?: string;
  workspacePath?: string;
  sandboxMode?: DaemonNodeSandboxMode;
  managedNodeId?: string;
  provisioningAttemptId?: string;
  credentialVersion?: number;
  retiredAt?: string;
  status: SandboxStatus;
  agents: Record<AgentName, "unknown" | "ready" | "failed">;
  agentDetails?: Partial<Record<AgentName, {
    detail?: string;
    version?: string;
    adapter?: DaemonAgentAdapter;
  }>>;
  disabledAgents?: AgentName[];
  agentInventory?: Partial<Record<AgentName, DaemonAgentInventory>>;
  agentRoleDefaults?: Partial<Record<AgentName, AgentRole>>;
  agentRoleOverrides?: Partial<Record<AgentName, AgentRole>>;
  maxConcurrentRuns?: number;
  runCapacityByMode?: Partial<Record<AgentTaskMode, number>>;
  token?: string;
  tokenHash?: string;
  uiTokenHash?: string;
  nodeTokenHash?: string;
  nodeToken?: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  lastError?: string;
}

export interface SandboxRunAssignment {
  agentId?: string;
  agent: AgentName;
  mode?: AgentTaskMode;
  role?: AgentRole;
}

export interface DaemonNodeActiveRun {
  commandId: string;
  sessionId: string;
  runId: string;
  agent: AgentName;
  logicalAgentId?: string;
  placementId?: string;
  mode: AgentTaskMode;
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
  displayName?: string;
  provisioningPlaceholder?: boolean;
  nodeToken?: string;
}
