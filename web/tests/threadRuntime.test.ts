import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { threadNodeOffline } from "../src/lib/threadRuntime.js";

type TestNode = {
  id: string;
  managedNodeId?: string;
  retiredAt?: string;
  employeeId?: string;
  online: boolean;
  stale: boolean;
  status: string;
};

function node(overrides: Partial<TestNode> = {}): TestNode {
  return {
    id: "sbx_alice",
    employeeId: "alice",
    online: true,
    stale: false,
    status: "ready",
    ...overrides,
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return { daemonNodeId: "sbx_alice", agentRuns: [], ...overrides };
}

describe("threadNodeOffline", () => {
  it("is false when the pinned computer is online and fresh", () => {
    assert.equal(threadNodeOffline(session(), [], [node()]), false);
  });

  it("is true when the pinned computer is offline", () => {
    assert.equal(threadNodeOffline(session(), [], [node({ online: false })]), true);
  });

  it("is true when the pinned computer heartbeat is stale", () => {
    assert.equal(threadNodeOffline(session(), [], [node({ stale: true })]), true);
  });

  it("is true when the pinned computer has left the fleet", () => {
    assert.equal(threadNodeOffline(session(), [], []), true);
  });

  it("is true when the pinned computer is retired", () => {
    const retired = node({ retiredAt: "2026-06-12T00:00:00.000Z" });
    assert.equal(threadNodeOffline(session(), [], [retired]), true);
  });

  it("is false when the thread names no computer", () => {
    assert.equal(threadNodeOffline({ agentRuns: [] }, [], [node()]), false);
    assert.equal(threadNodeOffline(undefined, [], [node()]), false);
  });

  it("follows the managed-node fallback to a healthy replacement", () => {
    const offline = node({ id: "sbx_old", managedNodeId: "mn_1", online: false });
    const replacement = node({ id: "sbx_new", managedNodeId: "mn_1" });
    assert.equal(
      threadNodeOffline(session({ daemonNodeId: "sbx_old" }), [], [offline, replacement]),
      false,
    );
  });

  it("is true when every managed-node candidate is offline", () => {
    const offline = node({ id: "sbx_old", managedNodeId: "mn_1", online: false });
    const alsoOffline = node({ id: "sbx_new", managedNodeId: "mn_1", online: false });
    assert.equal(
      threadNodeOffline(session({ daemonNodeId: "sbx_old" }), [], [offline, alsoOffline]),
      true,
    );
  });
});
