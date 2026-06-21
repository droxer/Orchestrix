import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { agentLabel, parsePlanSteps } from "../src/lib/plan.js";

const AGENTS = ["claude", "pi", "codex", "kimi"] as const;

describe("parsePlanSteps", () => {
  it("parses a multi-step assignment plan", () => {
    const body = JSON.stringify({
      assignments: [
        { agent: "claude", mode: "action" },
        { agent: "codex", mode: "review" },
      ],
    });
    assert.deepEqual(parsePlanSteps(body, AGENTS), [
      { agent: "claude", mode: "action" },
      { agent: "codex", mode: "review" },
    ]);
  });

  it("defaults an unknown mode to action", () => {
    const body = JSON.stringify({ assignments: [{ agent: "pi", mode: "weird" }] });
    assert.deepEqual(parsePlanSteps(body, AGENTS), [{ agent: "pi", mode: "action" }]);
  });

  it("drops entries with an unknown agent", () => {
    const body = JSON.stringify({
      assignments: [
        { agent: "ghost", mode: "action" },
        { agent: "kimi", mode: "action" },
      ],
    });
    assert.deepEqual(parsePlanSteps(body, AGENTS), [{ agent: "kimi", mode: "action" }]);
  });

  it("returns null for non-plan / invalid JSON", () => {
    assert.equal(parsePlanSteps("not json", AGENTS), null);
    assert.equal(parsePlanSteps(JSON.stringify({ assignments: [] }), AGENTS), null);
    assert.equal(parsePlanSteps(JSON.stringify({ foo: "bar" }), AGENTS), null);
  });
});

describe("agentLabel", () => {
  it("capitalizes the agent name", () => {
    assert.equal(agentLabel("claude"), "Claude");
    assert.equal(agentLabel("codex"), "Codex");
  });
});
