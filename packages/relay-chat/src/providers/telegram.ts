import type { ChatConversationRef } from "../types.js";

export interface TelegramConversationInput {
  userId: string | number;
  chatId: string | number;
  messageThreadId?: string | number;
  messageId?: string | number;
}

export function telegramConversation(input: TelegramConversationInput): ChatConversationRef {
  return {
    provider: "telegram",
    externalUserId: String(input.userId),
    conversationId: String(input.chatId),
    threadId: input.messageThreadId === undefined ? undefined : String(input.messageThreadId),
    messageId: input.messageId === undefined ? undefined : String(input.messageId),
  };
}
