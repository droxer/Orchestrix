import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  initialAgentState,
  LocalSessionStore,
  relayEvent,
  SessionController,
  type AgentExecutor,
} from "../src/index.js";

function tempStore(): LocalSessionStore {
  return new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-session-memory-")));
}

describe("SessionController prompt memory", () => {
  it("shares same-turn multi-agent output through the full handoff bridge", async () => {
    const store = tempStore();
    const commands: string[] = [];
    const execStream: AgentExecutor = async (_cmd, args) => {
      commands.push(args?.[1] ?? "");
      return { exit_code: 0, stdout: "● implementation note", stderr: "" };
    };
    const controller = new SessionController(store, { execStream });
    const session = await controller.createSession("ship it", ["human", "claude", "codex"]);

    let state = initialAgentState("ship it");
    state = await controller.runStep(session.id, state, { agent: "claude", mode: "action" });
    state = await controller.runStep(session.id, state, { agent: "codex", mode: "action" });
    await controller.runStep(session.id, state, { agent: "claude", mode: "action" });

    assert.doesNotMatch(commands[0], /\[Previous from/);
    assert.match(commands[1], /\[Previous from @claude\]\nimplementation note/);
    assert.doesNotMatch(commands[1], /\[Conversation so far\]/);
    assert.match(commands[2], /\[Previous from @claude\]\nimplementation note/);
    assert.match(commands[2], /\[Previous from @codex\]\nimplementation note/);
    assert.doesNotMatch(commands[2], /\[Conversation so far\]/);
  });

  it("passes earlier turns as prior conversation on follow-up runs", async () => {
    const store = tempStore();
    const commands: string[] = [];
    const execStream: AgentExecutor = async (_cmd, args) => {
      commands.push(args?.[1] ?? "");
      return { exit_code: 0, stdout: "● first answer", stderr: "" };
    };
    const controller = new SessionController(store, { execStream });
    const session = await controller.createSession("first question", ["human", "claude", "codex"]);

    await controller.runStep(session.id, initialAgentState("first question"), { agent: "claude", mode: "action" });
    await store.appendEvent(session.id, relayEvent("user.message", session.id, { text: "follow up" }));
    await controller.runStep(session.id, initialAgentState("follow up"), { agent: "codex", mode: "action" });

    assert.match(commands[1], /\[Conversation so far\]\n\n\[User\]\nfirst question/);
    assert.match(commands[1], /\[Assistant @claude\]\nfirst answer/);
    assert.doesNotMatch(commands[1], /\[Previous from @claude\]/);
    assert.match(commands[1], /\[User\]\nfollow up/);
  });

  it("passes recorded handoff notes as prompt context without changing the task goal", async () => {
    const store = tempStore();
    const commands: string[] = [];
    const execStream: AgentExecutor = async (_cmd, args) => {
      commands.push(args?.[1] ?? "");
      return { exit_code: 0, stdout: "● checked it", stderr: "" };
    };
    const controller = new SessionController(store, { execStream });
    const session = await controller.createSession("fix auth", ["human", "claude", "codex"]);

    await controller.handoffSession(
      session.id,
      "codex",
      [{ agent: "codex", mode: "action" }],
      "verify token refresh",
    );
    await controller.runStep(session.id, initialAgentState("fix auth"), { agent: "codex", mode: "action" });

    assert.match(commands[0], /\[Handoff note\]\nverify token refresh/);
    assert.match(commands[0], /\[User\]\nfix auth/);
    assert.doesNotMatch(commands[0], /Handoff note:\nverify token refresh/);
  });

  it("does not reuse an older handoff note after a newer rerun decision", async () => {
    const store = tempStore();
    const commands: string[] = [];
    const execStream: AgentExecutor = async (_cmd, args) => {
      commands.push(args?.[1] ?? "");
      return { exit_code: 0, stdout: "● checked it", stderr: "" };
    };
    const controller = new SessionController(store, { execStream });
    const session = await controller.createSession("fix auth", ["human", "claude", "codex"]);

    await controller.handoffSession(
      session.id,
      "codex",
      [{ agent: "codex", mode: "action" }],
      "verify token refresh",
    );
    await controller.recordDecision(session.id, "rerun", "run it again", "codex");
    await controller.runStep(session.id, initialAgentState("fix auth"), { agent: "codex", mode: "action" });

    assert.doesNotMatch(commands[0], /\[Handoff note\]/);
    assert.doesNotMatch(commands[0], /\[User\]/);
    assert.match(commands[0], /fix auth/);
  });
});
