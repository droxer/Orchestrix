import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  canDeleteThread,
  matchesThreadQuery,
  myThreadSessions,
  pickActiveThreadSession,
  sessionAgents,
  threadLabel,
  upsertThreadSession,
} from "../src/lib/threads.js";
import {
  agentsForThreadNode,
  threadNeedsRuntimeSelection,
  resolveNewThreadComputer,
  selectableThreadComputers,
  threadComputerSignature,
  threadRuntimeNodeId,
} from "../src/lib/threadRuntime.js";
import { isAwaitingFeedbackDecision, rerunAssignmentForSession } from "../src/lib/workflow.js";
import { teamMembersForMention, teamMessageInput } from "../src/lib/messageRouting.js";
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
  it("blocks deletion while the session or daemon still has a run in flight", () => {
    assert.equal(canDeleteThread({ session: session({ status: "running" }) }), false);
    assert.equal(
      canDeleteThread({
        session: session({ status: "cancelled" }),
        runningAgent: "claude",
      }),
      false,
    );
    assert.equal(canDeleteThread({ session: session({ status: "cancelled" }) }), true);
  });

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
    assert.equal(
      threadRuntimeNodeId(
        session({
          daemonNodeId: "node_old",
          managedNodeId: "computer_a",
        }),
        agents,
        [
          {
            id: "node_new",
            managedNodeId: "computer_a",
            employeeId: "alice",
            online: true,
            stale: false,
            status: "ready",
          },
        ],
      ),
      "node_new",
    );
    assert.equal(
      threadRuntimeNodeId(
        session({
          daemonNodeId: "node_old",
          agentRuns: [{
            id: "run_a",
            agent: "codex",
            logicalAgentId: "agent_a",
            status: "completed",
            startedAt: "2026-06-20T00:00:00.000Z",
            artifactIds: [],
          } as AgentRuns[number]],
        }),
        agents,
        [{
          id: "node_a",
          managedNodeId: "computer_a",
          employeeId: "alice",
          online: true,
          stale: false,
          status: "ready",
        }],
      ),
      "node_a",
    );
    assert.equal(threadNeedsRuntimeSelection(session({ daemonNodeId: "node_a" }), false), false);
    assert.equal(threadNeedsRuntimeSelection(session({}), false), true);
    assert.equal(threadNeedsRuntimeSelection(session({ daemonNodeId: "node_a" }), true), true);
    assert.equal(
      threadRuntimeNodeId(session({
        agentRuns: [{
          id: "run_b",
          agent: "codex",
          status: "completed",
          startedAt: "2026-06-20T00:00:00.000Z",
          artifactIds: [],
          daemonNodeId: "node_b",
        } as AgentRuns[number]],
      })),
      "node_b",
    );
  });

  it("infers the pinned computer from the running agent's placement on legacy threads", () => {
    const agents = [
      { id: "agent_a", placements: [{ daemonNodeId: "node_a", desiredState: "active" }] },
      { id: "agent_b", placements: [{ daemonNodeId: "node_b", desiredState: "active" }] },
      { id: "agent_gone", placements: [{ daemonNodeId: "node_c", desiredState: "removed" }] },
    ];
    const legacyRun = (logicalAgentId: string) => ({
      id: `run_${logicalAgentId}`,
      agent: "claude",
      logicalAgentId,
      status: "completed",
      startedAt: "2026-06-20T00:00:00.000Z",
      artifactIds: [],
    } as AgentRuns[number]);

    // Latest run with a resolvable placement wins.
    assert.equal(
      threadRuntimeNodeId(session({ agentRuns: [legacyRun("agent_a"), legacyRun("agent_b")] }), agents),
      "node_b",
    );
    // Removed placements don't count; fall through to an earlier run.
    assert.equal(
      threadRuntimeNodeId(session({ agentRuns: [legacyRun("agent_a"), legacyRun("agent_gone")] }), agents),
      "node_a",
    );
    // A stamped session or run still wins over the inference.
    assert.equal(
      threadRuntimeNodeId(session({ daemonNodeId: "node_z", agentRuns: [legacyRun("agent_a")] }), agents),
      "node_z",
    );
    // No agents resolved: the thread still needs a selection.
    assert.equal(threadRuntimeNodeId(session({ agentRuns: [legacyRun("agent_a")] })), undefined);
    assert.equal(
      threadNeedsRuntimeSelection(session({ agentRuns: [legacyRun("agent_a")] }), false, agents),
      false,
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

  it("reruns the latest session agent", () => {
    const assignment = rerunAssignmentForSession(session({
      currentAgent: "claude",
      agentRuns: [{
        id: "run_1",
        agent: "codex",
        role: "reviewer",
        status: "failed",
        startedAt: "2026-06-20T00:00:00.000Z",
        artifactIds: [],
      }],
    }), "claude");
    assert.deepEqual(assignment, { agent: "codex" });
  });
});

describe("new-thread computer selection", () => {
  const ready = (id: string, over: Record<string, unknown> = {}) => ({
    id, employeeId: "alice", online: true, stale: false, status: "ready", ...over,
  });

  it("keeps the picked computer when a poll reports it briefly unselectable", () => {
    const picked = ready("node_b");
    const known = [ready("node_a"), { ...picked, stale: true }];
    const selectable = selectableThreadComputers(known, "alice");

    assert.deepEqual(selectable.map((node) => node.id), ["node_a"]);
    assert.equal(resolveNewThreadComputer("node_b", selectable, known), "node_b");
  });

  it("falls back to the first selectable computer only once the pick is gone", () => {
    const known = [ready("node_a"), ready("node_c")];
    const selectable = selectableThreadComputers(known, "alice");

    assert.equal(resolveNewThreadComputer("node_b", selectable, known), "node_a");
    assert.equal(resolveNewThreadComputer(null, selectable, known), "node_a");
    assert.equal(resolveNewThreadComputer("node_b", [], []), null);
  });

  it("ignores heartbeat churn when keying the computer list", () => {
    const first = [ready("node_a", { lastSeenAt: "2026-07-26T10:00:00Z", lastSeenAgeMs: 900 })];
    const second = [ready("node_a", { lastSeenAt: "2026-07-26T10:00:03Z", lastSeenAgeMs: 120 })];

    assert.equal(threadComputerSignature(first), threadComputerSignature(second));
    assert.notEqual(
      threadComputerSignature(first),
      threadComputerSignature([ready("node_a"), ready("node_b")]),
    );
  });
});

describe("team thread message input", () => {
  const teamMembers = [
    { id: "agent_lead", displayName: "Lead" },
    { id: "agent_support", displayName: "Support" },
  ];

  it("addresses the room when no member is mentioned", () => {
    const input = teamMessageInput({
      text: "one more pass",
      teamMembers,
      userMessageId: "evt_1",
    });

    assert.deepEqual(input, {
      text: "one more pass",
      intent: "accomplish",
      userMessageId: "evt_1",
      idempotencyKey: "evt_1",
    });
  });

  it("narrows to the mentioned member", () => {
    const input = teamMessageInput({
      text: "@Support take this",
      teamMembers,
      userMessageId: "evt_1",
    });

    assert.deepEqual(input, {
      text: "@Support take this",
      intent: "accomplish",
      addressAgentId: "agent_support",
      userMessageId: "evt_1",
      idempotencyKey: "evt_1",
    });
  });
});

describe("team mention candidates", () => {
  const employeeAgents = [
    { id: "agent_lead", displayName: "Lead" },
    { id: "agent_support", displayName: "Support" },
    { id: "agent_scout", displayName: "Scout" },
  ];

  it("only includes agents on the team roster, not every agent the employee owns", () => {
    const members = teamMembersForMention(["agent_lead", "agent_support"], employeeAgents);

    assert.deepEqual(members, [
      { id: "agent_lead", displayName: "Lead" },
      { id: "agent_support", displayName: "Support" },
    ]);
  });

  it("returns an empty list when the roster is missing (team not loaded/found)", () => {
    assert.deepEqual(teamMembersForMention(undefined, employeeAgents), []);
    assert.deepEqual(teamMembersForMention([], employeeAgents), []);
  });

  it("a mention naming an owned agent that is NOT on the team roster falls back to the room", () => {
    // Lead and Support are on the team; Scout is an agent the employee owns
    // but is not a member of this team.
    const members = teamMembersForMention(["agent_lead", "agent_support"], employeeAgents);

    const input = teamMessageInput({
      text: "@Scout can you look at this?",
      teamMembers: members,
      userMessageId: "evt_1",
    });

    // Unknown to the room, so the message runs the whole room instead of
    // narrowing to (and being rejected for) an outsider.
    assert.equal(input.addressAgentId, undefined);
    assert.equal(input.intent, "accomplish");
  });
});

describe("adaptive composer contract", () => {
  it("does not expose execution modes in the composer or handoff controls", () => {
    const composer = readFileSync("web/src/components/composer/Composer.tsx", "utf8");
    const handoff = readFileSync("web/src/components/composer/DecisionBar.tsx", "utf8");

    assert.doesNotMatch(composer, /ModeToggle|composerMode|setComposerMode/);
    assert.doesNotMatch(handoff, /handoffMode|setHandoffMode|modeOptions/);
  });
});
