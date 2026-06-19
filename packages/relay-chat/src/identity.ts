import type { ChatConversationRef, ChatIdentity, ChatIdentityResolver, ChatProvider } from "./types.js";

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
