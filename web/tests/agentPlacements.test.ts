import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeAgentPlacements } from "../src/lib/agentPlacements.js";
import type { AgentPlacement } from "../src/types.js";

function placement(input: Partial<AgentPlacement> & Pick<AgentPlacement, "id" | "daemonNodeId" | "priority">): AgentPlacement {
  return {
    id: input.id,
    agentId: input.agentId ?? "agent_alice",
    employeeId: input.employeeId ?? "alice",
    daemonNodeId: input.daemonNodeId,
    executorKind: input.executorKind ?? "codex",
    desiredState: input.desiredState ?? "active",
    status: input.status ?? "ready",
    priority: input.priority,
    agentVersion: input.agentVersion ?? 1,
    workspacePolicy: input.workspacePolicy ?? { kind: "employee-home" },
    conditions: input.conditions ?? [],
    createdAt: input.createdAt ?? "2026-07-19T00:00:00Z",
    updatedAt: input.updatedAt ?? "2026-07-19T00:00:00Z",
    nodeDisplayName: input.nodeDisplayName,
    nodeOwnership: input.nodeOwnership,
    nodeSandboxMode: input.nodeSandboxMode,
  };
}

describe("describeAgentPlacements", () => {
  it("orders placements by routing priority and identifies managed versus local destinations", () => {
    const result = describeAgentPlacements([
      placement({
        id: "placement_local",
        daemonNodeId: "node_local",
        priority: 200,
        nodeDisplayName: "Alice’s MacBook",
        nodeOwnership: "user-run",
        nodeSandboxMode: "none",
      }),
      placement({
        id: "placement_managed",
        daemonNodeId: "node_managed",
        priority: 100,
        nodeDisplayName: "Managed node for Alice",
        nodeOwnership: "managed",
        nodeSandboxMode: "boxlite",
      }),
    ]);

    assert.deepEqual(result.map((item) => ({
      id: item.placement.id,
      preference: item.preference,
      ownership: item.ownership,
      sandbox: item.sandbox,
      name: item.nodeName,
    })), [
      {
        id: "placement_managed",
        preference: "preferred",
        ownership: "managed",
        sandbox: "boxlite",
        name: "Managed node for Alice",
      },
      {
        id: "placement_local",
        preference: "alternate",
        ownership: "local",
        sandbox: "host",
        name: "Alice’s MacBook",
      },
    ]);
  });

  it("does not describe draining placements as preferred routes", () => {
    const result = describeAgentPlacements([
      placement({
        id: "placement_draining",
        daemonNodeId: "node_old",
        priority: 50,
        desiredState: "draining",
        status: "offline",
      }),
      placement({
        id: "placement_ready",
        daemonNodeId: "node_ready",
        priority: 100,
      }),
    ]);

    assert.deepEqual(result.map((item) => [item.placement.id, item.preference]), [
      ["placement_draining", null],
      ["placement_ready", "preferred"],
    ]);
  });
});
