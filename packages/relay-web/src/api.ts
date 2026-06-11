import type {
  DaemonNodesResponse,
  RelaySession,
  RunInput,
  SandboxesResponse,
  SandboxRecord,
  SessionsResponse,
} from "./types";

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

export function listSandboxes(signal?: AbortSignal): Promise<SandboxesResponse> {
  return apiJson<SandboxesResponse>("/sandboxes", { signal });
}

export function listDaemonNodes(signal?: AbortSignal): Promise<DaemonNodesResponse> {
  return apiJson<DaemonNodesResponse>("/daemon-nodes", { signal });
}

export function listSessions(signal?: AbortSignal): Promise<SessionsResponse> {
  return apiJson<SessionsResponse>("/sessions", { signal });
}

export function provisionSandbox(employeeId: string, token?: string): Promise<SandboxRecord> {
  return apiJson<SandboxRecord>("/sandboxes", {
    method: "POST",
    token,
    body: { employeeId, workspacePath: `/workspace/${employeeId}` },
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
): Promise<RelaySession> {
  return apiJson<RelaySession>(`/sessions/${encodeURIComponent(sessionId)}/decisions`, {
    method: "POST",
    body: { kind, note },
  });
}

export function recordHandoff(
  sessionId: string,
  targetAgent: "claude" | "pi" | "codex",
  mode: "implement" | "review",
  note?: string,
): Promise<RelaySession> {
  return apiJson<RelaySession>(`/sessions/${encodeURIComponent(sessionId)}/handoffs`, {
    method: "POST",
    body: { targetAgent, mode, note },
  });
}
