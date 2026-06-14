import type {
  AgentName,
  CodexTaskMode,
  ControlPanelDaemonNodeRecord,
  DaemonNodeMonitorRecord,
  RelaySession,
  SandboxRecord,
} from "relay-core";

export type { AgentName, CodexTaskMode, ControlPanelDaemonNodeRecord, DaemonNodeMonitorRecord, RelaySession, SandboxRecord };

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
  nodeId: string;
  email?: string;
  displayName?: string;
}

export interface CreateControlPanelEmployeeResponse {
  employee: EmployeeRecord;
  user: CurrentUser;
  node: ControlPanelDaemonNodeRecord;
}

export interface AssignControlPanelDaemonNodeResponse {
  employee: EmployeeRecord;
  node: ControlPanelDaemonNodeRecord;
}

export interface CreateControlPanelDaemonNodeInput {
  employeeId: string;
  workspacePath?: string;
}

export interface CreateControlPanelDaemonNodeResponse {
  node: ControlPanelDaemonNodeRecord;
  sandboxToken?: string;
  nodeToken?: string;
  daemonCommand?: string;
  daemonEnv: Record<string, string>;
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

export interface CreateSessionInput {
  taskGoal: string;
  assignments: RunInput["assignments"];
  workspacePath?: string;
  ownerEmployeeId?: string;
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
