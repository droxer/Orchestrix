import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  abbreviateNodeId,
  countEmployeeDeviceComputers,
  formatRunElapsed,
  nodesAssignedToEmployee,
} from "../src/lib/computerNodes.js";
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

  it("shows one cloud computer across managed runtime replacements", () => {
    const nodes = [
      node({
        id: "runtime_old",
        employeeId: "alice",
        managedNodeId: "cloud_1",
        status: "stopped",
        online: false,
        stale: true,
        retiredAt: "2026-01-02T00:00:00Z",
        lastSeenAt: "2026-01-02T00:00:00Z",
      }),
      node({
        id: "runtime_current",
        employeeId: "alice",
        managedNodeId: "cloud_1",
        lastSeenAt: "2026-01-03T00:00:00Z",
      }),
    ];

    const visible = nodesAssignedToEmployee(nodes, "alice");

    assert.deepEqual(visible.map((item) => item.id), ["runtime_current"]);
  });

  it("shows one local computer across daemon restarts", () => {
    const nodes = [
      node({
        id: "runtime_old",
        employeeId: "alice",
        workspaceId: "machine_1",
        nodeLocation: "employee-device",
        status: "stopped",
        online: false,
        stale: true,
        retiredAt: "2026-01-02T00:00:00Z",
      }),
      node({
        id: "runtime_current",
        employeeId: "alice",
        workspaceId: "machine_1",
        nodeLocation: "employee-device",
      }),
    ];

    assert.deepEqual(
      nodesAssignedToEmployee(nodes, "alice").map((item) => item.id),
      ["runtime_current"],
    );
  });

  it("preserves genuinely distinct computers owned by one employee", () => {
    const nodes = [
      node({ id: "local_1", employeeId: "alice", workspaceId: "machine_1" }),
      node({ id: "local_2", employeeId: "alice", workspaceId: "machine_2" }),
      node({ id: "cloud_1", employeeId: "alice", managedNodeId: "managed_1" }),
    ];

    assert.deepEqual(
      nodesAssignedToEmployee(nodes, "alice").map((item) => item.id),
      ["local_1", "local_2", "cloud_1"],
    );
  });
});

describe("formatRunElapsed", () => {
  const start = "2026-08-02T10:00:00Z";
  const at = (ms: number) => Date.parse(start) + ms;

  it("counts up in seconds under a minute", () => {
    assert.equal(formatRunElapsed(start, at(0)), "0s");
    assert.equal(formatRunElapsed(start, at(48_000)), "48s");
  });

  it("switches to whole minutes under an hour", () => {
    assert.equal(formatRunElapsed(start, at(60_000)), "1m");
    assert.equal(formatRunElapsed(start, at(12 * 60_000)), "12m");
    assert.equal(formatRunElapsed(start, at(59 * 60_000 + 59_000)), "59m");
  });

  it("pads the minute part past an hour so the column stays aligned", () => {
    assert.equal(formatRunElapsed(start, at(60 * 60_000)), "1h 00m");
    assert.equal(formatRunElapsed(start, at(3 * 60 * 60_000 + 4 * 60_000)), "3h 04m");
  });

  it("clamps clock skew to zero rather than printing a negative run", () => {
    // A daemon whose clock runs ahead reports a startedAt in the future; the
    // activity row must not read "-3s".
    assert.equal(formatRunElapsed(start, at(-3_000)), "0s");
  });

  it("degrades to a dash on an unparseable timestamp", () => {
    assert.equal(formatRunElapsed("not-a-date", at(0)), "—");
  });
});

describe("countEmployeeDeviceComputers", () => {
  it("counts local computers without charging managed capacity against the limit", () => {
    const computers = [
      node({
        id: "local_1",
        employeeId: "alice",
        workspaceId: "machine_1",
        nodeLocation: "employee-device",
      }),
      node({
        id: "cloud_1",
        employeeId: "alice",
        managedNodeId: "managed_1",
        nodeLocation: "managed",
      }),
    ];

    assert.equal(countEmployeeDeviceComputers(computers), 1);
  });
});

describe("abbreviateNodeId", () => {
  it("keeps both ends of a long id", () => {
    assert.equal(abbreviateNodeId("66270440-0756-4904-8747-6043e1a1c9f2"), "66270440…e1a1c9f2");
  });

  it("distinguishes two ids that share a prefix", () => {
    // The whole point: a tail-truncating CSS ellipsis collapses these two
    // UUIDs to the same visible string.
    const a = abbreviateNodeId("66270440-0756-4904-8747-000000000001");
    const b = abbreviateNodeId("66270440-0756-4904-8747-000000000002");
    assert.notEqual(a, b);
    assert.ok(a.endsWith("00000001") && b.endsWith("00000002"));
  });

  it("leaves an id that already fits alone", () => {
    assert.equal(abbreviateNodeId("node-1"), "node-1");
  });
});
