import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchesThreadQuery, myThreadSessions, pickActiveThreadSession, sessionAgents, threadLabel, upsertThreadSession } from "../src/lib/threads.js";
import {
  agentsForThreadNode,
  threadNeedsRuntimeSelection,
  selectableThreadComputers,
  threadRuntimeNodeId,
} from "../src/lib/threadRuntime.js";
import { isAwaitingFeedbackDecision, rerunAssignmentForSession } from "../src/lib/workflow.js";
import type { RelaySession } from "../src/types.js";

type AgentRuns = RelaySession["agentRuns"];
const runs = (...agents: string[]): AgentRuns => agents.map((agent) => ({ agent }) as AgentRuns[number]);

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

describe("sessionAgents", () => {
  it("returns distinct agents in first-appearance order, deduped across runs", () => {
    assert.deepEqual(
      sessionAgents(session({ agentRuns: runs("codex", "claude", "claude"), currentAgent: undefined })),
      ["codex", "claude"],
    );
  });

  it("includes the current agent even without a recorded run", () => {
    assert.deepEqual(
      sessionAgents(session({ agentRuns: runs("pi"), currentAgent: "kimi" })),
      ["pi", "kimi"],
    );
  });

  it("is empty for a fresh session with no runs", () => {
    assert.deepEqual(sessionAgents(session({ agentRuns: runs(), currentAgent: undefined })), []);
  });
});

describe("web thread helpers", () => {
  it("selects a computer first and exposes only agents placed on it", () => {
    const nodes = [
      { id: "node_a", employeeId: "alice", online: true, stale: false, status: "ready" },
      { id: "node_b", employeeId: "alice", online: true, stale: false, status: "running" },
      { id: "node_bob", employeeId: "bob", online: true, stale: false, status: "ready" },
      { id: "node_stale", employeeId: "alice", online: true, stale: true, status: "ready" },
    ];
    const agents = [
      { id: "agent_a", placements: [{ daemonNodeId: "node_a", desiredState: "active" }] },
      { id: "agent_b", placements: [{ daemonNodeId: "node_b", desiredState: "active" }] },
      { id: "agent_removed", placements: [{ daemonNodeId: "node_a", desiredState: "removed" }] },
    ];

    assert.deepEqual(
      selectableThreadComputers(nodes, "alice").map((node) => node.id),
      ["node_a", "node_b"],
    );
    assert.deepEqual(
      agentsForThreadNode(agents, "node_a").map((agent) => agent.id),
      ["agent_a"],
    );
    assert.equal(threadRuntimeNodeId(session({ daemonNodeId: "node_a" })), "node_a");
    assert.equal(threadNeedsRuntimeSelection(session({ daemonNodeId: "node_a" }), false), false);
    assert.equal(threadNeedsRuntimeSelection(session({}), false), true);
    assert.equal(threadNeedsRuntimeSelection(session({ daemonNodeId: "node_a" }), true), true);
    assert.equal(
      threadRuntimeNodeId(session({
        agentRuns: [{
          id: "run_b",
          agent: "codex",
          mode: "action",
          status: "completed",
          startedAt: "2026-06-20T00:00:00.000Z",
          artifactIds: [],
          daemonNodeId: "node_b",
        } as AgentRuns[number]],
      })),
      "node_b",
    );
  });

  it("lists only the employee's own non-archived sessions, newest first", () => {
    const sessions = [
      session({ id: "a", ownerEmployeeId: "alice", updatedAt: "2026-06-20T01:00:00.000Z" }),
      session({ id: "b", ownerEmployeeId: "bob", updatedAt: "2026-06-20T05:00:00.000Z" }),
      session({ id: "c", ownerEmployeeId: "alice", archived: true, updatedAt: "2026-06-20T09:00:00.000Z" }),
      session({ id: "d", ownerEmployeeId: "alice", updatedAt: "2026-06-20T03:00:00.000Z" }),
    ];
    const mine = myThreadSessions(sessions, "alice");
    assert.deepEqual(mine.map((s) => s.id), ["d", "a"]);
  });

  it("keeps ownerless legacy sessions for the current employee", () => {
    const sessions = [session({ id: "legacy", ownerEmployeeId: undefined })];
    assert.deepEqual(myThreadSessions(sessions, "alice").map((s) => s.id), ["legacy"]);
  });

  it("labels by title when set, falling back to the task goal", () => {
    assert.equal(threadLabel(session({ title: "Auth bug", taskGoal: "fix auth" })), "Auth bug");
    assert.equal(threadLabel(session({ title: "   ", taskGoal: "fix auth" })), "fix auth");
    assert.equal(threadLabel(session({ taskGoal: "fix auth" })), "fix auth");
  });

  it("matches the search query against title and task goal", () => {
    const s = session({ title: "Auth bug", taskGoal: "fix the redirect" });
    assert.equal(matchesThreadQuery(s, ""), true);
    assert.equal(matchesThreadQuery(s, "auth"), true);
    assert.equal(matchesThreadQuery(s, "redirect"), true);
    assert.equal(matchesThreadQuery(s, "deploy"), false);
  });

  it("picks the selected active thread only from visible threads", () => {
    const visible = session({ id: "visible", ownerEmployeeId: "alice", updatedAt: "2026-06-20T03:00:00.000Z" });
    const selected = session({ id: "selected", ownerEmployeeId: "alice", updatedAt: "2026-06-20T01:00:00.000Z" });

    assert.equal(pickActiveThreadSession({
      threads: [visible, selected],
      selectedSessionId: "selected",
      activeSessionId: "visible",
      composingNew: false,
    })?.id, "selected");
  });

  it("falls back when the selected thread is stale, archived, or out of scope", () => {
    const sessions = [
      session({ id: "archived", ownerEmployeeId: "alice", archived: true, updatedAt: "2026-06-20T09:00:00.000Z" }),
      session({ id: "bob", ownerEmployeeId: "bob", updatedAt: "2026-06-20T08:00:00.000Z" }),
      session({ id: "active", ownerEmployeeId: "alice", updatedAt: "2026-06-20T03:00:00.000Z" }),
    ];
    const threads = myThreadSessions(sessions, "alice");

    assert.deepEqual(threads.map((item) => item.id), ["active"]);
    assert.equal(pickActiveThreadSession({
      threads,
      selectedSessionId: "archived",
      activeSessionId: null,
      composingNew: false,
    })?.id, "active");
  });

  it("suppresses all active thread fallback while composing a new thread", () => {
    const threads = [session({ id: "active", ownerEmployeeId: "alice" })];

    assert.equal(pickActiveThreadSession({
      threads,
      selectedSessionId: "active",
      activeSessionId: "active",
      composingNew: true,
    }), undefined);
  });

  // Creating a thread returns the new session before the list refetch
  // lands. Without seeding it into the cached list the selection points at an
  // id nobody can find, so the fallback lands on threads[0] — the
  // previous thread — and the transcript flashes it before jumping.
  it("opens the freshly created thread instead of the previous thread", () => {
    const previous = session({ id: "previous", ownerEmployeeId: "alice", updatedAt: "2026-06-20T03:00:00.000Z" });
    const created = session({ id: "created", ownerEmployeeId: "alice", updatedAt: "2026-06-20T04:00:00.000Z" });

    const threads = upsertThreadSession([previous], created);
    assert.equal(pickActiveThreadSession({
      threads,
      selectedSessionId: created.id,
      activeSessionId: created.id,
      composingNew: false,
    })?.id, "created");
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
