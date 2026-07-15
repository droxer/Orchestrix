import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "node:test";

import {
  handleDiscordInteraction,
  handleLarkEvent,
  handleTelegramWebhook,
  MemoryProviderEventStore,
  configureRelayChatProviders,
  type ChatAgentRequest,
  type ChatRun,
  type ChatSessionSink,
} from "../src/index.js";
import type { RelaySession } from "relay-core";

describe("provider webhook handlers", () => {
  it("isolates event claims by integration and tracks release and completion", async () => {
    const store = new MemoryProviderEventStore();
    assert.equal(await store.claim("telegram:bot-a", "1"), true);
    assert.equal(await store.claim("telegram:bot-b", "1"), true);
    assert.equal(await store.claim("telegram:bot-a", "1"), false);
    await store.release("telegram:bot-a", "1");
    assert.equal(await store.claim("telegram:bot-a", "1"), true);
    await store.complete("telegram:bot-a", "1");
    assert.equal(await store.claim("telegram:bot-a", "1"), false);
  });

  it("configures Telegram delivery and Discord slash commands from active backend settings", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/chat/integrations/runtime")) {
        return jsonResponse({ integrations: [
          { id: "tg", provider: "telegram", config: {}, secrets: { botToken: "tg-token", webhookSecret: "hook" } },
          { id: "dc", provider: "discord", config: { applicationId: "app", publicKey: "a".repeat(64) }, secrets: { botToken: "dc-token" } },
        ] });
      }
      return jsonResponse({ ok: true });
    };

    await configureRelayChatProviders({
      backendUrl: "http://relay.local",
      chatToken: "chat-token",
      eventStorePath: "/tmp/unused-events",
      fetchFn,
    }, "https://relay.example/chat/");

    assert.ok(calls.some((call) => call.url.endsWith("/bottg-token/setWebhook")));
    assert.ok(calls.some((call) => call.url.endsWith("/applications/app/commands") && call.init?.method === "PUT"));
  });

  it("rejects Telegram's HTTP-200 setup error envelope", async () => {
    await assert.rejects(() => configureRelayChatProviders({
      backendUrl: "http://relay.local",
      chatToken: "chat-token",
      eventStorePath: "/tmp/unused-events",
      fetchFn: async (url) => String(url).endsWith("/chat/integrations/runtime")
        ? jsonResponse({ integrations: [{ id: "tg", provider: "telegram", config: {}, secrets: { botToken: "token", webhookSecret: "hook" } }] })
        : jsonResponse({ ok: false, description: "invalid webhook" }),
    }, "https://relay.example"), /could not be configured/);
  });

  it("verifies and dispatches a Telegram webhook", async () => {
    const requests: ChatAgentRequest[] = [];
    const calls: string[] = [];
    const response = await handleTelegramWebhook({
      rawBody: JSON.stringify({
        update_id: 1,
        message: { message_id: 7, message_thread_id: 3, text: "/relay run --agent agent_builder ship it", from: { id: 42 }, chat: { id: -100 } },
      }),
      secretHeader: "webhook-secret",
    }, fakeGateway(requests), {
      integrationId: "tg",
      botToken: "bot-token",
      webhookSecret: "webhook-secret",
      eventStore: new MemoryProviderEventStore(),
      fetchFn: async (url) => {
        calls.push(String(url));
        return jsonResponse({ ok: true, result: { message_id: 91 } });
      },
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests[0].agentId, "agent_builder");
    assert.equal(requests[0].messageId, "91");
    assert.ok(calls.some((url) => url.endsWith("/sendMessage")));
  });

  it("rejects a Telegram webhook with the wrong secret", async () => {
    const response = await handleTelegramWebhook({ rawBody: "{}", secretHeader: "wrong" }, fakeGateway([]), {
      integrationId: "tg",
      botToken: "bot-token",
      webhookSecret: "expected",
      eventStore: new MemoryProviderEventStore(),
    });
    assert.equal(response.status, 401);
  });

  it("verifies Discord's Ed25519 signature before acknowledging interactions", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const rawBody = JSON.stringify({ type: 1 });
    const timestamp = "1700000000";
    const signature = sign(null, Buffer.from(timestamp + rawBody), privateKey).toString("hex");
    const publicKeyHex = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");

    const accepted = await handleDiscordInteraction({ rawBody, timestamp, signature }, fakeGateway([]), {
      integrationId: "dc",
      applicationId: "app",
      publicKey: publicKeyHex,
      eventStore: new MemoryProviderEventStore(),
    });
    const rejected = await handleDiscordInteraction({ rawBody, timestamp, signature: "00" }, fakeGateway([]), {
      integrationId: "dc",
      applicationId: "app",
      publicKey: publicKeyHex,
      eventStore: new MemoryProviderEventStore(),
    });

    assert.deepEqual(accepted, { status: 200, body: { type: 1 } });
    assert.equal(rejected.status, 401);
  });

  it("dispatches Discord slash-command options to the named agent", async () => {
    const requests: ChatAgentRequest[] = [];
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const rawBody = JSON.stringify({
      type: 2,
      id: "interaction-1",
      application_id: "app",
      token: "interaction-token",
      guild_id: "guild",
      channel_id: "channel",
      member: { user: { id: "user" } },
      data: {
        name: "relay",
        options: [{ name: "run", options: [
          { name: "agent", value: "agent_builder" },
          { name: "mode", value: "action" },
          { name: "prompt", value: "ship it" },
        ] }],
      },
    });
    const timestamp = "1700000000";
    const signature = sign(null, Buffer.from(timestamp + rawBody), privateKey).toString("hex");
    const publicKeyHex = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");

    const response = await handleDiscordInteraction({ rawBody, timestamp, signature }, fakeGateway(requests), {
      integrationId: "dc",
      applicationId: "app",
      publicKey: publicKeyHex,
      eventStore: new MemoryProviderEventStore(),
      fetchFn: async () => jsonResponse({ id: "@original" }),
    });

    assert.deepEqual(response, { status: 200, body: { type: 5 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests[0].agentId, "agent_builder");
    assert.equal(requests[0].taskGoal, "ship it");
    assert.equal(requests[0].messageId, "@original");
  });

  it("verifies and dispatches a Lark message event", async () => {
    const requests: ChatAgentRequest[] = [];
    const rawBody = JSON.stringify({
      header: { event_id: "event-1", event_type: "im.message.receive_v1", tenant_key: "tenant", token: "verify" },
      event: {
        sender: { sender_id: { open_id: "ou_1", union_id: "on_1" } },
        message: { chat_id: "oc_1", message_id: "om_1", content: JSON.stringify({ text: "/relay run --agent agent_builder ship it" }) },
      },
    });
    const timestamp = "1700000000";
    const nonce = "nonce";
    const signature = createHash("sha256").update(timestamp + nonce + "encrypt-key" + rawBody).digest("hex");

    const response = await handleLarkEvent({ rawBody, timestamp, nonce, signature }, fakeGateway(requests), {
      integrationId: "lark",
      appId: "app-id",
      appSecret: "app-secret",
      verificationToken: "verify",
      encryptKey: "encrypt-key",
      eventStore: new MemoryProviderEventStore(),
      fetchFn: async (url) => String(url).includes("tenant_access_token")
        ? jsonResponse({ code: 0, tenant_access_token: "tenant-token" })
        : jsonResponse({ code: 0, data: { message_id: "om_reply" } }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests[0].externalUserId, "on_1");
    assert.equal(requests[0].messageId, "om_reply");
  });
});

function fakeGateway(requests: ChatAgentRequest[]) {
  return {
    async run(request: ChatAgentRequest, sink: ChatSessionSink = {}): Promise<ChatRun> {
      requests.push(request);
      const session = makeSession("running");
      await sink.started?.({ session, conversation: request, recovery: "persisted" });
      await sink.completed?.(makeSession("completed"));
      return { session, conversation: request, recovery: "persisted" };
    },
    async status() { return makeSession("completed"); },
    async cancel() { return makeSession("cancelled"); },
    async listConversations() { return []; },
    async switchConversation() {},
  };
}

function makeSession(status: RelaySession["status"]): RelaySession {
  return {
    id: "sess_1", workspacePath: "/workspace", taskGoal: "ship it", participants: ["human", "codex"],
    status, phase: "running", createdAt: "now", updatedAt: "now", agentRuns: [], artifacts: [], decisions: [], events: [],
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}
