import type { RelaySession } from "./session.js";
import type { SandboxRecord, SandboxRunAssignment } from "./daemon.js";

export interface RelayDaemonClientOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  token?: string;
}

export interface ProvisionSandboxInput {
  employeeId: string;
  workspacePath?: string;
}

export interface RunSandboxInput {
  sandboxId: string;
  taskGoal: string;
  assignments: SandboxRunAssignment[];
  sessionId?: string;
  signal?: AbortSignal;
}

export class RelayDaemonClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private token?: string;

  constructor(options: RelayDaemonClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.RELAY_DAEMON_URL ?? "http://127.0.0.1:8790");
    this.fetchFn = options.fetchFn ?? fetch;
    this.token = options.token ?? process.env.RELAY_DAEMON_NODE_TOKEN;
  }

  async provisionSandbox(input: ProvisionSandboxInput): Promise<SandboxRecord> {
    return this.request<SandboxRecord>("/sandboxes", {
      method: "POST",
      body: input,
    });
  }

  async getSandbox(sandboxId: string): Promise<SandboxRecord> {
    return this.request<SandboxRecord>(`/sandboxes/${encodeURIComponent(sandboxId)}`);
  }

  async runSandbox(input: RunSandboxInput): Promise<RelaySession> {
    return this.request<RelaySession>(`/sandboxes/${encodeURIComponent(input.sandboxId)}/runs`, {
      method: "POST",
      signal: input.signal,
      body: {
        taskGoal: input.taskGoal,
        assignments: input.assignments,
        sessionId: input.sessionId,
      },
    });
  }

  private async request<T>(
    pathname: string,
    options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    const response = await this.fetchFn(`${this.baseUrl}${pathname}`, {
      method: options.method ?? "GET",
      signal: options.signal,
      headers: {
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    const parsed = text.trim() ? JSON.parse(text) : undefined;
    if (!response.ok) {
      const detail = parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : response.statusText;
      throw new Error(`Relay daemon request failed: ${detail}`);
    }
    return parsed as T;
  }
}

export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
