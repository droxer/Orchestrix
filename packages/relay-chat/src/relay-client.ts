import { relayApiUrl, type AgentName, type RelayEvent, type RelaySession } from "relay-core";
import type { ChatConversationBinding, ChatConversationRef, RelayChatBackend, RelayChatRequestContext } from "./types.js";

function conversationBody(ref: ChatConversationRef): Record<string, unknown> {
  return {
    provider: ref.provider,
    externalUserId: ref.externalUserId,
    conversationId: ref.conversationId,
    threadId: ref.threadId,
    messageId: ref.messageId,
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

  async listEmployeeAgents(employeeId: string, signal?: AbortSignal): Promise<Array<{ id: string; executorKind: AgentName; availability: string }>> {
    const body = await this.request<{ agents?: Array<{ id: string; executorKind: AgentName; availability: string }> }>("/agents", {
      employeeId,
      signal,
    });
    return body.agents ?? [];
  }

  async startAgentRun(input: {
    agentId: string;
    taskGoal: string;
    sessionId?: string;
    employeeId?: string;
    idempotencyKey?: string;
    signal?: AbortSignal;
  }): Promise<RelaySession> {
    return this.request<RelaySession>("/agent-runs", {
      method: "POST",
      signal: input.signal,
      employeeId: input.employeeId,
      body: {
        taskGoal: input.taskGoal,
        assignments: [{ agentId: input.agentId }],
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
      },
    });
  }

  async continueThread(input: {
    sessionId: string;
    taskGoal: string;
    employeeId?: string;
    idempotencyKey?: string;
    signal?: AbortSignal;
  }): Promise<RelaySession> {
    return this.request<RelaySession>(
      `/threads/${encodeURIComponent(input.sessionId)}/messages`,
      {
        method: "POST",
        signal: input.signal,
        employeeId: input.employeeId,
        body: {
          text: input.taskGoal,
          intent: "accomplish",
          idempotencyKey: input.idempotencyKey,
        },
      },
    );
  }

  async cancelSessionRun(input: {
    sessionId: string;
    reason?: string;
    employeeId?: string;
    signal?: AbortSignal;
  }): Promise<RelaySession> {
    return this.request<RelaySession>(`/threads/${encodeURIComponent(input.sessionId)}/cancellations`, {
      method: "POST",
      signal: input.signal,
      employeeId: input.employeeId,
      body: { reason: input.reason },
    });
  }

  async getSession(sessionId: string, context: RelayChatRequestContext = {}): Promise<RelaySession> {
    return this.request<RelaySession>(`/threads/${encodeURIComponent(sessionId)}`, {
      signal: context.signal,
      employeeId: context.employeeId,
    });
  }

  async streamSessionEvents(
    sessionId: string,
    onEvent: (event: RelayEvent) => Promise<void> | void,
    context: RelayChatRequestContext = {},
  ): Promise<void> {
    let after: string | undefined;
    // A resumable stream must not become a hot loop. Reconnects that deliver no
    // event are backed off and then given up on, so a backend that ignores the
    // cursor or returns its timeout frame immediately cannot be hammered.
    let idleReconnects = 0;
    while (!context.signal?.aborted) {
      if (idleReconnects > 0) {
        if (idleReconnects > MAX_IDLE_STREAM_RECONNECTS) return;
        await delay(idleReconnectDelayMs(idleReconnects), context.signal);
        if (context.signal?.aborted) return;
      }
      const url = new URL(relayApiUrl(this.baseUrl, `/threads/${encodeURIComponent(sessionId)}/events`));
      if (after) url.searchParams.set("after", after);
      const response = await this.fetchFn(url, {
        method: "GET",
        signal: context.signal,
        headers: this.headers(false, context.employeeId),
      });
      if (!response.ok) {
        throw new Error(`Relay session stream failed: ${await responseError(response)}`);
      }
      if (!response.body) return;
      let buffer = "";
      let sawEvent = false;
      let reconnect = false;
      let terminal = false;
      const decoder = new TextDecoder();
      const consumeFrame = async (frame: string): Promise<void> => {
        const parsed = parseSseFrame(frame);
        if (parsed.event) {
          sawEvent = true;
          after = parsed.event.id;
          await onEvent(parsed.event);
        }
        if (parsed.done) {
          terminal = isTerminalSessionStatus(parsed.done.status);
          reconnect = !terminal;
        }
      };
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? "";
        for (const frame of frames) await consumeFrame(frame);
      }
      buffer += decoder.decode();
      if (buffer.trim()) await consumeFrame(buffer);
      if (terminal || (!reconnect && !sawEvent)) return;
      // A timeout control frame or an EOF after domain events is resumable.
      // The cursor prevents duplicate delivery across reconnects.
      idleReconnects = sawEvent ? 0 : idleReconnects + 1;
    }
  }

  async resolveConversationSession(ref: ChatConversationRef, signal?: AbortSignal): Promise<RelaySession | undefined> {
    return (await this.resolveConversationBinding(ref, signal))?.session;
  }

  async resolveConversationBinding(ref: ChatConversationRef, signal?: AbortSignal): Promise<ChatConversationBinding | undefined> {
    const body = await this.request<{ session?: RelaySession | null; mapping?: { providerMessageId?: string } | null }>("/internal/chat/conversation/session", {
      method: "POST",
      signal,
      body: conversationBody(ref),
    });
    if (!body.session && !body.mapping) return undefined;
    return {
      session: body.session ?? undefined,
      providerMessageId: body.mapping?.providerMessageId,
    };
  }

  async bindConversationSession(ref: ChatConversationRef, sessionId: string, signal?: AbortSignal): Promise<void> {
    await this.request<{ mapping?: unknown }>("/internal/chat/conversation/mapping", {
      method: "POST",
      signal,
      body: { ...conversationBody(ref), sessionId },
    });
  }

  async listConversationSessions(ref: ChatConversationRef, signal?: AbortSignal): Promise<RelaySession[]> {
    const body = await this.request<{ sessions?: RelaySession[] }>("/internal/chat/conversation/sessions", {
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
    const response = await this.fetchFn(relayApiUrl(this.baseUrl, pathname), {
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

const MAX_IDLE_STREAM_RECONNECTS = 5;
const IDLE_STREAM_RECONNECT_BASE_MS = 250;
const IDLE_STREAM_RECONNECT_MAX_MS = 5_000;

/** Exponential backoff for reconnects that returned no domain event. */
export function idleReconnectDelayMs(attempt: number): number {
  return Math.min(IDLE_STREAM_RECONNECT_BASE_MS * 2 ** (attempt - 1), IDLE_STREAM_RECONNECT_MAX_MS);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function parseSseRelayEvent(frame: string): RelayEvent | undefined {
  return parseSseFrame(frame).event;
}

function parseSseFrame(frame: string): { event?: RelayEvent; done?: { status?: string; reason?: string } } {
  const eventName = frame
    .split(/\r?\n/)
    .find((line) => line.startsWith("event:"))
    ?.slice(6)
    .trim();
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data) return {};
  // One malformed frame must not tear down a live session stream.
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    return {};
  }
  if (isRelayEvent(parsed)) return { event: parsed };
  if (eventName === "done" && typeof parsed === "object" && parsed !== null) {
    const control = parsed as { status?: unknown; reason?: unknown };
    return {
      done: {
        ...(typeof control.status === "string" ? { status: control.status } : {}),
        ...(typeof control.reason === "string" ? { reason: control.reason } : {}),
      },
    };
  }
  return {};
}

function isTerminalSessionStatus(status: string | undefined): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
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
