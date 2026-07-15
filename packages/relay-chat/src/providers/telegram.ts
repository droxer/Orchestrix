import type { ChatConversationRef } from "../types.js";
import { timingSafeEqual } from "node:crypto";
import { dispatchProviderCommand, retryProviderDispatch, type ChatCommandGateway, type ProviderEventStore, type ProviderHttpResponse } from "./runtime.js";

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

export interface TelegramWebhookInput {
  rawBody: string;
  secretHeader?: string;
}

export interface TelegramWebhookOptions {
  integrationId: string;
  botToken: string;
  webhookSecret: string;
  eventStore: ProviderEventStore;
  fetchFn?: typeof fetch;
}

export async function handleTelegramWebhook(
  input: TelegramWebhookInput,
  gateway: ChatCommandGateway,
  options: TelegramWebhookOptions,
): Promise<ProviderHttpResponse> {
  if (!secureEqual(input.secretHeader, options.webhookSecret)) return { status: 401 };
  let update: any;
  try {
    update = JSON.parse(input.rawBody);
  } catch {
    return { status: 400 };
  }
  const message = update?.message;
  if (!message?.from?.id || !message?.chat?.id || typeof message.text !== "string") return { status: 200 };
  const eventId = String(update.update_id);
  const namespace = `telegram:${options.integrationId}`;
  if (update.update_id === undefined || !await options.eventStore.claim(namespace, eventId)) return { status: 200 };
  const fetchFn = options.fetchFn ?? fetch;
  const ref = telegramConversation({
    userId: message.from.id,
    chatId: message.chat.id,
    messageThreadId: message.message_thread_id,
    messageId: message.message_id,
  });
  const messenger = {
    send: async (text: string) => {
      const body = await telegramApi(fetchFn, options.botToken, "sendMessage", {
        chat_id: message.chat.id,
        message_thread_id: message.message_thread_id,
        text: limitText(text, 4096),
      });
      return body?.result?.message_id === undefined ? undefined : String(body.result.message_id);
    },
    edit: async (messageId: string, text: string) => {
      await telegramApi(fetchFn, options.botToken, "editMessageText", {
        chat_id: message.chat.id,
        message_id: Number(messageId),
        text: limitText(text, 4096),
      });
    },
  };
  retryProviderDispatch(
    "Telegram webhook",
    () => dispatchProviderCommand(ref, message.text, gateway, messenger),
    options.eventStore,
    namespace,
    eventId,
  );
  return { status: 200 };
}

async function telegramApi(fetchFn: typeof fetch, token: string, method: string, body: unknown): Promise<any> {
  const response = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as any;
  if (!response.ok || payload?.ok !== true) throw new Error(`Telegram ${method} failed.`);
  return payload;
}

function secureEqual(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function limitText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
