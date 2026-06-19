import type { ChatConversationRef, ChatIdentity, ChatIdentityResolver, ChatProvider } from "./types.js";
import { normalizeBaseUrl } from "./relay-client.js";

export interface StaticChatIdentityRecord extends ChatIdentity {
  provider: ChatProvider;
  externalUserId: string;
  tenantId?: string;
}

export class StaticChatIdentityResolver implements ChatIdentityResolver {
  private readonly records: StaticChatIdentityRecord[];

  constructor(records: StaticChatIdentityRecord[]) {
    this.records = records;
  }

  async resolve(ref: ChatConversationRef): Promise<ChatIdentity | undefined> {
    const record = this.records.find((candidate) =>
      candidate.provider === ref.provider
      && candidate.externalUserId === ref.externalUserId
      && (!candidate.tenantId || candidate.tenantId === ref.tenantId)
    );
    if (!record) return undefined;
    const { provider: _provider, externalUserId: _externalUserId, tenantId: _tenantId, ...identity } = record;
    return identity;
  }
}

export interface RelayChatIdentityResolverOptions {
  baseUrl?: string;
  token?: string;
  fetchFn?: typeof fetch;
}

export class RelayChatIdentityResolver implements ChatIdentityResolver {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: RelayChatIdentityResolverOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.RELAY_BACKEND_URL ?? "http://127.0.0.1:8790");
    this.token = options.token ?? process.env.RELAY_CHAT_TOKEN;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async resolve(ref: ChatConversationRef): Promise<ChatIdentity | undefined> {
    const response = await this.fetchFn(`${this.baseUrl}/chat/identity/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({
        provider: ref.provider,
        tenantId: ref.tenantId,
        externalUserId: ref.externalUserId,
        conversationId: ref.conversationId,
        threadId: ref.threadId,
      }),
    });
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new Error(`Relay chat identity resolution failed: ${await responseError(response)}`);
    }
    const body = await response.json() as { identity?: ChatIdentity };
    return body.identity;
  }
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
