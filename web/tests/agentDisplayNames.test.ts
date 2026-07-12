import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildExecutorDisplayNameMap,
  displayNameForExecutor,
  isLogicalAgentRoutable,
  labelForExecutor,
  mentionableAgents,
} from "../src/lib/agentDisplayNames.js";
import type { EmployeeAgent } from "../src/types.js";

function agent(
  input: Partial<EmployeeAgent> & Pick<EmployeeAgent, "id" | "displayName" | "executorKind">,
): EmployeeAgent {
  return {
    employeeId: "alice",
    skillPolicy: {},
    toolPolicy: {},
    modelPolicy: {},
    enabled: true,
    version: 1,
    availability: "ready",
    placements: [],
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    ...input,
  };
}

describe("agentDisplayNames", () => {
  it("prefers ready logical agents when multiple share an executor kind", () => {
    const logicalAgents = [
      agent({ id: "a1", displayName: "Offline Analyst", executorKind: "claude", availability: "offline" }),
      agent({ id: "a2", displayName: "Researcher", executorKind: "claude", availability: "ready" }),
      agent({ id: "a3", displayName: "Builder", executorKind: "codex" }),
    ];

    assert.equal(displayNameForExecutor("claude", logicalAgents), "Researcher");
    assert.deepEqual(buildExecutorDisplayNameMap(logicalAgents), {
      claude: "Researcher",
      codex: "Builder",
    });
  });

  it("lists enabled logical agents for mention autocomplete", () => {
    const logicalAgents = [
      agent({ id: "a1", displayName: "Researcher", executorKind: "claude" }),
      agent({ id: "a2", displayName: "Disabled", executorKind: "pi", enabled: false }),
      agent({ id: "a3", displayName: "Builder", executorKind: "codex", availability: "busy" }),
    ];

    assert.deepEqual(mentionableAgents(logicalAgents), [
      { id: "a1", displayName: "Researcher", executorKind: "claude", ready: true },
      { id: "a3", displayName: "Builder", executorKind: "codex", ready: true },
    ]);
  });

  it("treats busy agents as routable like the backend", () => {
    assert.equal(isLogicalAgentRoutable("ready"), true);
    assert.equal(isLogicalAgentRoutable("busy"), true);
    assert.equal(isLogicalAgentRoutable("pending"), false);
    assert.equal(isLogicalAgentRoutable("offline"), false);
  });

  it("prefers ready over busy when resolving shared executor labels", () => {
    const logicalAgents = [
      agent({ id: "a1", displayName: "Busy Analyst", executorKind: "claude", availability: "busy" }),
      agent({ id: "a2", displayName: "Researcher", executorKind: "claude", availability: "ready" }),
    ];

    assert.equal(displayNameForExecutor("claude", logicalAgents), "Researcher");
  });

  it("falls back to capitalized executor labels when no logical agent exists", () => {
    assert.equal(displayNameForExecutor("kimi", []), "Kimi");
    assert.equal(labelForExecutor("pi", undefined), "Pi");
    assert.equal(labelForExecutor("pi", { pi: "Planner" }), "Planner");
  });
});
