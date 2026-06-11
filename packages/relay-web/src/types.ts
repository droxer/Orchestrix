import type {
  AgentName,
  CodexTaskMode,
  DaemonNodeMonitorRecord,
  RelaySession,
  SandboxRecord,
} from "relay-daemon";

export type { AgentName, CodexTaskMode, DaemonNodeMonitorRecord, RelaySession, SandboxRecord };

/** Single tone vocabulary for every status surface (toasts, pills, dots, stream status, system rows). */
export type Tone = "good" | "bad" | "warn" | "info" | "neutral";

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
