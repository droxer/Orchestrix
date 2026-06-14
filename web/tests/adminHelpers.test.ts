import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAttentionItems,
  buildEmployeeSummaries,
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

const t = ((key: string, opts?: Record<string, unknown>) => {
  if (key === "admin.stale_run_body") return `stale:${opts?.count ?? 0}`;
  if (key === "admin.quiet_body") return `quiet:${opts?.time ?? ""}`;
  if (key === "admin.time.never") return "never";
  if (key === "admin.time.unknown") return "unknown";
  if (key === "admin.time.now") return "now";
  return key;
}) as unknown as Parameters<typeof buildAttentionItems>[1];

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

describe("buildAttentionItems", () => {
  it("emits an error entry when lastError is set", () => {
    const items = buildAttentionItems([node({ id: "a", lastError: "boom" })], t);
    assert.ok(items.some((item) => item.kind === "error" && item.body === "boom"));
  });

  it("emits stale-run when stale node has active runs", () => {
    const stale = node({
      id: "a",
      stale: true,
      activeRuns: [{ commandId: "c1", sessionId: "s1", runId: "r1", agent: "claude", mode: "implement", taskGoal: "do x", startedAt: new Date().toISOString() }],
    });
    const items = buildAttentionItems([stale], t);
    assert.ok(items.some((item) => item.kind === "stale-run"));
  });

  it("emits quiet when node is fresh but last seen > QUIET_AFTER_MS ago", () => {
    const quiet = node({ id: "a", lastSeenAgeMs: 12_000, lastSeenAt: new Date(Date.now() - 12_000).toISOString() });
    const items = buildAttentionItems([quiet], t);
    assert.ok(items.some((item) => item.kind === "quiet"));
  });

  it("does not emit quiet when node already has an error", () => {
    const both = node({ id: "a", lastError: "boom", lastSeenAgeMs: 12_000 });
    const items = buildAttentionItems([both], t);
    assert.equal(items.filter((item) => item.kind === "quiet").length, 0);
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
