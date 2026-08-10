import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { materializeEvents, relayEvent } from "../src/index.js";

describe("managed Computer session affinity", () => {
  it("materializes affinity from session creation", () => {
    const sessionId = "ses_managed_created";
    const session = materializeEvents([
      relayEvent("session.created", sessionId, {
        workspacePath: "/workspace",
        daemonNodeId: "runtime_old",
        managedNodeId: "computer_one",
        taskGoal: "survive a restart",
        participants: ["human", "codex"],
      }),
    ]);

    assert.equal(session.daemonNodeId, "runtime_old");
    assert.equal(session.managedNodeId, "computer_one");
  });

  it("backfills affinity from the first agent run", () => {
    const sessionId = "ses_managed_backfill";
    const session = materializeEvents([
      relayEvent("session.created", sessionId, {
        workspacePath: "/workspace",
        taskGoal: "survive a restart",
        participants: ["human", "codex"],
      }),
      relayEvent("agent.started", sessionId, {
        runId: "run_1",
        agent: "codex",
        daemonNodeId: "runtime_old",
        managedNodeId: "computer_one",
      }),
    ]);

    assert.equal(session.daemonNodeId, "runtime_old");
    assert.equal(session.managedNodeId, "computer_one");
  });

  it("backfills affinity from durable runtime history migration", () => {
    const sessionId = "ses_managed_migrated";
    const session = materializeEvents([
      relayEvent("session.created", sessionId, {
        workspacePath: "/workspace",
        daemonNodeId: "runtime_deleted",
        taskGoal: "survive an older restart",
        participants: ["human", "codex"],
      }),
      relayEvent("session.runtime_affinity", sessionId, {
        managedNodeId: "computer_one",
      }),
    ]);

    assert.equal(session.daemonNodeId, "runtime_deleted");
    assert.equal(session.managedNodeId, "computer_one");
  });
});
