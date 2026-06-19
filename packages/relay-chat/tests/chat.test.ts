import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RelayChatClient,
  RelayChatGateway,
  RelayChatIdentityResolver,
  StaticChatIdentityResolver,
  commandToAgentRequest,
  discordConversation,
  larkConversation,
  parseChatCommand,
  parseSseRelayEvent,
  telegramConversation,
  type RelayChatBackend,
} from "../src/index.js";
import type { RelayEvent, RelaySession } from "relay-core";

describe("relay-chat command parsing", () => {
  it("parses a provider-neutral run command", () => {
    const command = parseChatCommand('/relay run --agent=claude --mode=review --sandbox sbx_alice "review auth flow"');
    assert.deepEqual(command, {
      kind: "run",
      agent: "claude",
      mode: "review",
      sandboxId: "sbx_alice",
      sessionId: undefined,
      taskGoal: "review auth flow",
    });
  });

  it("turns parsed run command into a chat request", () => {
    const ref = discordConversation({ userId: "u1", channelId: "c1", guildId: "g1" });
    const command = parseChatCommand("/relay run --agent codex implement the chat gateway");
    assert.ok(command);
    const request = commandToAgentRequest(ref, command);
    assert.equal(request?.provider, "discord");
    assert.equal(request?.externalUserId, "u1");
    assert.equal(request?.agent, "codex");
    assert.equal(request?.taskGoal, "implement the chat gateway");
  });
});

describe("provider conversation mapping", () => {
  it("normalizes Discord, Telegram, and Lark IDs without leaking provider names into Relay fields", () => {
    assert.deepEqual(discordConversation({ userId: "du", channelId: "dc", threadId: "dt" }), {
      provider: "discord",
      externalUserId: "du",
      conversationId: "dc",
      threadId: "dt",
      messageId: undefined,
      tenantId: undefined,
    });
    assert.deepEqual(telegramConversation({ userId: 42, chatId: -100, messageThreadId: 7 }), {
      provider: "telegram",
      externalUserId: "42",
      conversationId: "-100",
      threadId: "7",
      messageId: undefined,
    });
    assert.deepEqual(larkConversation({ openId: "ou_1", unionId: "on_1", chatId: "oc_1", rootId: "om_root" }), {
      provider: "lark",
      externalUserId: "on_1",
      conversationId: "oc_1",
      threadId: "om_root",
      messageId: undefined,
      tenantId: undefined,
    });
  });
});

describe("RelayChatClient", () => {
  it("starts sandbox runs through the backend and keeps Relay as the authorization boundary", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({
        id: "sess_1",
        status: "running",
        events: [],
      });
    };
    const client = new RelayChatClient({ baseUrl: "http://relay.local/", token: "svc", fetchFn });
    await client.startSandboxRun({
      sandboxId: "sbx_alice",
      employeeId: "alice",
      taskGoal: "build it",
      assignments: [{ agent: "codex", mode: "implement" }],
    });
    assert.equal(calls[0].url, "http://relay.local/sandboxes/sbx_alice/runs");
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer svc");
    assert.equal((calls[0].init.headers as Record<string, string>)["X-Relay-Employee-Id"], "alice");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      taskGoal: "build it",
      assignments: [{ agent: "codex", mode: "implement" }],
    });
  });

  it("passes chat employee identity on session reads and streams", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/events")) {
        return new Response("", { status: 200 });
      }
      return jsonResponse(makeSession("running"));
    };
    const client = new RelayChatClient({ baseUrl: "http://relay.local/", token: "svc", fetchFn });

    await client.getSession("sess_1", { employeeId: "alice" });
    await client.streamSessionEvents("sess_1", () => {}, { employeeId: "alice" });

    assert.equal(calls[0].url, "http://relay.local/sessions/sess_1");
    assert.equal((calls[0].init.headers as Record<string, string>)["X-Relay-Employee-Id"], "alice");
    assert.equal(calls[1].url, "http://relay.local/sessions/sess_1/events");
    assert.equal((calls[1].init.headers as Record<string, string>)["X-Relay-Employee-Id"], "alice");
  });

  it("parses only Relay domain events from SSE frames", () => {
    const event = parseSseRelayEvent('data: {"id":"evt_1","type":"agent.output","sessionId":"sess_1","timestamp":"now","runId":"run_1","agent":"codex","stream":"stdout","text":"hello"}\n\n');
    assert.equal(event?.type, "agent.output");
    assert.equal(parseSseRelayEvent('event: done\ndata: {"status":"completed"}\n\n'), undefined);
  });
});

describe("RelayChatIdentityResolver", () => {
  it("resolves identities through backend-managed chat configuration", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({
        identity: {
          employeeId: "alice",
          displayName: "Alice",
          defaultSandboxId: "sbx_alice",
        },
      });
    };
    const resolver = new RelayChatIdentityResolver({ baseUrl: "http://relay.local/", token: "svc", fetchFn });

    const identity = await resolver.resolve(discordConversation({
      userId: "du",
      guildId: "g1",
      channelId: "c1",
      threadId: "t1",
    }));

    assert.equal(identity?.employeeId, "alice");
    assert.equal(calls[0].url, "http://relay.local/chat/identity/resolve");
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer svc");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      provider: "discord",
      tenantId: "g1",
      externalUserId: "du",
      conversationId: "c1",
      threadId: "t1",
    });
  });

  it("returns undefined for unlinked or disallowed chat users", async () => {
    const resolver = new RelayChatIdentityResolver({
      baseUrl: "http://relay.local",
      token: "svc",
      fetchFn: async () => new Response(JSON.stringify({ detail: "No link" }), { status: 404 }),
    });

    const identity = await resolver.resolve(telegramConversation({ userId: 42, chatId: -100 }));

    assert.equal(identity, undefined);
  });
});

describe("RelayChatGateway", () => {
  it("resolves chat identity and sandbox before invoking Relay backend", async () => {
    const events: RelayEvent[] = [];
    const backend: RelayChatBackend = {
      async startSandboxRun(input) {
        assert.equal(input.sandboxId, "sbx_alice");
        assert.equal(input.employeeId, "alice");
        return makeSession("running");
      },
      async cancelSandboxRun() {
        return makeSession("cancelled");
      },
      async getSession(_sessionId, context) {
        assert.equal(context?.employeeId, "alice");
        return makeSession("completed");
      },
      async streamSessionEvents(_sessionId, onEvent, context) {
        assert.equal(context?.employeeId, "alice");
        const event = makeOutputEvent();
        events.push(event);
        await onEvent(event);
      },
    };
    const identities = new StaticChatIdentityResolver([
      { provider: "telegram", externalUserId: "42", employeeId: "alice", defaultSandboxId: "sbx_alice" },
    ]);
    const gateway = new RelayChatGateway({ backend, identities });
    const seen: RelayEvent[] = [];
    const run = await gateway.run({
      ...telegramConversation({ userId: 42, chatId: 42 }),
      agent: "codex",
      mode: "implement",
      taskGoal: "ship chat support",
    }, {
      event: (update) => {
        seen.push(update.event);
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(run.session.id, "sess_1");
    assert.equal(events.length, 1);
    assert.equal(seen[0].type, "agent.output");
  });

  it("passes identity context when checking status", async () => {
    const backend: RelayChatBackend = {
      async startSandboxRun() {
        return makeSession("running");
      },
      async cancelSandboxRun() {
        return makeSession("cancelled");
      },
      async getSession(_sessionId, context) {
        assert.equal(context?.employeeId, "alice");
        return makeSession("completed");
      },
      async streamSessionEvents() {},
    };
    const identities = new StaticChatIdentityResolver([
      { provider: "discord", externalUserId: "u1", employeeId: "alice", defaultSandboxId: "sbx_alice" },
    ]);
    const gateway = new RelayChatGateway({ backend, identities });

    const session = await gateway.status({
      ...discordConversation({ userId: "u1", channelId: "c1" }),
      sessionId: "sess_1",
    });

    assert.equal(session.status, "completed");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeSession(status: RelaySession["status"]): RelaySession {
  return {
    id: "sess_1",
    workspacePath: "/workspace",
    taskGoal: "ship chat support",
    participants: ["human", "codex"],
    status,
    phase: "running",
    createdAt: "now",
    updatedAt: "now",
    agentRuns: [],
    artifacts: [],
    decisions: [],
    events: [],
  };
}

function makeOutputEvent(): RelayEvent {
  return {
    id: "evt_1",
    type: "agent.output",
    sessionId: "sess_1",
    timestamp: "now",
    runId: "run_1",
    agent: "codex",
    stream: "stdout",
    text: "hello",
  };
}
