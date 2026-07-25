import type { AgentName, AgentTaskMode } from "./state.js";
import type { RelaySession } from "./session-store.js";
import type { ControlPanelDaemonNodeRecord, SandboxRecord, SandboxRunAssignment } from "./daemon-protocol.js";

export type RemoteDecisionKind = "approve" | "reject" | "cancel" | "rerun" | "mark_done";

export interface RecordDecisionInput {
  sessionId: string;
  kind: RemoteDecisionKind;
  note?: string;
  targetAgent?: AgentName;
}

export interface RecordHandoffInput {
  sessionId: string;
  targetAgent: AgentName;
  note?: string;
  mode?: AgentTaskMode;
}

export interface RelayDaemonClientOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  token?: string;
  nodeToken?: string;
}

export interface ProvisionSandboxInput {
  employeeId: string;
  workspacePath?: string;
  sandboxId?: string;
}

export interface RunSandboxInput {
  sandboxId: string;
  taskGoal: string;
  assignments: SandboxRunAssignment[];
  sessionId?: string;
  signal?: AbortSignal;
}

export interface CancelSandboxRunInput {
  sandboxId: string;
  sessionId: string;
  reason?: string;
}

export interface CreateSessionInput {
  taskGoal: string;
  daemonNodeId?: string;
  assignments?: SandboxRunAssignment[];
  workspacePath?: string;
  signal?: AbortSignal;
}

export class RelayDaemonClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private token?: string;
  private readonly nodeToken?: string;

  constructor(options: RelayDaemonClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.RELAY_BACKEND_URL ?? process.env.RELAY_DAEMON_URL ?? "http://127.0.0.1:8790");
    this.fetchFn = options.fetchFn ?? fetch;
    this.token = options.token ?? process.env.RELAY_DAEMON_UI_TOKEN;
    this.nodeToken = options.nodeToken ?? process.env.RELAY_DAEMON_TOKEN ?? process.env.RELAY_DAEMON_NODE_TOKEN;
  }

  currentToken(): string | undefined {
    return this.token;
  }

  async provisionSandbox(input: ProvisionSandboxInput): Promise<SandboxRecord> {
    const sandbox = await this.request<SandboxRecord>("/sandboxes", {
      method: "POST",
      body: {
        ...input,
        nodeToken: this.nodeToken,
      },
    });
    // A fresh provision returns the plaintext sandbox token exactly once; the
    // daemon keeps only the hash. Adopt it so follow-up requests authenticate.
    if (sandbox.token) this.token = sandbox.token;
    return sandbox;
  }

  async listControlPanelDaemonNodes(): Promise<ControlPanelDaemonNodeRecord[]> {
    const body = await this.request<{ nodes?: ControlPanelDaemonNodeRecord[] }>("/daemon-nodes");
    return Array.isArray(body.nodes) ? body.nodes : [];
  }

  async getSandbox(sandboxId: string): Promise<SandboxRecord> {
    return this.request<SandboxRecord>(`/sandboxes/${encodeURIComponent(sandboxId)}`);
  }

  async createSession(input: CreateSessionInput): Promise<RelaySession> {
    return this.request<RelaySession>("/sessions", {
      method: "POST",
      signal: input.signal,
      body: {
        taskGoal: input.taskGoal,
        ...(input.daemonNodeId ? { daemonNodeId: input.daemonNodeId } : {}),
        assignments: input.assignments,
        workspacePath: input.workspacePath,
      },
    });
  }

  async listSessions(signal?: AbortSignal): Promise<RelaySession[]> {
    const body = await this.request<{ sessions?: RelaySession[] }>("/sessions", { signal });
    return Array.isArray(body.sessions) ? body.sessions : [];
  }

  async getSession(sessionId: string, signal?: AbortSignal): Promise<RelaySession> {
    return this.request<RelaySession>(`/sessions/${encodeURIComponent(sessionId)}`, { signal });
  }

  async renameSession(sessionId: string, title: string, signal?: AbortSignal): Promise<RelaySession> {
    return this.request<RelaySession>(`/sessions/${encodeURIComponent(sessionId)}/title`, {
      method: "POST",
      signal,
      body: { title },
    });
  }

  async runSandbox(input: RunSandboxInput): Promise<RelaySession> {
    const submitted = await this.request<RelaySession>(`/sandboxes/${encodeURIComponent(input.sandboxId)}/runs`, {
      method: "POST",
      signal: input.signal,
      body: {
        taskGoal: input.taskGoal,
        assignments: input.assignments,
        sessionId: input.sessionId,
      },
    });
    return this.waitForSessionTerminal(submitted.id, input.signal);
  }

  async recordDecision(input: RecordDecisionInput): Promise<RelaySession> {
    return this.request<RelaySession>(
      `/sessions/${encodeURIComponent(input.sessionId)}/decisions`,
      {
        method: "POST",
        body: {
          kind: input.kind,
          note: input.note,
          targetAgent: input.targetAgent,
        },
      },
    );
  }

  async recordHandoff(input: RecordHandoffInput): Promise<RelaySession> {
    return this.request<RelaySession>(
      `/sessions/${encodeURIComponent(input.sessionId)}/handoffs`,
      {
        method: "POST",
        body: {
          targetAgent: input.targetAgent,
          note: input.note,
          mode: input.mode,
        },
      },
    );
  }

  async cancelSandboxRun(input: CancelSandboxRunInput): Promise<RelaySession> {
    return this.request<RelaySession>(
      `/sandboxes/${encodeURIComponent(input.sandboxId)}/runs/${encodeURIComponent(input.sessionId)}/cancel`,
      {
        method: "POST",
        body: {
          reason: input.reason,
        },
      },
    );
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
    if (!response.ok) {
      const detail = responseErrorText(text, response.statusText);
      throw new Error(`Relay daemon request failed: ${detail}`);
    }
    const parsed = text.trim() ? JSON.parse(text) : undefined;
    return parsed as T;
  }

  private async waitForSessionTerminal(sessionId: string, signal?: AbortSignal): Promise<RelaySession> {
    while (true) {
      if (signal?.aborted) throw new Error("Relay daemon request cancelled.");
      const session = await this.getSession(sessionId, signal);
      if (session.status === "completed" || session.status === "failed" || session.status === "cancelled") {
        return session;
      }
      await sleep(1000, signal);
    }
  }
}

export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Relay daemon request cancelled."));
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Relay daemon request cancelled."));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function responseErrorText(text: string, statusText: string): string {
  if (!text.trim()) return statusText;
  try {
    const parsed = JSON.parse(text) as { detail?: unknown; error?: unknown };
    return String(parsed.detail ?? parsed.error ?? statusText);
  } catch {
    return text;
  }
}
