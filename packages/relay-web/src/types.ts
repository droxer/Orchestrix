import type {
  AgentName,
  CodexTaskMode,
  DaemonNodeMonitorRecord,
  RelaySession,
  SandboxRecord,
} from "relay-daemon";

export type { AgentName, CodexTaskMode, DaemonNodeMonitorRecord, RelaySession, SandboxRecord };

export interface SessionsResponse {
  sessions: RelaySession[];
}

export interface SandboxesResponse {
  sandboxes: SandboxRecord[];
}

export interface DaemonNodesResponse {
  nodes: DaemonNodeMonitorRecord[];
}

export interface RunInput {
  sandboxId: string;
  taskGoal: string;
  assignments: Array<{
    agent: AgentName;
    mode: CodexTaskMode;
  }>;
  sessionId?: string;
}

export interface ApiErrorBody {
  error?: string;
}
