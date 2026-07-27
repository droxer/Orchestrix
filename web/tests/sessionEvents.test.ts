import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applySessionEvent } from "../src/lib/sessionEvents.js";
import type { RelaySession } from "../src/types.js";

function session(partial: Partial<RelaySession> = {}): RelaySession {
  return {
    id: "ses_1",
    workspacePath: "/workspace",
    taskGoal: "fix auth",
    participants: ["human", "codex"],
    status: "running",
    phase: "created",
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    agentRuns: [],
    artifacts: [],
    decisions: [],
    events: [],
    ...partial,
  } as RelaySession;
}

describe("applySessionEvent", () => {
  it("preserves runtime affinity from streamed run starts", () => {
    const workspaceIdentity = { kind: "host", workspacePath: "/workspace" };
    const updated = applySessionEvent(session(), {
      id: "evt_started",
      type: "agent.started",
      sessionId: "ses_1",
      timestamp: "2026-06-20T00:00:01.000Z",
      runId: "run_1",
      agent: "codex",
      mode: "action",
      logicalAgentId: "agent_1",
      placementId: "placement_1",
      daemonNodeId: "node_1",
      agentVersion: 3,
      workspaceIdentity,
    });

    assert.equal(updated.agentRuns[0]?.daemonNodeId, "node_1");
    assert.equal(updated.agentRuns[0]?.placementId, "placement_1");
    assert.equal(updated.agentRuns[0]?.agentVersion, 3);
    assert.deepEqual(updated.agentRuns[0]?.workspaceIdentity, workspaceIdentity);
  });

  it("materializes streamed feedback waits before the list poll catches up", () => {
    const updated = applySessionEvent(session(), {
      id: "evt_wait",
      type: "session.status",
      sessionId: "ses_1",
      timestamp: "2026-06-20T00:00:05.000Z",
      status: "waiting_for_human",
      phase: "needs_feedback",
      pendingDecision: "feedback",
    });

    assert.equal(updated.status, "waiting_for_human");
    assert.equal(updated.phase, "needs_feedback");
    assert.equal(updated.pendingDecision, "feedback");
    assert.equal(updated.updatedAt, "2026-06-20T00:00:05.000Z");
    assert.deepEqual(updated.events.map((event) => event.id), ["evt_wait"]);
  });

  it("clears stale feedback and final outcome fields on non-terminal status updates", () => {
    const updated = applySessionEvent(session({
      status: "failed",
      phase: "failed",
      pendingDecision: "feedback",
      finalOutcome: "old failure",
    }), {
      id: "evt_running",
      type: "session.status",
      sessionId: "ses_1",
      timestamp: "2026-06-20T00:00:06.000Z",
      status: "running",
      phase: "approved",
    });

    assert.equal(updated.status, "running");
    assert.equal(updated.phase, "approved");
    assert.equal("pendingDecision" in updated, false);
    assert.equal("finalOutcome" in updated, false);
  });

  it("materializes streamed run completion and token usage before the list poll catches up", () => {
    const base = session({
      currentAgent: "codex",
      phase: "codex:action",
      agentRuns: [{
        id: "run_1",
        agent: "codex",
        role: "implementer",
        mode: "action",
        status: "running",
        startedAt: "2026-06-20T00:00:00.000Z",
        artifactIds: [],
      }],
    });

    const updated = applySessionEvent(base, {
      id: "evt_done",
      type: "agent.completed",
      sessionId: "ses_1",
      timestamp: "2026-06-20T00:01:00.000Z",
      runId: "run_1",
      agent: "codex",
      status: "completed",
      exitCode: 0,
      tokenUsage: { input: 10, output: 4, cache: 1, total: 15 },
    });

    assert.equal(updated.currentAgent, undefined);
    assert.equal(updated.phase, "agent_completed");
    assert.deepEqual(updated.agentRuns[0], {
      id: "run_1",
      agent: "codex",
      role: "implementer",
      mode: "action",
      status: "completed",
      startedAt: "2026-06-20T00:00:00.000Z",
      completedAt: "2026-06-20T00:01:00.000Z",
      exitCode: 0,
      tokenUsage: { input: 10, output: 4, cache: 1, total: 15 },
      artifactIds: [],
    });
    assert.deepEqual(updated.tokenUsage, { input: 10, output: 4, cache: 1, total: 15 });
  });

  it("clears stale feedback waits on terminal streamed events", () => {
    const base = session({
      status: "waiting_for_human",
      phase: "feedback",
      pendingDecision: "feedback",
      currentAgent: "codex",
    });

    const completed = applySessionEvent(base, {
      id: "evt_completed",
      type: "session.completed",
      sessionId: "ses_1",
      timestamp: "2026-06-20T00:02:00.000Z",
      outcome: "done",
    });
    assert.equal(completed.status, "completed");
    assert.equal("pendingDecision" in completed, false);
    assert.equal("currentAgent" in completed, false);

    const failed = applySessionEvent(base, {
      id: "evt_failed",
      type: "session.failed",
      sessionId: "ses_1",
      timestamp: "2026-06-20T00:03:00.000Z",
      outcome: "failed",
    });
    assert.equal(failed.status, "failed");
    assert.equal("pendingDecision" in failed, false);
    assert.equal("currentAgent" in failed, false);
  });

  it("clears stale feedback waits on streamed cancel decisions", () => {
    const updated = applySessionEvent(session({
      status: "waiting_for_human",
      phase: "feedback",
      pendingDecision: "feedback",
    }), {
      id: "evt_cancel",
      type: "human.decision",
      sessionId: "ses_1",
      timestamp: "2026-06-20T00:04:00.000Z",
      decision: {
        id: "dec_cancel",
        kind: "cancel",
        createdAt: "2026-06-20T00:04:00.000Z",
      },
    });

    assert.equal(updated.status, "cancelled");
    assert.equal(updated.phase, "cancelled");
    assert.equal("pendingDecision" in updated, false);
  });
});
