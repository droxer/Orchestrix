import type {
  AgentName,
  AgentRole,
  AgentTaskMode,
  ArtifactsResponse,
  AssignControlPanelDaemonNodeResponse,
  ChatIntegration,
  ChatIntegrationsResponse,
  ChatProvider,
  CreateControlPanelEmployeeInput,
  CreateControlPanelEmployeeResponse,
  CreateControlPanelDaemonNodeInput,
  CreateControlPanelDaemonNodeResponse,
  CreateSessionInput,
  CreateTaskInput,
  ControlPanelDaemonNodesResponse,
  ControlPanelEmployeesResponse,
  CurrentUser,
  UnassignControlPanelDaemonNodeResponse,
  DaemonNodesResponse,
  RelaySession,
  RelayTask,
  RunInput,
  SandboxesResponse,
  SandboxRecord,
  SessionsResponse,
  StartTaskResponse,
  UserRole,
  TaskArtifactsResponse,
  TaskMutationInput,
  TasksResponse,
  WorkspaceBriefResponse,
  WorkspaceFilesResponse,
  WorkspaceFileContentResponse,
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
  let parsed: unknown;
  try {
    parsed = text.trim() ? JSON.parse(text) : undefined;
  } catch (error) {
    if (!response.ok) {
      throw new RelayApiError(text.trim() || response.statusText, response.status);
    }
    throw error;
  }
  if (!response.ok) {
    const detail = parsed && typeof parsed === "object" && "detail" in parsed ? parsed.detail : undefined;
    const error = parsed && typeof parsed === "object" && "error" in parsed ? parsed.error : undefined;
    const message = typeof detail === "string"
      ? detail
      : typeof error === "string"
        ? error
        : text.trim() || response.statusText;
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
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
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
      ...(input.employeeId ? { employeeId: input.employeeId } : {}),
      ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
    },
  });
}

export function unassignControlPanelDaemonNode(
  nodeId: string,
): Promise<UnassignControlPanelDaemonNodeResponse> {
  return apiJson<UnassignControlPanelDaemonNodeResponse>(
    `/cp/daemon-nodes/${encodeURIComponent(nodeId)}/unassign`,
    { method: "POST" },
  );
}

export function deleteControlPanelDaemonNode(nodeId: string): Promise<void> {
  return apiJson<void>(`/cp/daemon-nodes/${encodeURIComponent(nodeId)}`, { method: "DELETE" });
}

export function updateControlPanelDaemonNodeDisabledAgents(
  nodeId: string,
  disabledAgents: AgentName[],
): Promise<UnassignControlPanelDaemonNodeResponse> {
  return apiJson<UnassignControlPanelDaemonNodeResponse>(
    `/cp/daemon-nodes/${encodeURIComponent(nodeId)}/disabled-agents`,
    { method: "PATCH", body: { disabledAgents } },
  );
}

export function updateControlPanelDaemonNodeAgentRoleDefaults(
  nodeId: string,
  agentRoleDefaults: Partial<Record<AgentName, AgentRole>>,
): Promise<UnassignControlPanelDaemonNodeResponse> {
  return apiJson<UnassignControlPanelDaemonNodeResponse>(
    `/cp/daemon-nodes/${encodeURIComponent(nodeId)}/agent-role-defaults`,
    { method: "PATCH", body: { agentRoleDefaults } },
  );
}

export function updateDaemonNodeAgentRoleOverrides(
  nodeId: string,
  agentRoleOverrides: Partial<Record<AgentName, AgentRole>>,
  token?: string,
): Promise<UnassignControlPanelDaemonNodeResponse> {
  return apiJson<UnassignControlPanelDaemonNodeResponse>(
    `/daemon-nodes/${encodeURIComponent(nodeId)}/agent-role-overrides`,
    { method: "PATCH", body: { agentRoleOverrides }, token },
  );
}

export function deleteControlPanelEmployee(
  employeeId: string,
): Promise<{ employee: { id: string; deletedAt: string }; unassignedNodes: string[] }> {
  return apiJson<{ employee: { id: string; deletedAt: string }; unassignedNodes: string[] }>(
    `/cp/employees/${encodeURIComponent(employeeId)}`,
    { method: "DELETE" },
  );
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

export function listArtifacts(
  input: { employeeId?: string; workspacePath?: string } = {},
  signal?: AbortSignal,
): Promise<ArtifactsResponse> {
  const params = new URLSearchParams();
  if (input.employeeId) params.set("employeeId", input.employeeId);
  if (input.workspacePath) params.set("workspacePath", input.workspacePath);
  const query = params.toString();
  return apiJson<ArtifactsResponse>(`/artifacts${query ? `?${query}` : ""}`, { signal });
}

export function getWorkspaceBrief(
  input: { employeeId?: string } = {},
  signal?: AbortSignal,
): Promise<WorkspaceBriefResponse> {
  const params = new URLSearchParams();
  if (input.employeeId) params.set("employeeId", input.employeeId);
  const query = params.toString();
  return apiJson<WorkspaceBriefResponse>(`/workspace/brief${query ? `?${query}` : ""}`, { signal });
}

export function listWorkspaceFiles(
  input: { employeeId?: string; path?: string } = {},
  signal?: AbortSignal,
): Promise<WorkspaceFilesResponse> {
  const params = new URLSearchParams();
  if (input.employeeId) params.set("employeeId", input.employeeId);
  if (input.path) params.set("path", input.path);
  const query = params.toString();
  return apiJson<WorkspaceFilesResponse>(`/workspace/files${query ? `?${query}` : ""}`, { signal });
}

export function readWorkspaceFile(
  input: { employeeId?: string; path: string },
  signal?: AbortSignal,
): Promise<WorkspaceFileContentResponse> {
  const params = new URLSearchParams();
  if (input.employeeId) params.set("employeeId", input.employeeId);
  params.set("path", input.path);
  return apiJson<WorkspaceFileContentResponse>(`/workspace/file?${params.toString()}`, { signal });
}

export function listTasks(signal?: AbortSignal): Promise<TasksResponse> {
  return apiJson<TasksResponse>("/tasks", { signal });
}

export function createTask(input: CreateTaskInput): Promise<RelayTask> {
  return apiJson<RelayTask>("/tasks", {
    method: "POST",
    body: input,
  });
}

export function updateTask(taskId: string, input: TaskMutationInput): Promise<RelayTask> {
  return apiJson<RelayTask>(`/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: input,
  });
}

export function assignTask(taskId: string, agent: AgentName): Promise<RelayTask> {
  return apiJson<RelayTask>(`/tasks/${encodeURIComponent(taskId)}/assign`, {
    method: "POST",
    body: { agent },
  });
}

export function startTask(taskId: string, input: { agent?: AgentName; mode?: AgentTaskMode; assignments?: RunInput["assignments"] } = {}): Promise<StartTaskResponse> {
  return apiJson<StartTaskResponse>(`/tasks/${encodeURIComponent(taskId)}/start`, {
    method: "POST",
    body: input,
  });
}

export function listTaskArtifacts(taskId: string, signal?: AbortSignal): Promise<TaskArtifactsResponse> {
  return apiJson<TaskArtifactsResponse>(`/tasks/${encodeURIComponent(taskId)}/artifacts`, { signal });
}

export async function readArtifactText(
  sessionId: string,
  artifactId: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(
    `/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}`,
    { credentials: "include", signal },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new RelayApiError(text.trim() || response.statusText, response.status);
  }
  return text;
}

export interface DashboardSessionsResponse {
  total: number;
  last24h: number;
  last7d: number;
  statusCounts: Record<string, number>;
  dailyCounts: Array<{ date: string; count: number; completed: number; failed: number }>;
  topEmployees: Array<{ employeeId: string; sessionCount: number }>;
}

export interface DashboardActivityItem {
  kind: string;
  timestamp: string;
  sessionId?: string;
  taskId?: string;
  employeeId?: string | null;
  message: string;
}

export interface TokenUsageSnapshot {
  available: boolean;
  totalInput: number;
  totalOutput: number;
  totalCache: number;
  total: number;
  daily: Array<{ date: string; input: number; output: number; cache: number; total: number }>;
  byEmployee: Array<{ employeeId: string; input: number; output: number; cache: number; total: number; sessionCount: number }>;
  recentSessions: Array<{ sessionId: string; employeeId?: string | null; taskGoal?: string; updatedAt?: string; input: number; output: number; cache: number; total: number }>;
}

export function getDashboardSessions(signal?: AbortSignal): Promise<DashboardSessionsResponse> {
  return apiJson<DashboardSessionsResponse>("/cp/dashboard/sessions", { signal });
}

export function getDashboardActivity(signal?: AbortSignal): Promise<{ items: DashboardActivityItem[] }> {
  return apiJson<{ items: DashboardActivityItem[] }>("/cp/dashboard/activity?limit=20", { signal });
}

export function getDashboardTokens(signal?: AbortSignal): Promise<TokenUsageSnapshot> {
  return apiJson<TokenUsageSnapshot>("/cp/dashboard/tokens", { signal });
}

export function listChatIntegrations(signal?: AbortSignal): Promise<ChatIntegrationsResponse> {
  return apiJson<ChatIntegrationsResponse>("/cp/chat-integrations", { signal });
}

export function createChatIntegration(input: {
  provider: ChatProvider;
  displayName: string;
  tenantId?: string;
  secrets?: Record<string, string>;
  config?: Record<string, string | number | boolean>;
}): Promise<{ integration: ChatIntegration }> {
  return apiJson<{ integration: ChatIntegration }>("/cp/chat-integrations", {
    method: "POST",
    body: input,
  });
}

export function checkChatIntegration(integrationId: string): Promise<{ integration: ChatIntegration }> {
  return apiJson<{ integration: ChatIntegration }>(
    `/cp/chat-integrations/${encodeURIComponent(integrationId)}/check`,
    { method: "POST" },
  );
}

export function activateChatIntegration(integrationId: string): Promise<{ integration: ChatIntegration }> {
  return apiJson<{ integration: ChatIntegration }>(
    `/cp/chat-integrations/${encodeURIComponent(integrationId)}/activate`,
    { method: "POST" },
  );
}

export function addChatIdentityLink(
  integrationId: string,
  input: { externalUserId: string; employeeId: string; displayName?: string; defaultSandboxId?: string },
): Promise<{ integration: ChatIntegration }> {
  return apiJson<{ integration: ChatIntegration }>(
    `/cp/chat-integrations/${encodeURIComponent(integrationId)}/identity-links`,
    { method: "POST", body: input },
  );
}

export function deleteChatIdentityLink(integrationId: string, linkId: string): Promise<{ integration: ChatIntegration }> {
  return apiJson<{ integration: ChatIntegration }>(
    `/cp/chat-integrations/${encodeURIComponent(integrationId)}/identity-links/${encodeURIComponent(linkId)}`,
    { method: "DELETE" },
  );
}

export function addChatAllowedConversation(
  integrationId: string,
  input: { conversationId: string; threadId?: string; label?: string },
): Promise<{ integration: ChatIntegration }> {
  return apiJson<{ integration: ChatIntegration }>(
    `/cp/chat-integrations/${encodeURIComponent(integrationId)}/allowed-conversations`,
    { method: "POST", body: input },
  );
}

export function deleteChatAllowedConversation(
  integrationId: string,
  conversationRecordId: string,
): Promise<{ integration: ChatIntegration }> {
  return apiJson<{ integration: ChatIntegration }>(
    `/cp/chat-integrations/${encodeURIComponent(integrationId)}/allowed-conversations/${encodeURIComponent(conversationRecordId)}`,
    { method: "DELETE" },
  );
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
      ...(input.userMessageId ? { userMessageId: input.userMessageId } : {}),
      ...(input.decision ? { decision: input.decision } : {}),
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
  targetAgent?: AgentName,
): Promise<RelaySession> {
  return apiJson<RelaySession>(`/sessions/${encodeURIComponent(sessionId)}/decisions`, {
    method: "POST",
    token,
    body: { kind, note, ...(targetAgent ? { targetAgent } : {}) },
  });
}

export function appendAssignment(
  sessionId: string,
  assignment: { agent: AgentName; mode: AgentTaskMode },
  token?: string,
): Promise<RelaySession> {
  return apiJson<RelaySession>(`/sessions/${encodeURIComponent(sessionId)}/assignments`, {
    method: "POST",
    token,
    body: { assignments: [assignment] },
  });
}

export function archiveSession(sessionId: string, token?: string): Promise<RelaySession> {
  return apiJson<RelaySession>(`/sessions/${encodeURIComponent(sessionId)}/archive`, {
    method: "POST",
    token,
  });
}

export function renameSession(sessionId: string, title: string, token?: string): Promise<RelaySession> {
  return apiJson<RelaySession>(`/sessions/${encodeURIComponent(sessionId)}/title`, {
    method: "POST",
    token,
    body: { title },
  });
}

export function recordHandoff(
  sessionId: string,
  targetAgent: AgentName,
  mode: AgentTaskMode,
  note?: string,
  token?: string,
): Promise<RelaySession> {
  return apiJson<RelaySession>(`/sessions/${encodeURIComponent(sessionId)}/handoffs`, {
    method: "POST",
    token,
    body: { targetAgent, mode, note },
  });
}
