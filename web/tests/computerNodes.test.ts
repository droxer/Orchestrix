import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nodesAssignedToEmployee } from "../src/lib/computerNodes.js";
import type { DaemonNodeMonitorRecord } from "../src/types.js";

function node(overrides: Partial<DaemonNodeMonitorRecord> & { id: string }): DaemonNodeMonitorRecord {
  return {
    status: "ready",
    agents: { claude: "unknown", pi: "unknown", codex: "unknown", kimi: "unknown" },
    online: true,
    stale: false,
    queuedCommandCount: 0,
    activeRuns: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("nodesAssignedToEmployee", () => {
  it("returns only nodes owned by the given employee", () => {
    const nodes = [
      node({ id: "sbx_alice_1", employeeId: "alice" }),
      node({ id: "sbx_bob", employeeId: "bob" }),
      node({ id: "sbx_alice_2", employeeId: "alice" }),
    ];

    assert.deepEqual(
      nodesAssignedToEmployee(nodes, "alice").map((n) => n.id),
      ["sbx_alice_1", "sbx_alice_2"],
    );
  });

  it("returns an empty array when no employeeId is given", () => {
    const nodes = [node({ id: "sbx_alice", employeeId: "alice" })];
    assert.deepEqual(nodesAssignedToEmployee(nodes, undefined), []);
  });

  it("returns an empty array when the employee has no assigned nodes", () => {
    const nodes = [node({ id: "sbx_alice", employeeId: "alice" })];
    assert.deepEqual(nodesAssignedToEmployee(nodes, "carol"), []);
  });

  it("ignores nodes with no employeeId at all", () => {
    const nodes = [node({ id: "sbx_unassigned" })];
    assert.deepEqual(nodesAssignedToEmployee(nodes, "alice"), []);
  });
});
