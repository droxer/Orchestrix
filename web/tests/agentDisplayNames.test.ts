import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildExecutorDisplayNameMap,
  displayNameForExecutor,
  isEmployeeAgentRoutable,
  isLogicalAgentRoutable,
  labelForExecutor,
  preferredRoutableAgent,
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

  it("treats busy agents as routable like the backend", () => {
    assert.equal(isLogicalAgentRoutable("ready"), true);
    assert.equal(isLogicalAgentRoutable("busy"), true);
    assert.equal(isLogicalAgentRoutable("pending"), false);
    assert.equal(isLogicalAgentRoutable("offline"), false);
  });

  it("does not select an inactive or offline agent for work", () => {
    const logicalAgents = [
      agent({ id: "offline", displayName: "Offline", executorKind: "claude", availability: "offline" }),
      agent({ id: "inactive", displayName: "Inactive", executorKind: "codex", enabled: false }),
    ];

    assert.equal(isEmployeeAgentRoutable(logicalAgents[0]), false);
    assert.equal(isEmployeeAgentRoutable(logicalAgents[1]), false);
    assert.equal(preferredRoutableAgent(logicalAgents, "offline"), undefined);
  });

  it("moves selection to a routable agent when the preferred agent goes offline", () => {
    const logicalAgents = [
      agent({ id: "offline", displayName: "Offline", executorKind: "claude", availability: "offline" }),
      agent({ id: "ready", displayName: "Ready", executorKind: "codex" }),
    ];

    assert.equal(preferredRoutableAgent(logicalAgents, "offline")?.id, "ready");
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
