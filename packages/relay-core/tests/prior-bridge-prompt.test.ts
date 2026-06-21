import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { claudeTaskPrompt, piTaskPrompt, kimiTaskPrompt, codexActionPrompt, prependPriorAgentBridge } from "../src/prompts.js";
import { initialAgentState } from "../src/state.js";

describe("prior agent bridge in prompts", () => {
  it("returns prompt unchanged when bridge is absent", () => {
    const state = initialAgentState("do thing");
    assert.equal(claudeTaskPrompt(state), "do thing");
    assert.equal(piTaskPrompt(state), "do thing");
    assert.equal(kimiTaskPrompt(state), "do thing");
    assert.equal(codexActionPrompt(state), "do thing");
  });

  it("prepends the bridge with a [User] block when present", () => {
    const state = { ...initialAgentState("do thing"), prior_agent_bridge: "[Previous from @codex]\nreview note" };
    const expected = "[Previous from @codex]\nreview note\n\n[User]\ndo thing";
    assert.equal(claudeTaskPrompt(state), expected);
    assert.equal(piTaskPrompt(state), expected);
    assert.equal(kimiTaskPrompt(state), expected);
    assert.equal(codexActionPrompt(state), expected);
  });

  it("preserves review feedback inside the user block when both are present", () => {
    const state = {
      ...initialAgentState("do thing"),
      review_feedback: "fix X",
      prior_agent_bridge: "[Previous from @pi]\nverified",
    };
    const out = claudeTaskPrompt(state);
    assert.match(out, /\[Previous from @pi\]\nverified\n\n\[User\]\ndo thing\n\nReview feedback to fix:\nfix X/);
  });

  it("prependPriorAgentBridge is a no-op without bridge", () => {
    const state = initialAgentState("x");
    assert.equal(prependPriorAgentBridge("hello", state), "hello");
  });

  it("prepends prior conversation with a [User] block when present", () => {
    const state = { ...initialAgentState("next thing"), prior_conversation: "[Conversation so far]\n\n[User]\nfirst thing" };
    const expected = "[Conversation so far]\n\n[User]\nfirst thing\n\n[User]\nnext thing";
    assert.equal(claudeTaskPrompt(state), expected);
    assert.equal(codexActionPrompt(state), expected);
  });

  it("orders prior conversation before the within-run bridge", () => {
    const state = {
      ...initialAgentState("next thing"),
      prior_conversation: "[Conversation so far]\n\n[User]\nfirst thing",
      prior_agent_bridge: "[Previous from @codex]\nreview note",
    };
    const out = claudeTaskPrompt(state);
    assert.equal(
      out,
      "[Conversation so far]\n\n[User]\nfirst thing\n\n[Previous from @codex]\nreview note\n\n[User]\nnext thing",
    );
  });
});
