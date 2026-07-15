import type { ChatConversationRef } from "../types.js";
import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";
import { dispatchProviderCommand, retryProviderDispatch, type ChatCommandGateway, type ProviderEventStore, type ProviderHttpResponse } from "./runtime.js";

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

export interface LarkEventInput {
  rawBody: string;
  timestamp?: string;
  nonce?: string;
  signature?: string;
}

export interface LarkEventOptions {
  integrationId: string;
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey: string;
  eventStore: ProviderEventStore;
  fetchFn?: typeof fetch;
}

export async function handleLarkEvent(
  input: LarkEventInput,
  gateway: ChatCommandGateway,
  options: LarkEventOptions,
): Promise<ProviderHttpResponse> {
  if (!validLarkSignature(input, options.encryptKey)) return { status: 401 };
  let payload: any;
  try {
    const envelope = JSON.parse(input.rawBody);
    payload = envelope.encrypt ? JSON.parse(decryptLarkPayload(envelope.encrypt, options.encryptKey)) : envelope;
  } catch {
    return { status: 400 };
  }
  const token = payload.header?.token ?? payload.token;
  if (!secureEqual(token, options.verificationToken)) return { status: 401 };
  if (payload.type === "url_verification") return { status: 200, body: { challenge: payload.challenge } };
  if (payload.header?.event_type !== "im.message.receive_v1") return { status: 200 };
  let content: any;
  try {
    content = JSON.parse(payload.event?.message?.content ?? "{}");
  } catch {
    return { status: 400 };
  }
  if (typeof content.text !== "string") return { status: 200 };
  if (!payload.header?.event_id) return { status: 400 };
  const eventId = String(payload.header.event_id);
  const namespace = `lark:${options.integrationId}`;
  if (!await options.eventStore.claim(namespace, eventId)) return { status: 200 };
  const event = payload.event;
  const ref = larkConversation({
    openId: event.sender?.sender_id?.open_id,
    unionId: event.sender?.sender_id?.union_id,
    tenantKey: payload.header?.tenant_key,
    chatId: event.message?.chat_id,
    threadId: event.message?.thread_id,
    rootId: event.message?.root_id,
    messageId: event.message?.message_id,
  });
  const fetchFn = options.fetchFn ?? fetch;
  retryProviderDispatch(
    "Lark webhook",
    () => dispatchLarkCommand(ref, content.text, gateway, options, fetchFn),
    options.eventStore,
    namespace,
    eventId,
  );
  return { status: 200 };
}

async function dispatchLarkCommand(
  ref: ChatConversationRef,
  text: string,
  gateway: ChatCommandGateway,
  options: LarkEventOptions,
  fetchFn: typeof fetch,
): Promise<void> {
  const accessToken = await larkAccessToken(fetchFn, options);
  const messenger = {
    send: async (message: string) => {
      const response = await fetchFn("https://open.larksuite.com/open-apis/im/v1/messages?receive_id_type=chat_id", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ receive_id: ref.conversationId, msg_type: "text", content: JSON.stringify({ text: message }) }),
      });
      const body = await response.json() as any;
      if (!response.ok || body?.code !== 0) throw new Error("Lark message send failed.");
      return body?.data?.message_id as string | undefined;
    },
    edit: async (messageId: string, message: string) => {
      const response = await fetchFn(`https://open.larksuite.com/open-apis/im/v1/messages/${messageId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ msg_type: "text", content: JSON.stringify({ text: message }) }),
      });
      const body = await response.json() as any;
      if (!response.ok || body?.code !== 0) throw new Error("Lark message update failed.");
    },
  };
  await dispatchProviderCommand(ref, text, gateway, messenger);
}

async function larkAccessToken(fetchFn: typeof fetch, options: LarkEventOptions): Promise<string> {
  const response = await fetchFn("https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: options.appId, app_secret: options.appSecret }),
  });
  const body = await response.json() as any;
  if (!response.ok || body?.code !== 0 || typeof body.tenant_access_token !== "string") {
    throw new Error("Lark access token request failed.");
  }
  return body.tenant_access_token;
}

function validLarkSignature(input: LarkEventInput, encryptKey: string): boolean {
  if (!input.timestamp || !input.nonce || !input.signature || !encryptKey) return false;
  const expected = createHash("sha256").update(input.timestamp + input.nonce + encryptKey + input.rawBody).digest("hex");
  return secureEqual(input.signature, expected);
}

function decryptLarkPayload(value: string, encryptKey: string): string {
  const encrypted = Buffer.from(value, "base64");
  const key = createHash("sha256").update(encryptKey).digest();
  const decipher = createDecipheriv("aes-256-cbc", key, encrypted.subarray(0, 16));
  return Buffer.concat([decipher.update(encrypted.subarray(16)), decipher.final()]).toString("utf8");
}

function secureEqual(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
