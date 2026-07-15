import type { ChatConversationRef } from "../types.js";
import { createPublicKey, verify } from "node:crypto";
import { dispatchProviderCommand, retryProviderDispatch, type ChatCommandGateway, type ProviderEventStore, type ProviderHttpResponse } from "./runtime.js";

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

export interface DiscordInteractionInput {
  rawBody: string;
  timestamp?: string;
  signature?: string;
}

export interface DiscordInteractionOptions {
  integrationId: string;
  applicationId: string;
  publicKey: string;
  eventStore: ProviderEventStore;
  fetchFn?: typeof fetch;
}

export async function handleDiscordInteraction(
  input: DiscordInteractionInput,
  gateway: ChatCommandGateway,
  options: DiscordInteractionOptions,
): Promise<ProviderHttpResponse> {
  if (!validDiscordSignature(input, options.publicKey)) return { status: 401 };
  let interaction: any;
  try {
    interaction = JSON.parse(input.rawBody);
  } catch {
    return { status: 400 };
  }
  if (interaction.type === 1) return { status: 200, body: { type: 1 } };
  if (interaction.type !== 2 || interaction.data?.name !== "relay") return { status: 400 };
  const userId = interaction.member?.user?.id ?? interaction.user?.id;
  if (!interaction.id || !userId || !interaction.channel_id || !interaction.token) return { status: 400 };
  const eventId = String(interaction.id);
  const namespace = `discord:${options.integrationId}`;
  if (!await options.eventStore.claim(namespace, eventId)) return { status: 200, body: { type: 5 } };
  const ref = discordConversation({
    userId,
    guildId: interaction.guild_id,
    channelId: interaction.channel_id,
    messageId: "@original",
  });
  const fetchFn = options.fetchFn ?? fetch;
  const edit = async (_messageId: string, text: string) => {
    const response = await fetchFn(
      `https://discord.com/api/v10/webhooks/${options.applicationId}/${interaction.token}/messages/@original`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text.slice(0, 2_000), allowed_mentions: { parse: [] } }),
      },
    );
    if (!response.ok) throw new Error("Discord response update failed.");
  };
  setTimeout(() => {
    retryProviderDispatch(
      "Discord interaction",
      () => dispatchProviderCommand(ref, discordCommandText(interaction.data), gateway, {
        send: async (text) => { await edit("@original", text); return "@original"; },
        edit,
      }),
      options.eventStore,
      namespace,
      eventId,
    );
  }, 0);
  return { status: 200, body: { type: 5 } };
}

function validDiscordSignature(input: DiscordInteractionInput, publicKeyHex: string): boolean {
  if (!input.timestamp || !input.signature || !/^[0-9a-f]{64}$/i.test(publicKeyHex)) return false;
  try {
    const prefix = Buffer.from("302a300506032b6570032100", "hex");
    const key = createPublicKey({ key: Buffer.concat([prefix, Buffer.from(publicKeyHex, "hex")]), format: "der", type: "spki" });
    return verify(null, Buffer.from(input.timestamp + input.rawBody), key, Buffer.from(input.signature, "hex"));
  } catch {
    return false;
  }
}

function discordCommandText(data: any): string {
  const top = Array.isArray(data?.options) ? data.options[0] : undefined;
  const action = top?.name ?? "";
  const options = Array.isArray(top?.options) ? top.options : [];
  const values = new Map(options.map((option: any) => [option.name, String(option.value)]));
  const parts = ["/relay", action];
  if (action === "status" || action === "cancel" || action === "switch") {
    const session = values.get("session");
    if (session) parts.push(JSON.stringify(session));
    if (action === "cancel" && values.get("reason")) parts.push(JSON.stringify(values.get("reason")));
    return parts.join(" ");
  }
  for (const name of ["agent", "mode"]) {
    const value = values.get(name);
    if (value) parts.push(`--${name}`, JSON.stringify(value));
  }
  const session = values.get("session");
  if (session) parts.push("--session", JSON.stringify(session));
  const prompt = values.get("prompt");
  if (prompt) parts.push(JSON.stringify(prompt));
  return parts.join(" ");
}
