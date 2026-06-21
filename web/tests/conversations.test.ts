import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { conversationLabel, matchesConversationQuery, myConversationSessions } from "../src/lib/conversations.js";
import { isAwaitingFeedbackDecision, rerunAssignmentForSession } from "../src/lib/workflow.js";
import type { RelaySession } from "../src/types.js";

function session(partial: Partial<RelaySession>): RelaySession {
  return {
    id: "ses_x",
    workspacePath: "/workspace",
    taskGoal: "do a thing",
    participants: ["human"],
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

describe("web conversation helpers", () => {
  it("lists only the employee's own non-archived sessions, newest first", () => {
    const sessions = [
      session({ id: "a", ownerEmployeeId: "alice", updatedAt: "2026-06-20T01:00:00.000Z" }),
      session({ id: "b", ownerEmployeeId: "bob", updatedAt: "2026-06-20T05:00:00.000Z" }),
      session({ id: "c", ownerEmployeeId: "alice", archived: true, updatedAt: "2026-06-20T09:00:00.000Z" }),
      session({ id: "d", ownerEmployeeId: "alice", updatedAt: "2026-06-20T03:00:00.000Z" }),
    ];
    const mine = myConversationSessions(sessions, "alice");
    assert.deepEqual(mine.map((s) => s.id), ["d", "a"]);
  });

  it("keeps ownerless legacy sessions for the current employee", () => {
    const sessions = [session({ id: "legacy", ownerEmployeeId: undefined })];
    assert.deepEqual(myConversationSessions(sessions, "alice").map((s) => s.id), ["legacy"]);
  });

  it("labels by title when set, falling back to the task goal", () => {
    assert.equal(conversationLabel(session({ title: "Auth bug", taskGoal: "fix auth" })), "Auth bug");
    assert.equal(conversationLabel(session({ title: "   ", taskGoal: "fix auth" })), "fix auth");
    assert.equal(conversationLabel(session({ taskGoal: "fix auth" })), "fix auth");
  });

  it("matches the search query against title and task goal", () => {
    const s = session({ title: "Auth bug", taskGoal: "fix the redirect" });
    assert.equal(matchesConversationQuery(s, ""), true);
    assert.equal(matchesConversationQuery(s, "auth"), true);
    assert.equal(matchesConversationQuery(s, "redirect"), true);
    assert.equal(matchesConversationQuery(s, "deploy"), false);
  });

  it("shows recovery decisions only for explicit feedback waits", () => {
    assert.equal(isAwaitingFeedbackDecision(session({
      status: "waiting_for_human",
      pendingDecision: "feedback",
    })), true);
    assert.equal(isAwaitingFeedbackDecision(session({
      status: "running",
      pendingDecision: undefined,
    })), false);
    assert.equal(isAwaitingFeedbackDecision(session({
      status: "completed",
      pendingDecision: undefined,
    })), false);
  });

  it("reruns the latest session agent and mode", () => {
    const assignment = rerunAssignmentForSession(session({
      currentAgent: "claude",
      agentRuns: [{
        id: "run_1",
        agent: "codex",
        role: "reviewer",
        mode: "review",
        status: "failed",
        startedAt: "2026-06-20T00:00:00.000Z",
        artifactIds: [],
      }],
    }), "claude", "action");
    assert.deepEqual(assignment, { agent: "codex", mode: "review" });
  });
});
