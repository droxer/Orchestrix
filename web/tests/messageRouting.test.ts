import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveLeadingMention, routeComposerMessage } from "../src/lib/messageRouting.js";

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

const members = [
  { id: "agent_lead", displayName: "Lead" },
  { id: "agent_support", displayName: "Support Bot" },
  { id: "agent_dup_a", displayName: "Twin" },
  { id: "agent_dup_b", displayName: "Twin" },
];

describe("leading mention resolution", () => {
  it("addresses the named member when the mention leads", () => {
    assert.deepEqual(resolveLeadingMention("@Lead check the migration", members), {
      agentId: "agent_lead",
    });
  });

  it("prefers the longest matching name", () => {
    assert.deepEqual(resolveLeadingMention("@Support Bot ping", members), {
      agentId: "agent_support",
    });
  });

  it("ignores case", () => {
    assert.deepEqual(resolveLeadingMention("@lead hello", members), {
      agentId: "agent_lead",
    });
  });

  it("does not narrow when the mention is not leading", () => {
    assert.equal(resolveLeadingMention("tell @Lead I said hi", members), null);
  });

  it("does not narrow on an unknown name", () => {
    assert.equal(resolveLeadingMention("@Nobody hello", members), null);
  });

  it("does not narrow on an ambiguous name", () => {
    assert.equal(resolveLeadingMention("@Twin hello", members), null);
  });

  it("does not narrow without a mention", () => {
    assert.equal(resolveLeadingMention("hello everyone", members), null);
  });
});
