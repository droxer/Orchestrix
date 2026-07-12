import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCollaborationTree } from "../src/lib/collaborationTree.js";
import type { CodexCollaborationEvent } from "relay-core";

describe("buildCollaborationTree", () => {
  it("builds a nested tree and applies the latest child status", () => {
    const events: CodexCollaborationEvent[] = [
      {
        id: "spawn-reviewer",
        tool: "spawnAgent",
        status: "completed",
        senderThreadId: "root",
        receiverThreadIds: ["reviewer"],
        prompt: "Review the protocol changes\nFocus on compatibility.",
        model: null,
        reasoningEffort: "high",
        agentsStates: { reviewer: { status: "running", message: "Reading" } },
      },
      {
        id: "spawn-tester",
        tool: "spawnAgent",
        status: "completed",
        senderThreadId: "reviewer",
        receiverThreadIds: ["tester"],
        prompt: "Run focused tests",
        model: null,
        reasoningEffort: null,
        agentsStates: { tester: { status: "running", message: null } },
      },
      {
        id: "wait-all",
        tool: "wait",
        status: "completed",
        senderThreadId: "root",
        receiverThreadIds: ["reviewer", "tester"],
        prompt: null,
        model: null,
        reasoningEffort: null,
        agentsStates: {
          reviewer: { status: "completed", message: "Looks good" },
          tester: { status: "completed", message: "Tests passed" },
        },
      },
    ];

    assert.deepEqual(buildCollaborationTree(events), [{
      threadId: "reviewer",
      parentThreadId: "root",
      label: "Review the protocol changes",
      prompt: "Review the protocol changes\nFocus on compatibility.",
      model: null,
      reasoningEffort: "high",
      status: "completed",
      message: "Looks good",
      children: [{
        threadId: "tester",
        parentThreadId: "reviewer",
        label: "Run focused tests",
        prompt: "Run focused tests",
        model: null,
        reasoningEffort: null,
        status: "completed",
        message: "Tests passed",
        children: [],
      }],
    }]);
  });

  it("settles unfinished exec-stream states when the root run has completed", () => {
    const events: CodexCollaborationEvent[] = [{
      id: "spawn-child",
      tool: "spawnAgent",
      status: "completed",
      senderThreadId: "root",
      receiverThreadIds: ["child"],
      prompt: "",
      model: null,
      reasoningEffort: null,
      agentsStates: { child: { status: "pendingInit", message: null } },
    }];

    assert.equal(buildCollaborationTree(events, { settled: true })[0]?.status, "completed");
  });
});
