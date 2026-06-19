import type { ChatConversationRef } from "../types.js";

export interface LarkConversationInput {
  openId: string;
  chatId: string;
  tenantKey?: string;
  unionId?: string;
  threadId?: string;
  rootId?: string;
  messageId?: string;
}

export function larkConversation(input: LarkConversationInput): ChatConversationRef {
  return {
    provider: "lark",
    externalUserId: input.unionId ?? input.openId,
    conversationId: input.chatId,
    threadId: input.threadId ?? input.rootId,
    messageId: input.messageId,
    tenantId: input.tenantKey,
  };
}
