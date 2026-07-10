import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RelayApiError } from "../src/api.js";
import {
  agentReadiness,
  dispatchReadyAgents,
  formatDispatchError,
  isAgentDispatchReady,
} from "../src/lib/agentReadiness.js";

describe("Relay web agent readiness", () => {
  const node = {
    agents: { claude: "unknown", pi: "ready", codex: "failed", kimi: "ready" } as const,
    disabledAgents: ["kimi" as const],
  };

  it("treats only ready, enabled agents as dispatchable", () => {
    assert.equal(agentReadiness(node, "claude"), "unknown");
    assert.equal(agentReadiness(node, "pi"), "ready");
    assert.equal(agentReadiness(node, "codex"), "failed");
    assert.equal(agentReadiness(node, "kimi"), "disabled");
    assert.deepEqual(dispatchReadyAgents(node, ["claude", "pi", "codex", "kimi"]), ["pi"]);
    assert.equal(isAgentDispatchReady(node, "claude"), false);
    assert.equal(isAgentDispatchReady(node, "pi"), true);
  });

  it("formats backend not-ready dispatch errors", () => {
    const message = formatDispatchError(
      new RelayApiError("Sandbox sbx_alice daemon node does not have ready agent(s): claude.", 400),
      ((key: string, vars?: { agent?: string }) => `${key}:${vars?.agent ?? ""}`) as never,
    );
    assert.equal(message, "errors.agent_not_ready:claude");
  });
});
