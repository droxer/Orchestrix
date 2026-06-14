import type {
  AgentName,
  AssignControlPanelDaemonNodeResponse,
  CreateControlPanelEmployeeInput,
  CreateControlPanelEmployeeResponse,
  CreateControlPanelDaemonNodeInput,
  CreateControlPanelDaemonNodeResponse,
  CreateSessionInput,
  ControlPanelDaemonNodesResponse,
  ControlPanelEmployeesResponse,
  CurrentUser,
  DaemonNodesResponse,
  RelaySession,
  RunInput,
  SandboxesResponse,
  SandboxRecord,
  SessionsResponse,
  UserRole,
} from "./types.js";

export class RelayApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function apiJson<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string; signal?: AbortSignal; credentials?: RequestCredentials } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    signal: options.signal,
    credentials: options.credentials ?? "include",
    headers: {
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const parsed = text.trim() ? JSON.parse(text) as { detail?: unknown; error?: unknown } : undefined;
  if (!response.ok) {
    const message = parsed && typeof parsed.detail === "string"
      ? parsed.detail
      : parsed && typeof parsed.error === "string"
        ? parsed.error
        : response.statusText;
    throw new RelayApiError(message, response.status);
  }
  return parsed as T;
}

export function listSandboxes(token?: string, signal?: AbortSignal): Promise<SandboxesResponse> {
  return apiJson<SandboxesResponse>("/sandboxes", { token, signal });
}

export function listDaemonNodes(token?: string, signal?: AbortSignal): Promise<DaemonNodesResponse> {
  return apiJson<DaemonNodesResponse>("/daemon-nodes", { token, signal });
}

export function listControlPanelDaemonNodes(signal?: AbortSignal): Promise<ControlPanelDaemonNodesResponse> {
  return apiJson<ControlPanelDaemonNodesResponse>("/cp/daemon-nodes", { signal });
}

export function listControlPanelEmployees(signal?: AbortSignal): Promise<ControlPanelEmployeesResponse> {
  return apiJson<ControlPanelEmployeesResponse>("/cp/employees", { signal });
}

export function createControlPanelEmployee(
  input: CreateControlPanelEmployeeInput,
): Promise<CreateControlPanelEmployeeResponse> {
  return apiJson<CreateControlPanelEmployeeResponse>("/cp/employees", {
    method: "POST",
    body: {
      employeeId: input.employeeId,
      username: input.username,
      password: input.password,
      nodeId: input.nodeId,
      ...(input.email ? { email: input.email } : {}),
      ...(input.displayName ? { displayName: input.displayName } : {}),
    },
  });
}

export function assignControlPanelDaemonNode(
  input: { nodeId: string; employeeId: string },
): Promise<AssignControlPanelDaemonNodeResponse> {
  return apiJson<AssignControlPanelDaemonNodeResponse>(`/cp/daemon-nodes/${encodeURIComponent(input.nodeId)}/assign`, {
    method: "POST",
    body: { employeeId: input.employeeId },
  });
}

export function createControlPanelDaemonNode(
  input: CreateControlPanelDaemonNodeInput,
): Promise<CreateControlPanelDaemonNodeResponse> {
  return apiJson<CreateControlPanelDaemonNodeResponse>("/cp/daemon-nodes", {
    method: "POST",
    body: {
      employeeId: input.employeeId,
      ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
    },
  });
}

export function getAuthStatus(signal?: AbortSignal): Promise<{ requiresBootstrap: boolean }> {
  return apiJson<{ requiresBootstrap: boolean }>("/auth/status", { signal });
}

export function getMe(signal?: AbortSignal): Promise<{ authenticated: boolean; user?: CurrentUser }> {
  return apiJson<{ authenticated: boolean; user?: CurrentUser }>("/auth/me", { signal });
}

export function bootstrapUser(input: { token: string; username: string; password: string }): Promise<{ user: CurrentUser }> {
  return apiJson<{ user: CurrentUser }>("/auth/bootstrap", {
    method: "POST",
    body: input,
  });
}

export function login(input: { username: string; password: string }): Promise<{ user: CurrentUser }> {
  return apiJson<{ user: CurrentUser }>("/auth/login", {
    method: "POST",
    body: input,
  });
}

export function logout(): Promise<{ ok: boolean }> {
  return apiJson<{ ok: boolean }>("/auth/logout", { method: "POST" });
}

export function listUsers(): Promise<{ users: CurrentUser[] }> {
  return apiJson<{ users: CurrentUser[] }>("/cp/users");
}

export function createUser(input: { username: string; password: string; role?: UserRole; email?: string; employeeId?: string }): Promise<{ user: CurrentUser }> {
  return apiJson<{ user: CurrentUser }>("/cp/users", {
    method: "POST",
    body: input,
  });
}

export function listSessions(signal?: AbortSignal): Promise<SessionsResponse> {
  return apiJson<SessionsResponse>("/sessions", { signal });
}

export function provisionSandbox(employeeId: string, token?: string, nodeToken?: string): Promise<SandboxRecord> {
  // No workspacePath: the daemon matches by employee, so we attach to the
  // employee's registered daemon node (whatever workspace it runs in) instead
  // of provisioning a dead placeholder under a fabricated path.
  return apiJson<SandboxRecord>("/sandboxes", {
    method: "POST",
    token,
    body: {
      employeeId,
      ...(nodeToken ? { nodeToken } : {}),
    },
  });
}

export function createSession(input: CreateSessionInput, token?: string): Promise<RelaySession> {
  return apiJson<RelaySession>("/sessions", {
    method: "POST",
    token,
    body: {
      taskGoal: input.taskGoal,
      assignments: input.assignments,
      workspacePath: input.workspacePath,
      ...(input.ownerEmployeeId ? { ownerEmployeeId: input.ownerEmployeeId } : {}),
    },
  });
}

export function runSandbox(input: RunInput, token?: string): Promise<RelaySession> {
  return apiJson<RelaySession>(`/sandboxes/${encodeURIComponent(input.sandboxId)}/runs`, {
    method: "POST",
    token,
    body: {
      taskGoal: input.taskGoal,
      assignments: input.assignments,
      sessionId: input.sessionId,
    },
  });
}

export function cancelRun(sandboxId: string, sessionId: string, token?: string, reason?: string): Promise<RelaySession> {
  return apiJson<RelaySession>(`/sandboxes/${encodeURIComponent(sandboxId)}/runs/${encodeURIComponent(sessionId)}/cancel`, {
    method: "POST",
    token,
    body: { reason: reason ?? "Cancelled from Relay Web UI." },
  });
}

export function recordDecision(
  sessionId: string,
  kind: "approve" | "reject" | "rerun" | "mark_done",
  note?: string,
  token?: string,
): Promise<RelaySession> {
  return apiJson<RelaySession>(`/sessions/${encodeURIComponent(sessionId)}/decisions`, {
    method: "POST",
    token,
    body: { kind, note },
  });
}

export function recordHandoff(
  sessionId: string,
  targetAgent: AgentName,
  mode: "implement" | "review",
  note?: string,
  token?: string,
): Promise<RelaySession> {
  return apiJson<RelaySession>(`/sessions/${encodeURIComponent(sessionId)}/handoffs`, {
    method: "POST",
    token,
    body: { targetAgent, mode, note },
  });
}
