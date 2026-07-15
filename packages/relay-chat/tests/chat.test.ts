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
    const command = parseChatCommand('/relay run --agent=agent_reviewer --mode=review "review auth flow"');
    assert.deepEqual(command, {
      kind: "run",
      agentId: "agent_reviewer",
      mode: "review",
      sessionId: undefined,
      taskGoal: "review auth flow",
    });
  });

  it("parses ask mode for read-only chat collaboration", () => {
    const command = parseChatCommand("/relay run --agent agent_builder --mode ask explain the failing tests");
    assert.deepEqual(command, {
      kind: "run",
      agentId: "agent_builder",
      mode: "ask",
      sessionId: undefined,
      taskGoal: "explain the failing tests",
    });
  });

  it("turns parsed run command into a chat request", () => {
    const ref = discordConversation({ userId: "u1", channelId: "c1", guildId: "g1" });
    const command = parseChatCommand("/relay run --agent agent_builder implement the chat gateway");
    assert.ok(command);
    const request = commandToAgentRequest(ref, command);
    assert.equal(request?.provider, "discord");
    assert.equal(request?.externalUserId, "u1");
    assert.equal(request?.agentId, "agent_builder");
    assert.equal(request?.taskGoal, "implement the chat gateway");
  });

  it("parses new, list, and switch conversation commands", () => {
    assert.deepEqual(parseChatCommand('/relay new --agent agent_builder "second task"'), {
      kind: "new",
      agentId: "agent_builder",
      mode: "action",
      taskGoal: "second task",
    });
    assert.deepEqual(parseChatCommand("/relay list"), { kind: "list" });
    assert.deepEqual(parseChatCommand("/relay switch ses_42"), { kind: "switch", sessionId: "ses_42" });
    assert.equal(parseChatCommand("/relay switch"), undefined);
  });

  it("rejects sandbox routing and invalid modes", () => {
    assert.equal(parseChatCommand("/relay run --sandbox sbx_alice do work"), undefined);
    assert.equal(parseChatCommand("/relay run --mode revieew do work"), undefined);
  });

  it("marks a new command as forcing a fresh conversation", () => {
    const ref = discordConversation({ userId: "u1", channelId: "c1" });
    const command = parseChatCommand("/relay new start fresh");
    assert.ok(command);
    const request = commandToAgentRequest(ref, command);
    assert.equal(request?.forceNew, true);
    assert.equal(request?.taskGoal, "start fresh");
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
  it("starts named-agent runs through the backend authorization boundary", async () => {
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
    await client.startAgentRun({
      agentId: "agent_builder",
      employeeId: "alice",
      taskGoal: "build it",
      mode: "action",
    });
    assert.equal(calls[0].url, "http://relay.local/agent-runs");
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer svc");
    assert.equal((calls[0].init.headers as Record<string, string>)["X-Relay-Employee-Id"], "alice");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      taskGoal: "build it",
      assignments: [{ agentId: "agent_builder", mode: "action" }],
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
  it("dispatches chat work through the employee's logical agent", async () => {
    let selectedAgentId = "";
    const backend: RelayChatBackend = {
      async listEmployeeAgents(employeeId) {
        assert.equal(employeeId, "alice");
        return [{ id: "agent_builder", executorKind: "codex", availability: "ready" }];
      },
      async startAgentRun(input) {
        selectedAgentId = input.agentId;
        assert.equal(input.employeeId, "alice");
        return makeSession("running");
      },
      async getSession() {
        return makeSession("completed");
      },
      async streamSessionEvents() {},
    };
    const identities = new StaticChatIdentityResolver([
      { provider: "telegram", externalUserId: "42", employeeId: "alice" },
    ]);
    const gateway = new RelayChatGateway({ backend, identities });

    await gateway.run({
      ...telegramConversation({ userId: 42, chatId: 42 }),
      agentId: "agent_builder",
      mode: "action",
      taskGoal: "ship chat support",
    });

    assert.equal(selectedAgentId, "agent_builder");
  });

  it("does not use a default agent whose executor differs from the requested agent", async () => {
    let selectedAgentId = "";
    const backend: RelayChatBackend = {
      async listEmployeeAgents() {
        return [
          { id: "agent_writer", executorKind: "claude", availability: "ready" },
          { id: "agent_builder", executorKind: "codex", availability: "ready" },
        ];
      },
      async startAgentRun(input) { selectedAgentId = input.agentId; return makeSession("running"); },
      async getSession() { return makeSession("completed"); },
      async streamSessionEvents() {},
    };
    const identities = new StaticChatIdentityResolver([
      { provider: "telegram", externalUserId: "42", employeeId: "alice", defaultAgentId: "agent_writer" },
    ]);
    await new RelayChatGateway({ backend, identities }).run({
      ...telegramConversation({ userId: 42, chatId: 42 }),
      agentId: "agent_builder",
      mode: "action",
      taskGoal: "build it",
    });
    assert.equal(selectedAgentId, "agent_builder");
  });

  it("resolves chat identity and agent before invoking Relay backend", async () => {
    const events: RelayEvent[] = [];
    const backend: RelayChatBackend = {
      async listEmployeeAgents() { return [{ id: "agent_builder", executorKind: "codex", availability: "ready" }]; },
      async startAgentRun(input) {
        assert.equal(input.agentId, "agent_builder");
        assert.equal(input.employeeId, "alice");
        return makeSession("running");
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
      { provider: "telegram", externalUserId: "42", employeeId: "alice", defaultAgentId: "agent_builder" },
    ]);
    const gateway = new RelayChatGateway({ backend, identities });
    const seen: RelayEvent[] = [];
    const run = await gateway.run({
      ...telegramConversation({ userId: 42, chatId: 42 }),
      agentId: "agent_builder",
      mode: "action",
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
      async getSession(_sessionId, context) {
        assert.equal(context?.employeeId, "alice");
        return makeSession("completed");
      },
      async streamSessionEvents() {},
    };
    const identities = new StaticChatIdentityResolver([
      { provider: "discord", externalUserId: "u1", employeeId: "alice" },
    ]);
    const gateway = new RelayChatGateway({ backend, identities });

    const session = await gateway.status({
      ...discordConversation({ userId: "u1", channelId: "c1" }),
      sessionId: "sess_1",
    });

    assert.equal(session.status, "completed");
  });

  it("continues the thread's bound session and re-binds after the run", async () => {
    const calls: { resolved: number; boundTo: string[]; ranWith: (string | undefined)[] } = {
      resolved: 0,
      boundTo: [],
      ranWith: [],
    };
    const backend: RelayChatBackend = {
      async listEmployeeAgents() { return [{ id: "agent_builder", executorKind: "codex", availability: "ready" }]; },
      async startAgentRun(input) {
        calls.ranWith.push(input.sessionId);
        return makeSession("running");
      },
      async getSession() {
        return makeSession("completed");
      },
      async streamSessionEvents() {},
      async resolveConversationSession() {
        calls.resolved += 1;
        return makeSession("running"); // bound to sess_1
      },
      async bindConversationSession(_ref, sessionId) {
        calls.boundTo.push(sessionId);
      },
    };
    const identities = new StaticChatIdentityResolver([
      { provider: "discord", externalUserId: "u1", employeeId: "alice", defaultAgentId: "agent_builder" },
    ]);
    const gateway = new RelayChatGateway({ backend, identities });

    await gateway.run({
      ...discordConversation({ userId: "u1", channelId: "c1" }),
      agentId: "agent_builder",
      mode: "action",
      taskGoal: "follow up",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Resolved the existing binding, ran against it, and re-bound the result.
    assert.equal(calls.resolved, 1);
    assert.deepEqual(calls.ranWith, ["sess_1"]);
    assert.deepEqual(calls.boundTo, ["sess_1"]);
  });

  it("reports degraded recovery while keeping a started run alive", async () => {
    const seen: RelayEvent[] = [];
    let started = 0;
    let failed = 0;
    let degraded = 0;
    const backend: RelayChatBackend = {
      async listEmployeeAgents() { return [{ id: "agent_builder", executorKind: "codex", availability: "ready" }]; },
      async startAgentRun() {
        return makeSession("running");
      },
      async getSession() {
        return makeSession("completed");
      },
      async streamSessionEvents(_sessionId, onEvent) {
        await onEvent(makeOutputEvent());
      },
      async bindConversationSession() {
        throw new Error("mapping write failed");
      },
    };
    const identities = new StaticChatIdentityResolver([
      { provider: "discord", externalUserId: "u1", employeeId: "alice", defaultAgentId: "agent_builder" },
    ]);
    const gateway = new RelayChatGateway({ backend, identities });

    const run = await gateway.run({
      ...discordConversation({ userId: "u1", channelId: "c1" }),
      agentId: "agent_builder",
      mode: "action",
      taskGoal: "continue anyway",
    }, {
      started: () => {
        started += 1;
      },
      failed: () => {
        failed += 1;
      },
      degraded: () => {
        degraded += 1;
      },
      event: (update) => {
        seen.push(update.event);
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(run.session.id, "sess_1");
    assert.equal(started, 1);
    assert.equal(failed, 0);
    assert.equal(degraded, 1);
    assert.equal(seen[0].type, "agent.output");
  });

  it("skips the existing binding when forceNew is set", async () => {
    let resolved = 0;
    const ranWith: (string | undefined)[] = [];
    const backend: RelayChatBackend = {
      async listEmployeeAgents() { return [{ id: "agent_builder", executorKind: "codex", availability: "ready" }]; },
      async startAgentRun(input) {
        ranWith.push(input.sessionId);
        return makeSession("running");
      },
      async getSession() {
        return makeSession("completed");
      },
      async streamSessionEvents() {},
      async resolveConversationSession() {
        resolved += 1;
        return makeSession("running");
      },
      async bindConversationSession() {},
    };
    const identities = new StaticChatIdentityResolver([
      { provider: "discord", externalUserId: "u1", employeeId: "alice", defaultAgentId: "agent_builder" },
    ]);
    const gateway = new RelayChatGateway({ backend, identities });

    await gateway.run({
      ...discordConversation({ userId: "u1", channelId: "c1" }),
      agentId: "agent_builder",
      mode: "action",
      taskGoal: "fresh start",
      forceNew: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(resolved, 0);
    assert.deepEqual(ranWith, [undefined]);
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
