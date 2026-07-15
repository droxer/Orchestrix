import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildEmployeeSummaries,
  initialsOf,
  isStale,
  statusTone,
  truncateId,
  visualStatus,
} from "../src/lib/adminHelpers.js";
import type { ControlPanelDaemonNodeRecord, EmployeeRecord } from "../src/types.js";

function node(input: Partial<ControlPanelDaemonNodeRecord> & { id: string }): ControlPanelDaemonNodeRecord {
  return {
    id: input.id,
    employeeId: input.employeeId,
    status: input.status ?? "ready",
    online: input.online ?? true,
    stale: input.stale,
    lastSeenAt: input.lastSeenAt ?? new Date().toISOString(),
    lastSeenAgeMs: input.lastSeenAgeMs,
    lastError: input.lastError,
    workspacePath: input.workspacePath,
    nodeToken: input.nodeToken,
    queuedCommandCount: input.queuedCommandCount ?? 0,
    activeRuns: input.activeRuns ?? [],
    agents: input.agents ?? { claude: "ready", pi: "ready", codex: "ready", kimi: "ready" },
  } as ControlPanelDaemonNodeRecord;
}

function employee(input: Partial<EmployeeRecord> & { id: string }): EmployeeRecord {
  return {
    id: input.id,
    displayName: input.displayName ?? input.id,
    email: input.email,
    departmentId: input.departmentId,
    departmentName: input.departmentName,
  };
}

describe("isStale + visualStatus", () => {
  it("treats explicit stale flag as authoritative", () => {
    const n = node({ id: "a", stale: true, status: "ready", online: true });
    assert.equal(isStale(n), true);
    assert.equal(visualStatus(n), "stale");
  });

  it("treats offline nodes as stale", () => {
    const n = node({ id: "a", online: false });
    assert.equal(isStale(n), true);
  });

  it("treats nodes seen >15s ago as stale", () => {
    const n = node({ id: "a", lastSeenAt: new Date(Date.now() - 20_000).toISOString() });
    assert.equal(isStale(n), true);
  });

  it("treats fresh online nodes as not stale", () => {
    const n = node({ id: "a", lastSeenAt: new Date().toISOString() });
    assert.equal(isStale(n), false);
    assert.equal(visualStatus(n), "ready");
  });
});

describe("statusTone", () => {
  it("maps known statuses to tones", () => {
    assert.equal(statusTone("ready"), "good");
    assert.equal(statusTone("running"), "info");
    assert.equal(statusTone("provisioning"), "info");
    assert.equal(statusTone("failed"), "bad");
    assert.equal(statusTone("stale"), "bad");
    assert.equal(statusTone("stopped"), "warn");
    assert.equal(statusTone("anything-else"), "neutral");
  });
});

describe("truncateId", () => {
  it("returns short ids verbatim", () => {
    assert.equal(truncateId("short"), "short");
  });
  it("truncates long ids with an ellipsis", () => {
    assert.equal(truncateId("sandbox-abcdef-1234", 4, 4), "sand…1234");
  });
});

describe("buildEmployeeSummaries", () => {
  it("aggregates nodes by employee and counts ready/running", () => {
    const employees = [employee({ id: "alice", displayName: "Alice" }), employee({ id: "bob" })];
    const nodes = [
      node({ id: "n1", employeeId: "alice", status: "ready" }),
      node({ id: "n2", employeeId: "alice", status: "running" }),
      node({ id: "n3", employeeId: "bob", status: "ready" }),
      node({ id: "orphan", employeeId: undefined }),
    ];
    const summaries = buildEmployeeSummaries(employees, nodes);
    const alice = summaries.find((s) => s.id === "alice");
    const bob = summaries.find((s) => s.id === "bob");
    assert.ok(alice, "alice summary missing");
    assert.equal(alice.nodeCount, 2);
    assert.equal(alice.readyCount, 1);
    assert.equal(alice.runningCount, 1);
    assert.ok(bob);
    assert.equal(bob.nodeCount, 1);
  });

  it("includes employees that have no nodes", () => {
    const summaries = buildEmployeeSummaries([employee({ id: "ghost" })], []);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].nodeCount, 0);
  });

  it("surfaces phantom employee-ids that appear only on nodes", () => {
    const summaries = buildEmployeeSummaries([], [node({ id: "n1", employeeId: "phantom" })]);
    const phantom = summaries.find((s) => s.id === "phantom");
    assert.ok(phantom, "phantom missing");
    assert.equal(phantom.displayName, "phantom");
    assert.equal(phantom.nodeCount, 1);
  });
});

describe("initialsOf", () => {
  it("takes two letters from a single token", () => {
    assert.equal(initialsOf("alice"), "AL");
  });

  it("combines first and last parts", () => {
    assert.equal(initialsOf("alice.chen"), "AC");
    assert.equal(initialsOf("@bob-smith"), "BS");
  });

  it("falls back for empty input", () => {
    assert.equal(initialsOf(""), "?");
    assert.equal(initialsOf("   "), "?");
  });
});
