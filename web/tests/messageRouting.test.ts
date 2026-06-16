import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { routeComposerMessage } from "../src/lib/messageRouting.js";
import type { AgentName } from "../src/types.js";

const agents: AgentName[] = ["claude", "pi", "codex", "kimi"];

describe("composer message routing", () => {
  it("routes an explicit Pi mention away from the active agent", () => {
    const routed = routeComposerMessage("@pi check this", "claude", agents);

    assert.deepEqual(routed, { agent: "pi", goal: "check this" });
  });

  it("matches agent mentions case-insensitively", () => {
    const routed = routeComposerMessage("@Pi check this", "claude", agents);

    assert.deepEqual(routed, { agent: "pi", goal: "check this" });
  });

  it("keeps unknown leading mentions in the task text", () => {
    const routed = routeComposerMessage("@planner check this", "claude", agents);

    assert.deepEqual(routed, { agent: "claude", goal: "@planner check this" });
  });

  it("reports an empty goal for a bare agent mention", () => {
    const routed = routeComposerMessage("@pi", "claude", agents);

    assert.deepEqual(routed, { agent: "pi", goal: "" });
  });
});
