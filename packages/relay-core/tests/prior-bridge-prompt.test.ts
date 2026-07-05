import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  askPrompt,
  claudeTaskPrompt,
  piTaskPrompt,
  kimiTaskPrompt,
  codexActionPrompt,
  prependPriorAgentBridge,
  reviewPrompt,
} from "../src/prompts.js";
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

  it("places handoff notes after prior agent context", () => {
    const state = {
      ...initialAgentState("continue the fix"),
      prior_agent_bridge: "[Previous from @claude]\nimplementation note",
      prior_handoff_note: "[Handoff note]\ncheck the auth edge case",
    };

    assert.equal(
      codexActionPrompt(state),
      "[Previous from @claude]\nimplementation note\n\n[Handoff note]\ncheck the auth edge case\n\n[User]\ncontinue the fix",
    );
  });

  it("includes conversation preludes in review prompts", () => {
    const state = {
      ...initialAgentState("review the branch"),
      prior_conversation: "[Conversation so far]\n\n[User]\nfix auth",
      prior_handoff_note: "[Handoff note]\nfocus on token refresh",
    };
    const out = reviewPrompt(state);

    assert.match(out, /\[Conversation so far\]\n\n\[User\]\nfix auth/);
    assert.match(out, /\[Handoff note\]\nfocus on token refresh/);
    assert.match(out, /User task:\nreview the branch/);
  });

  it("uses prior agent messages as discussion context in ask mode", () => {
    const state = {
      ...initialAgentState("design the rollout"),
      prior_agent_bridge: "[Previous from @claude]\nStart with a read-only audit.",
    };
    const out = askPrompt(state);
    assert.match(out, /planning discussion/);
    assert.match(out, /respond to them directly/);
    assert.match(out, /\[Previous from @claude\]\nStart with a read-only audit/);
    assert.match(out, /\[User\]\ndesign the rollout/);
  });
});
