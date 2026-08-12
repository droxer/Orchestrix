import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { routeComposerMessage, threadMessageInput } from "../src/lib/messageRouting.js";
import type { MentionCandidate } from "../src/lib/mentions.js";

const activeAgent = { id: "researcher", executorKind: "claude" as const };

describe("composer message routing", () => {
  it("treats @agent text as ordinary input for the selected agent", () => {
    const routed = routeComposerMessage("@pi check this", activeAgent);

    assert.deepEqual(routed, { agentId: "researcher", agent: "claude", goal: "@pi check this" });
  });

  it("trims the message without changing its selected agent", () => {
    const routed = routeComposerMessage("  check this  ", activeAgent);

    assert.deepEqual(routed, { agentId: "researcher", agent: "claude", goal: "check this" });
  });
});

const candidates: MentionCandidate[] = [
  { id: "agent_lead", displayName: "Lead", eligible: true },
  { id: "agent_support", displayName: "Support Bot", eligible: true },
];

describe("thread message input", () => {
  it("addresses the room when nobody is mentioned", () => {
    const input = threadMessageInput({
      text: "one more pass",
      candidates,
      userMessageId: "evt_1",
    });

    assert.deepEqual(input, {
      text: "one more pass",
      intent: "accomplish",
      userMessageId: "evt_1",
      idempotencyKey: "evt_1",
    });
  });

  it("narrows to the agents named at the head of the message", () => {
    const input = threadMessageInput({
      text: "@Lead @Support Bot ship it",
      candidates,
      userMessageId: "evt_1",
    });

    assert.deepEqual(input.addressAgentIds, ["agent_lead", "agent_support"]);
  });

  it("keeps the mention in the text the agent sees", () => {
    const input = threadMessageInput({
      text: "@Lead ship it",
      candidates,
      userMessageId: "evt_1",
    });

    assert.equal(input.text, "@Lead ship it");
  });

  it("falls back to the room when the name matches nobody here", () => {
    // The composer blocks this before it can be sent; a non-UI caller still
    // gets the safe outcome rather than a dispatch to an outsider.
    const input = threadMessageInput({
      text: "@Scout can you look at this?",
      candidates,
      userMessageId: "evt_1",
    });

    assert.equal(input.addressAgentIds, undefined);
  });
});
