import type {
  CreateSessionInput,
  ControlPanelDaemonNodesResponse,
  DaemonNodesResponse,
  RelaySession,
  RunInput,
  SandboxesResponse,
  SandboxRecord,
  SessionsResponse,
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
  options: { method?: string; body?: unknown; token?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    signal: options.signal,
    headers: {
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const parsed = text.trim() ? JSON.parse(text) as { error?: unknown } : undefined;
  if (!response.ok) {
    const message = parsed && typeof parsed.error === "string" ? parsed.error : response.statusText;
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

export function listSessions(token?: string, signal?: AbortSignal): Promise<SessionsResponse> {
  return apiJson<SessionsResponse>("/sessions", { token, signal });
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

export function cancelRun(sandboxId: string, sessionId: string, token?: string): Promise<RelaySession> {
  return apiJson<RelaySession>(`/sandboxes/${encodeURIComponent(sandboxId)}/runs/${encodeURIComponent(sessionId)}/cancel`, {
    method: "POST",
    token,
    body: { reason: "Cancelled from Relay Web UI." },
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
  targetAgent: "claude" | "pi" | "codex",
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
