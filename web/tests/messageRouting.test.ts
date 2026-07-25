import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { routeComposerMessage } from "../src/lib/messageRouting.js";

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
