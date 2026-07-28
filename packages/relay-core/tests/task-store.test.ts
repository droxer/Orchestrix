import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { materializeTaskEvents, relayTaskEvent } from "../src/index.js";

describe("task team assignment events", () => {
  it("materializes a team-only assignment and clears a prior agent assignment", () => {
    const taskId = "task-1";

    const rebuilt = materializeTaskEvents([
      relayTaskEvent("task.created", taskId, {
        title: "Team task",
        description: "",
        priority: "normal",
      }),
      relayTaskEvent("task.assigned", taskId, { agent: "codex", agentId: "agent-1" }),
      relayTaskEvent("task.assigned", taskId, { teamId: "team-1" }),
    ]);

    assert.equal(rebuilt.assignedTeamId, "team-1");
    assert.equal(rebuilt.assignedAgent, undefined);
    assert.equal(rebuilt.assignedAgentId, undefined);
  });
});
