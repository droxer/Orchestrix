import type { AgentName, AgentTaskMode } from "./state.js";
import type { DaemonAgentAdapter } from "./daemon-node-protocol.js";

export type SandboxStatus = "provisioning" | "ready" | "running" | "stopped" | "failed";

export interface SandboxRecord {
  id: string;
  employeeId?: string;
  workspacePath?: string;
  status: SandboxStatus;
  agents: Record<AgentName, "unknown" | "ready" | "failed">;
  agentDetails?: Partial<Record<AgentName, {
    detail?: string;
    version?: string;
    adapter?: DaemonAgentAdapter;
  }>>;
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
  agent: AgentName;
  mode?: AgentTaskMode;
}

export interface DaemonNodeActiveRun {
  commandId: string;
  sessionId: string;
  runId: string;
  agent: AgentName;
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
  nodeToken?: string;
}
