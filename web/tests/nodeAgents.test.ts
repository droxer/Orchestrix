import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hostedAgentsByNode } from "../src/lib/nodeAgents.js";
import type { AgentPlacement, EmployeeAgent } from "../src/types.js";

function placement(overrides: Partial<AgentPlacement>): AgentPlacement {
  return {
    id: "pl_1",
    agentId: "agent_1",
    employeeId: "alice",
    daemonNodeId: "node_a",
    executorKind: "claude",
    desiredState: "active",
    status: "ready",
    priority: 100,
    ...overrides,
  } as AgentPlacement;
}

function agent(overrides: Partial<EmployeeAgent>): EmployeeAgent {
  return {
    id: "agent_1",
    employeeId: "alice",
    displayName: "Researcher",
    executorKind: "claude",
    skillPolicy: {},
    toolPolicy: {},
    modelPolicy: {},
    enabled: true,
    version: 1,
    availability: "ready",
    placements: [],
    ...overrides,
  } as EmployeeAgent;
}

describe("hostedAgentsByNode", () => {
  it("groups each computer's hosted agents from non-removed placements", () => {
    const researcher = agent({
      id: "agent_1",
      displayName: "Researcher",
      placements: [placement({ id: "pl_1", agentId: "agent_1", daemonNodeId: "node_a" })],
    });
    const builder = agent({
      id: "agent_2",
      displayName: "Builder",
      executorKind: "codex",
      placements: [
        placement({ id: "pl_2", agentId: "agent_2", daemonNodeId: "node_a", executorKind: "codex" }),
        placement({ id: "pl_3", agentId: "agent_2", daemonNodeId: "node_b", executorKind: "codex" }),
      ],
    });

    const byNode = hostedAgentsByNode([researcher, builder]);

    assert.deepEqual(
      (byNode.get("node_a") ?? []).map((hosted) => hosted.agent.displayName),
      ["Builder", "Researcher"],
    );
    assert.deepEqual(
      (byNode.get("node_b") ?? []).map((hosted) => hosted.agent.displayName),
      ["Builder"],
    );
  });

  it("skips removed placements and computers with no agents", () => {
    const retired = agent({
      placements: [placement({ desiredState: "removed" })],
    });

    const byNode = hostedAgentsByNode([retired]);

    assert.equal(byNode.size, 0);
  });
});
