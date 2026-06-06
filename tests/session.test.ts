import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  type AgentState,
  LocalSessionStore,
  LocalTaskStore,
  SessionController,
  handleRelayApiRequest,
  initialAgentState,
  relayEvent,
} from "../src/relay.js";

function codexReviewStdout(message: string): string {
  return JSON.stringify({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: message,
    },
  }) + "\n";
}

describe("Relay session store", () => {
  it("persists append-only events and materialized snapshots", () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-sessions-")));
    const created = store.createSession({
      workspacePath: "/workspace",
      taskGoal: "fix auth",
      participants: ["human", "claude"],
      status: "pending_approval",
      pendingDecision: "start",
    });

    const approved = store.appendEvent(created.id, relayEvent("human.decision", created.id, {
      decision: {
        id: "dec_test",
        kind: "approve",
        createdAt: "2026-06-05T00:00:00.000Z",
      },
    }));

    assert.equal(approved.id, created.id);
    assert.equal(approved.taskGoal, "fix auth");
    assert.equal(approved.events.length, 3);
    assert.equal(store.getSession(created.id).decisions[0].kind, "approve");
    assert.equal(store.listSessions()[0].id, created.id);
  });

  it("writes artifacts and links them to session state", () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-artifacts-")));
    const session = store.createSession({ workspacePath: "/workspace", taskGoal: "review diff" });
    const artifact = store.writeArtifact(session.id, {
      kind: "review",
      title: "Codex review",
      body: "Looks good.",
      extension: "md",
    });
    const updated = store.appendEvent(session.id, relayEvent("artifact.created", session.id, { artifact }));

    assert.equal(updated.artifacts[0].id, artifact.id);
    assert.equal(store.readArtifact(session.id, artifact.id), "Looks good.");
  });
});

describe("Relay task store", () => {
  it("persists tasks, assignment, status, activity, and linked sessions", () => {
    const store = new LocalTaskStore(mkdtempSync(join(tmpdir(), "relay-tasks-")));
    const created = store.createTask({
      title: "Add Kanban board",
      description: "Show backlog and agent state.",
      priority: "high",
    });

    let updated = store.assignTask(created.id, "codex");
    updated = store.linkSession(updated.id, "ses_test");
    updated = store.updateTask(updated.id, { status: "running" });

    assert.equal(updated.title, "Add Kanban board");
    assert.equal(updated.priority, "high");
    assert.equal(updated.assignedAgent, "codex");
    assert.equal(updated.status, "running");
    assert.deepEqual(updated.linkedSessionIds, ["ses_test"]);
    assert.equal(updated.activity.some((item) => item.message.includes("Assigned to codex")), true);
    assert.equal(store.getTask(created.id).events.some((event) => event.type === "task.session_linked"), true);
  });
});

describe("Relay session controller", () => {
  it("captures agent runs, output events, artifacts, and completion", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-controller-")));
    const controller = new SessionController(store, {
      execStream: async (_cmd, _args, options) => {
        const stdout = JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "Done." },
        }) + "\n";
        options?.stdoutRenderer?.(stdout);
        return {
          exit_code: 0,
          stdout,
          stderr: "",
        };
      },
    });
    const session = controller.createSession("implement search");

    const state = await controller.runStep(session.id, initialAgentState(session.taskGoal), {
      agent: "codex",
      mode: "implement",
    });
    const updated = store.getSession(session.id);

    assert.equal(state.last_exit_code, 0);
    assert.equal(updated.agentRuns.length, 1);
    assert.equal(updated.agentRuns[0].agent, "codex");
    assert.equal(updated.artifacts.length, 1);
    assert.equal(updated.events.some((event) => event.type === "agent.output"), true);
    assert.equal(updated.events.some((event) => event.type === "agent.completed"), true);
  });

  it("reopens a completed session when it is handed off", () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-handoff-agent-")));
    const controller = new SessionController(store);
    const session = controller.createSession("fix auth");
    controller.completeSession(session.id, "Assignments completed.");

    const updated = controller.recordDecision(session.id, "handoff", "Review the fix.", "codex");

    assert.equal(updated.status, "running");
    assert.equal(updated.phase, "handoff:codex");
    assert.equal(updated.pendingDecision, undefined);
    assert.equal(updated.currentAgent, "codex");
    assert.equal(updated.finalOutcome, undefined);
    assert.equal(updated.decisions.at(-1)?.targetAgent, "codex");
  });

  it("updates linked task state from agent execution events", async () => {
    const root = mkdtempSync(join(tmpdir(), "relay-linked-task-"));
    const sessionStore = new LocalSessionStore(root);
    const taskStore = new LocalTaskStore(root);
    const task = taskStore.createTask({ title: "Implement task board" });
    const controller = new SessionController(sessionStore, {
      taskStore,
      taskId: task.id,
      execStream: async (_cmd, _args, options) => {
        const stdout = JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "Done." },
        }) + "\n";
        options?.stdoutRenderer?.(stdout);
        return {
          exit_code: 0,
          stdout,
          stderr: "",
        };
      },
    });
    const session = controller.createSession("implement task board");

    await controller.runAssignments(session.id, session.taskGoal, [{ agent: "codex", mode: "implement" }]);
    const updated = taskStore.getTask(task.id);

    assert.equal(updated.status, "done");
    assert.deepEqual(updated.linkedSessionIds, [session.id]);
    assert.equal(updated.activity.some((item) => item.message.includes("codex implement started")), true);
    assert.equal(updated.activity.some((item) => item.message.includes("Assignments completed")), true);
  });

  it("does not complete assignments after a rejected Codex handoff review", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-rejected-review-")));
    const controller = new SessionController(store, {
      execStream: async (_cmd, _args, options) => {
        const stdout = codexReviewStdout("Blocking issue found.\nRELAY_REVIEW_VERDICT: REJECTED");
        options?.stdoutRenderer?.(stdout);
        return {
          exit_code: 0,
          stdout,
          stderr: "",
        };
      },
    });
    const session = controller.createSession("review auth fix");

    const state = await controller.runAssignments(session.id, session.taskGoal, [{ agent: "codex", mode: "review" }]);
    const updated = store.getSession(session.id);

    assert.equal(state.codex_verdict, "rejected");
    assert.equal(updated.status, "failed");
    assert.equal(updated.phase, "failed");
    assert.equal(updated.reviewVerdict, "rejected");
    assert.equal(updated.finalOutcome, "Codex rejected the work.");
    assert.equal(updated.events.some((event) => event.type === "session.completed"), false);
  });
});

describe("Relay read-only HTTP API", () => {
  it("serves an API index at the root route without a web UI", () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-web-")));
    const taskStore = new LocalTaskStore(mkdtempSync(join(tmpdir(), "relay-web-tasks-")));
    const response = handleRelayApiRequest(store, "GET", "/", undefined, taskStore);
    const body = JSON.parse(response.body);

    assert.equal(response.status, 200);
    assert.equal(response.contentType, "application/json; charset=utf-8");
    assert.equal(body.name, "Relay API");
    assert.equal(body.ui, false);
    assert.equal(body.endpoints.includes("GET /tasks"), true);
    assert.doesNotMatch(response.body, /<html/i);
  });

  it("creates, updates, assigns, picks up, and serves task events", () => {
    const root = mkdtempSync(join(tmpdir(), "relay-task-api-"));
    const store = new LocalSessionStore(root);
    const taskStore = new LocalTaskStore(root);
    const created = JSON.parse(handleRelayApiRequest(store, "POST", "/tasks", {
      title: "Add task board",
      description: "Build backlog and Kanban.",
      priority: "high",
    }, taskStore).body);

    assert.equal(created.status, "backlog");
    assert.equal(created.priority, "high");

    const assigned = JSON.parse(handleRelayApiRequest(store, "POST", `/tasks/${created.id}/assign`, {
      agent: "claude",
    }, taskStore).body);
    assert.equal(assigned.status, "assigned");
    assert.equal(assigned.assignedAgent, "claude");

    const patched = JSON.parse(handleRelayApiRequest(store, "PATCH", `/tasks/${created.id}`, {
      status: "review",
      priority: "normal",
    }, taskStore).body);
    assert.equal(patched.status, "review");
    assert.equal(patched.priority, "normal");

    const pickedUp = JSON.parse(handleRelayApiRequest(store, "POST", `/tasks/${created.id}/pickup`, {
      agent: "codex",
      mode: "review",
    }, taskStore).body);
    assert.equal(pickedUp.task.status, "assigned");
    assert.equal(pickedUp.task.assignedAgent, "codex");
    assert.equal(pickedUp.task.linkedSessionIds.length, 1);
    assert.equal(pickedUp.session.status, "pending_approval");

    const list = JSON.parse(handleRelayApiRequest(store, "GET", "/tasks", undefined, taskStore).body);
    const events = JSON.parse(handleRelayApiRequest(store, "GET", `/tasks/${created.id}/events`, undefined, taskStore).body);
    assert.equal(list.tasks.length, 1);
    assert.equal(events.events.some((event: any) => event.type === "task.session_linked"), true);
  });

  it("creates, assigns, approves, and hands off real task sessions", () => {
    const root = mkdtempSync(join(tmpdir(), "relay-session-api-"));
    const store = new LocalSessionStore(root);
    const taskStore = new LocalTaskStore(root);
    const created = JSON.parse(handleRelayApiRequest(store, "POST", "/sessions", {
      taskGoal: "Add upload progress tracking",
      assignments: [
        { agent: "claude", mode: "implement" },
        { agent: "codex", mode: "review" },
      ],
    }, taskStore).body);

    assert.equal(created.status, "pending_approval");
    assert.equal(created.pendingDecision, "start");
    assert.equal(created.artifacts.some((artifact: any) => artifact.kind === "plan"), true);

    const assigned = JSON.parse(handleRelayApiRequest(store, "POST", `/sessions/${created.id}/assignments`, {
      assignments: [{ agent: "pi", mode: "implement", role: "tester" }],
    }, taskStore).body);
    assert.equal(assigned.status, "pending_approval");
    assert.equal(assigned.artifacts.filter((artifact: any) => artifact.kind === "plan").length, 2);

    const approved = JSON.parse(handleRelayApiRequest(store, "POST", `/sessions/${created.id}/decisions`, {
      kind: "approve",
      note: "Start implementation.",
    }, taskStore).body);
    assert.equal(approved.status, "running");
    assert.equal(approved.decisions.some((decision: any) => decision.kind === "approve"), true);

    const handedOff = JSON.parse(handleRelayApiRequest(store, "POST", `/sessions/${created.id}/handoffs`, {
      targetAgent: "codex",
      note: "Review after implementation.",
    }, taskStore).body);
    assert.equal(handedOff.status, "pending_approval");
    assert.equal(handedOff.phase, "handoff:codex");
    assert.equal(handedOff.decisions.some((decision: any) => decision.kind === "handoff" && decision.targetAgent === "codex"), true);
    assert.equal(handedOff.artifacts.filter((artifact: any) => artifact.kind === "plan").length, 3);
    const handoffPlan = JSON.parse(store.readArtifact(created.id, handedOff.artifacts.at(-1).id));
    assert.deepEqual(handoffPlan.assignments, [{ agent: "codex", mode: "review" }]);
  });

  it("serves sessions, session detail, artifacts, and SSE events", async () => {
    const root = mkdtempSync(join(tmpdir(), "relay-api-"));
    const store = new LocalSessionStore(root);
    const taskStore = new LocalTaskStore(root);
    const session = store.createSession({ workspacePath: "/workspace", taskGoal: "ship api" });
    const artifact = store.writeArtifact(session.id, {
      kind: "summary",
      title: "Summary",
      body: "API ready.",
    });
    store.appendEvent(session.id, relayEvent("artifact.created", session.id, { artifact }));
    const list = JSON.parse(handleRelayApiRequest(store, "GET", "/sessions", undefined, taskStore).body);
    const detail = JSON.parse(handleRelayApiRequest(store, "GET", `/sessions/${session.id}`, undefined, taskStore).body);
    const events = handleRelayApiRequest(store, "GET", `/sessions/${session.id}/events`, undefined, taskStore);
    const body = handleRelayApiRequest(store, "GET", `/sessions/${session.id}/artifacts/${artifact.id}`, undefined, taskStore);

    assert.equal(list.sessions.length, 1);
    assert.equal(detail.id, session.id);
    assert.equal(events.sse, true);
    assert.match(events.body, /event: session\.created/);
    assert.equal(body.body, "API ready.");
  });
});
