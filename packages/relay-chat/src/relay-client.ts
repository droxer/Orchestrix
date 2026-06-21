import type { AgentName, AgentTaskMode, RelayEvent, RelaySession } from "relay-core";
import type { ChatConversationRef, RelayChatBackend, RelayChatRequestContext } from "./types.js";

function conversationBody(ref: ChatConversationRef): Record<string, unknown> {
  return {
    provider: ref.provider,
    externalUserId: ref.externalUserId,
    conversationId: ref.conversationId,
    threadId: ref.threadId,
    tenantId: ref.tenantId,
  };
}

export interface RelayChatClientOptions {
  baseUrl?: string;
  token?: string;
  fetchFn?: typeof fetch;
}

export class RelayChatClient implements RelayChatBackend {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: RelayChatClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.RELAY_BACKEND_URL ?? "http://127.0.0.1:8790");
    this.token = options.token ?? process.env.RELAY_CHAT_TOKEN;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async startSandboxRun(input: {
    sandboxId: string;
    taskGoal: string;
    assignments: Array<{ agent: AgentName; mode?: AgentTaskMode }>;
    sessionId?: string;
    employeeId?: string;
    signal?: AbortSignal;
  }): Promise<RelaySession> {
    return this.request<RelaySession>(`/sandboxes/${encodeURIComponent(input.sandboxId)}/runs`, {
      method: "POST",
      signal: input.signal,
      employeeId: input.employeeId,
      body: {
        taskGoal: input.taskGoal,
        assignments: input.assignments,
        sessionId: input.sessionId,
      },
    });
  }

  async cancelSandboxRun(input: {
    sandboxId: string;
    sessionId: string;
    reason?: string;
    employeeId?: string;
    signal?: AbortSignal;
  }): Promise<RelaySession> {
    return this.request<RelaySession>(
      `/sandboxes/${encodeURIComponent(input.sandboxId)}/runs/${encodeURIComponent(input.sessionId)}/cancel`,
      {
        method: "POST",
        signal: input.signal,
        employeeId: input.employeeId,
        body: {
          reason: input.reason,
        },
      },
    );
  }

  async getSession(sessionId: string, context: RelayChatRequestContext = {}): Promise<RelaySession> {
    return this.request<RelaySession>(`/sessions/${encodeURIComponent(sessionId)}`, {
      signal: context.signal,
      employeeId: context.employeeId,
    });
  }

  async streamSessionEvents(
    sessionId: string,
    onEvent: (event: RelayEvent) => Promise<void> | void,
    context: RelayChatRequestContext = {},
  ): Promise<void> {
    const response = await this.fetchFn(`${this.baseUrl}/sessions/${encodeURIComponent(sessionId)}/events`, {
      method: "GET",
      signal: context.signal,
      headers: this.headers(false, context.employeeId),
    });
    if (!response.ok) {
      throw new Error(`Relay session stream failed: ${await responseError(response)}`);
    }
    if (!response.body) return;
    let buffer = "";
    const decoder = new TextDecoder();
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const event = parseSseRelayEvent(frame);
        if (event) await onEvent(event);
      }
    }
    buffer += decoder.decode();
    const event = parseSseRelayEvent(buffer);
    if (event) await onEvent(event);
  }

  async resolveConversationSession(ref: ChatConversationRef, signal?: AbortSignal): Promise<RelaySession | undefined> {
    const body = await this.request<{ session?: RelaySession | null }>("/chat/conversation/session", {
      method: "POST",
      signal,
      body: conversationBody(ref),
    });
    return body.session ?? undefined;
  }

  async bindConversationSession(ref: ChatConversationRef, sessionId: string, signal?: AbortSignal): Promise<void> {
    await this.request<{ mapping?: unknown }>("/chat/conversation/mapping", {
      method: "POST",
      signal,
      body: { ...conversationBody(ref), sessionId },
    });
  }

  async listConversationSessions(ref: ChatConversationRef, signal?: AbortSignal): Promise<RelaySession[]> {
    const body = await this.request<{ sessions?: RelaySession[] }>("/chat/conversation/sessions", {
      method: "POST",
      signal,
      body: conversationBody(ref),
    });
    return Array.isArray(body.sessions) ? body.sessions : [];
  }

  private async request<T>(
    pathname: string,
    options: { method?: string; body?: unknown; signal?: AbortSignal; employeeId?: string } = {},
  ): Promise<T> {
    const response = await this.fetchFn(`${this.baseUrl}${pathname}`, {
      method: options.method ?? "GET",
      signal: options.signal,
      headers: this.headers(options.body !== undefined, options.employeeId),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (!response.ok) {
      throw new Error(`Relay chat request failed: ${await responseError(response)}`);
    }
    const text = await response.text();
    return (text.trim() ? JSON.parse(text) : undefined) as T;
  }

  private headers(hasBody = false, employeeId?: string): Record<string, string> {
    return {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(employeeId ? { "X-Relay-Employee-Id": employeeId } : {}),
    };
  }
}

export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export function parseSseRelayEvent(frame: string): RelayEvent | undefined {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data) return undefined;
  const parsed = JSON.parse(data) as unknown;
  if (isRelayEvent(parsed)) return parsed;
  return undefined;
}

function isRelayEvent(value: unknown): value is RelayEvent {
  return typeof value === "object"
    && value !== null
    && "id" in value
    && "type" in value
    && "sessionId" in value;
}

async function responseError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text.trim()) return response.statusText;
  try {
    const parsed = JSON.parse(text) as { detail?: unknown; error?: unknown };
    return String(parsed.detail ?? parsed.error ?? response.statusText);
  } catch {
    return text;
  }
}
