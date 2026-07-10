import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canCancelConversationRun,
  conversationCancelNodeId,
  findActiveRunOwnerForSession,
  findActiveRunForSession,
  isConversationRunInFlight,
} from "../src/lib/conversationRunning.js";
import type { DaemonNodeMonitorRecord, RelaySession } from "../src/types.js";

const activeRun = {
  commandId: "cmd_1",
  sessionId: "ses_1",
  runId: "run_1",
  agent: "claude",
  mode: "action",
  taskGoal: "do work",
  startedAt: "2026-06-12T00:00:00.000Z",
} as const;

const node: DaemonNodeMonitorRecord = {
  id: "sbx_alice",
  employeeId: "alice",
  status: "running",
  agents: { claude: "ready", pi: "ready", codex: "ready", kimi: "unknown" },
  createdAt: "2026-06-12T00:00:00.000Z",
  updatedAt: "2026-06-12T00:00:00.000Z",
  queuedCommandCount: 0,
  activeRuns: [activeRun],
  online: true,
  stale: false,
};

function session(status: RelaySession["status"]): Pick<RelaySession, "id" | "status"> {
  return { id: "ses_1", status };
}

describe("conversationRunning", () => {
  it("finds the active run for the open session", () => {
    assert.deepEqual(findActiveRunForSession(node, "ses_1"), activeRun);
    assert.equal(findActiveRunForSession(node, "ses_other"), undefined);
  });

  it("finds the node that owns the run when an employee has multiple nodes", () => {
    const idleNode = { ...node, id: "sbx_idle", activeRuns: [] };
    const runningNode = { ...node, id: "sbx_running" };

    assert.deepEqual(
      findActiveRunOwnerForSession([idleNode, runningNode], "ses_1"),
      { node: runningNode, run: activeRun },
    );
  });

  it("treats a pending or dispatching send as in flight", () => {
    assert.equal(isConversationRunInFlight({
      activeRun: undefined,
      session: session("waiting_for_human"),
      pendingSend: true,
      dispatchingRun: false,
    }), true);
    assert.equal(isConversationRunInFlight({
      activeRun: undefined,
      session: session("waiting_for_human"),
      pendingSend: false,
      dispatchingRun: true,
    }), true);
  });

  it("treats a running session as in flight even before activeRuns refresh", () => {
    assert.equal(isConversationRunInFlight({
      activeRun: undefined,
      session: session("running"),
      pendingSend: false,
      dispatchingRun: false,
    }), true);
  });

  it("allows sends while waiting for human feedback", () => {
    assert.equal(isConversationRunInFlight({
      activeRun: undefined,
      session: session("waiting_for_human"),
      pendingSend: false,
      dispatchingRun: false,
    }), false);
  });

  it("offers cancel when the session is running without a visible active run", () => {
    assert.equal(canCancelConversationRun({
      activeRun: undefined,
      session: session("running"),
    }), true);
  });

  it("targets the visible daemon node before the sandbox snapshot when cancelling", () => {
    assert.equal(conversationCancelNodeId({
      node,
      sandbox: { id: "sbx_stale_snapshot" },
    }), "sbx_alice");
  });

  it("falls back to the sandbox snapshot when no visible daemon node exists", () => {
    assert.equal(conversationCancelNodeId({
      node: undefined,
      sandbox: { id: "sbx_alice" },
    }), "sbx_alice");
  });
});
