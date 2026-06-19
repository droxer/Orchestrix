import type { ChatConversationRef } from "../types.js";

export interface DiscordConversationInput {
  userId: string;
  channelId: string;
  guildId?: string;
  threadId?: string;
  messageId?: string;
}

export function discordConversation(input: DiscordConversationInput): ChatConversationRef {
  return {
    provider: "discord",
    externalUserId: input.userId,
    conversationId: input.channelId,
    threadId: input.threadId,
    messageId: input.messageId,
    tenantId: input.guildId,
  };
}
