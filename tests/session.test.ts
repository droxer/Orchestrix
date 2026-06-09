import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  type AgentState,
  type SandboxBackend,
  type SandboxRecord,
  type SandboxRunRequest,
  LocalSessionStore,
  LocalTaskStore,
  DaemonNodeRegistry,
  ReverseDaemonNodeBackend,
  SessionController,
  handleRelayDaemonRequest,
  handleRelayApiRequest,
  RelayDaemonClient,
  ensureDaemonNodeToken,
  initialAgentState,
  readDaemonNodeToken,
  relayEvent,
} from "../packages/relay-daemon/src/index.js";
import { createDaemonNodeLogger } from "../packages/relay-daemon-node/src/index.js";

function codexReviewStdout(message: string): string {
  return JSON.stringify({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: message,
    },
  }) + "\n";
}

class FakeSandboxBackend implements SandboxBackend {
  private sandboxes = new Map<string, SandboxRecord>();

  constructor(private readonly store: LocalSessionStore) {}

  async provision(input: { employeeId: string; workspacePath?: string }): Promise<SandboxRecord> {
    const now = new Date().toISOString();
    const sandbox: SandboxRecord = {
      id: `sbx_${input.employeeId}`,
      employeeId: input.employeeId,
      workspacePath: input.workspacePath,
      status: "ready",
      agents: { claude: "unknown", pi: "unknown", codex: "unknown" },
      createdAt: now,
      updatedAt: now,
    };
    this.sandboxes.set(sandbox.id, sandbox);
    return sandbox;
  }

  get(sandboxId: string): SandboxRecord | undefined {
    return this.sandboxes.get(sandboxId);
  }

  list(): SandboxRecord[] {
    return [...this.sandboxes.values()];
  }

  async run(sandboxId: string, request: SandboxRunRequest) {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) throw new Error("Sandbox not found.");
    const controller = new SessionController(this.store, {
      workspacePath: sandbox.workspacePath,
      execStream: async (_cmd, _args, options) => {
        const stdout = JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "Done." },
        }) + "\n";
        options?.stdoutRenderer?.(stdout);
        return { exit_code: 0, stdout, stderr: "" };
      },
    });
    const sessionId = request.sessionId ?? controller.createSession(
      request.taskGoal,
      ["human", ...request.assignments.map((item) => item.agent)],
    ).id;
    await controller.runAssignments(sessionId, request.taskGoal, request.assignments.map((assignment) => ({
      agent: assignment.agent,
      mode: assignment.mode ?? "implement",
    })));
    return this.store.getSession(sessionId);
  }
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

describe("Relay daemon node tokens", () => {
  it("generates and reuses a workspace token when no explicit token is provided", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "relay-node-token-"));
    const generated = ensureDaemonNodeToken({ workspacePath, employeeId: "alice" });
    const reused = ensureDaemonNodeToken({ workspacePath, employeeId: "alice" });

    assert.equal(generated.source, "generated");
    assert.match(generated.token, /^tok_/);
    assert.equal(readDaemonNodeToken(workspacePath, "alice"), generated.token);
    assert.equal(reused.source, "file");
    assert.equal(reused.token, generated.token);
  });

  it("sends the provided token when the daemon client provisions without a workspace", async () => {
    let authorization: string | null = null;
    let requestBody: any;
    const client = new RelayDaemonClient({
      baseUrl: "http://relay-daemon.test",
      token: "tok_alice",
      fetchFn: (async (_input, init) => {
        authorization = new Headers(init?.headers).get("authorization");
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          id: "sbx_alice",
          employeeId: "alice",
          workspacePath: "/workspace/alice",
          status: "ready",
          agents: { claude: "ready", pi: "ready", codex: "ready" },
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: "2026-06-07T00:00:00.000Z",
        }), { status: 201, headers: { "Content-Type": "application/json" } });
      }) as typeof fetch,
    });

    await client.provisionSandbox({ employeeId: "alice" });

    assert.deepEqual(requestBody, { employeeId: "alice" });
    assert.equal(authorization, "Bearer tok_alice");
  });
});

describe("Relay daemon node logging", () => {
  it("writes node and run scoped JSONL logs", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "relay-daemon-node-logs-"));
    const logger = createDaemonNodeLogger({ workspacePath, sandboxId: "sbx/logs" });

    logger.info("daemon node registered", { sandboxId: "sbx/logs", employeeId: "alice" });
    logger.output({
      sandboxId: "sbx/logs",
      commandId: "cmd_1",
      sessionId: "ses_1",
      runId: "run_1",
      agent: "codex",
      mode: "review",
      stream: "stdout",
      sequence: 0,
      text: "Codex output\n",
    });
    logger.error("run failed", {
      sandboxId: "sbx/logs",
      commandId: "cmd_1",
      sessionId: "ses_1",
      runId: "run_1",
      agent: "codex",
      mode: "review",
      error: "missing key",
    });

    const nodeLogPath = join(workspacePath, ".relay", "daemon-nodes", "logs", "sbx_logs.jsonl");
    const runLogPath = join(workspacePath, ".relay", "daemon-nodes", "logs", "run_1.jsonl");
    const nodeEntries = readFileSync(nodeLogPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const runEntries = readFileSync(runLogPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    assert.equal(logger.logPath, nodeLogPath);
    assert.equal(existsSync(runLogPath), true);
    assert.equal(nodeEntries.length, 3);
    assert.equal(nodeEntries[1].level, "output");
    assert.equal(nodeEntries[1].text, "Codex output\n");
    assert.equal(runEntries.length, 2);
    assert.deepEqual(runEntries.map((entry) => entry.message), ["agent output", "run failed"]);
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

describe("Relay daemon API", () => {
  it("advertises and serves the read-only daemon control panel", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-daemon-control-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ReverseDaemonNodeBackend(registry);

    const root = JSON.parse((await handleRelayDaemonRequest(backend, "GET", "/", undefined, registry)).body);
    const panel = await handleRelayDaemonRequest(backend, "GET", "/control", undefined, registry);
    const version = JSON.parse((await handleRelayDaemonRequest(backend, "GET", "/control/version", undefined, registry)).body);

    assert.equal(root.ui, true);
    assert.equal(root.uiPath, "/control");
    assert.equal(root.endpoints.includes("GET /control"), true);
    assert.equal(root.endpoints.includes("GET /control/version"), true);
    assert.equal(root.endpoints.includes("GET /daemon-nodes"), true);
    assert.equal(panel.status, 200);
    assert.equal(panel.contentType, "text/html; charset=utf-8");
    assert.match(panel.body, /Relay Daemon Control/);
    assert.match(panel.body, /\/daemon-nodes/);
    assert.match(panel.body, /\/control\/version/);
    assert.match(panel.body, /window\.location\.reload/);
    assert.equal(typeof version.version, "string");
    assert.notEqual(version.version, "");
  });

  it("provisions employee sandboxes and runs assignments through a sandbox backend", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-daemon-")));
    const backend = new FakeSandboxBackend(store);

    const created = JSON.parse((await handleRelayDaemonRequest(backend, "POST", "/sandboxes", {
      employeeId: "alice",
      workspacePath: "/workspace/alice",
    }, undefined, "tok_alice")).body);
    assert.equal(created.employeeId, "alice");
    assert.equal(created.status, "ready");

    const listed = JSON.parse((await handleRelayDaemonRequest(backend, "GET", "/sandboxes")).body);
    assert.equal(listed.sandboxes.length, 1);

    const run = JSON.parse((await handleRelayDaemonRequest(backend, "POST", `/sandboxes/${created.id}/runs`, {
      taskGoal: "implement search",
      assignments: [{ agent: "codex", mode: "implement" }],
    }, undefined, "tok_alice")).body);
    assert.equal(run.status, "completed");
    assert.equal(run.workspacePath, "/workspace/alice");
    assert.equal(run.agentRuns[0].agent, "codex");
  });

  it("rejects daemon runs without a task and valid assignment", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-daemon-invalid-")));
    const backend = new FakeSandboxBackend(store);
    const created = JSON.parse((await handleRelayDaemonRequest(backend, "POST", "/sandboxes", {
      employeeId: "bob",
    })).body);

    const response = await handleRelayDaemonRequest(backend, "POST", `/sandboxes/${created.id}/runs`, {
      taskGoal: " ",
      assignments: [{ agent: "codex" }],
    });

    assert.equal(response.status, 400);
    assert.match(response.body, /taskGoal/);
  });

  it("runs daemon handoffs against an existing session id", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-daemon-handoff-")));
    const backend = new FakeSandboxBackend(store);
    const created = JSON.parse((await handleRelayDaemonRequest(backend, "POST", "/sandboxes", {
      employeeId: "carol",
    })).body);
    const first = JSON.parse((await handleRelayDaemonRequest(backend, "POST", `/sandboxes/${created.id}/runs`, {
      taskGoal: "fix auth",
      assignments: [{ agent: "claude" }],
    })).body);

    const handoff = JSON.parse((await handleRelayDaemonRequest(backend, "POST", `/sandboxes/${created.id}/runs`, {
      taskGoal: "fix auth\n\nHandoff note:\nverify the fix",
      sessionId: first.id,
      assignments: [{ agent: "codex", mode: "review" }],
    })).body);

    assert.equal(handoff.id, first.id);
    assert.equal(handoff.agentRuns.length, 2);
    assert.equal(handoff.agentRuns[1].agent, "codex");
    assert.equal(handoff.agentRuns[1].mode, "review");
  });

  it("serves session API routes from the host daemon", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-daemon-session-api-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ReverseDaemonNodeBackend(registry);

    const created = await handleRelayDaemonRequest(backend, "POST", "/sessions", {
      taskGoal: "review auth",
      workspacePath: "/workspace/alice",
      assignments: [{ agent: "codex", mode: "review" }],
    }, registry);
    assert.equal(created.status, 201);
    const session = JSON.parse(created.body);

    const detail = await handleRelayDaemonRequest(backend, "GET", `/sessions/${session.id}`, undefined, registry);
    assert.equal(detail.status, 200);
    assert.equal(JSON.parse(detail.body).id, session.id);
  });

  it("requires the sandbox token for existing daemon node sandboxes", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-token-auth-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ReverseDaemonNodeBackend(registry);
    registry.register({
      sandboxId: "sbx_token",
      employeeId: "token",
      token: "tok_token",
      workspacePath: "/workspace/token",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });

    const missing = await handleRelayDaemonRequest(backend, "POST", "/sandboxes", {
      employeeId: "token",
      workspacePath: "/workspace/token",
    }, registry);
    const wrong = await handleRelayDaemonRequest(backend, "POST", "/sandboxes/sbx_token/runs", {
      taskGoal: "review auth",
      assignments: [{ agent: "codex", mode: "review" }],
    }, registry, "wrong");
    const ok = await handleRelayDaemonRequest(backend, "POST", "/sandboxes", {
      employeeId: "token",
      workspacePath: "/workspace/token",
    }, registry, "tok_token");

    assert.equal(missing.status, 401);
    assert.equal(wrong.status, 401);
    assert.equal(ok.status, 201);
    assert.equal(JSON.parse(ok.body).id, "sbx_token");
  });

  it("runs through a reverse-registered daemon node", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-reverse-daemon-node-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ReverseDaemonNodeBackend(registry);
    registry.register({
      sandboxId: "sbx_carol",
      employeeId: "carol",
      token: "tok_carol",
      workspacePath: "/workspace/carol",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });

    const sandbox = await backend.provision({ employeeId: "carol", workspacePath: "/workspace/carol", token: "tok_carol" });
    const pending = backend.run(sandbox.id, {
      taskGoal: "review auth",
      assignments: [{ agent: "codex", mode: "review" }],
    });
    const [command] = registry.takeCommands("sbx_carol", "tok_carol");

    assert.equal(command.type, "run.start");
    assert.equal(command.agent, "codex");
    assert.equal(command.mode, "review");

    registry.handleEvent("sbx_carol", {
      type: "run.output",
      commandId: command.id,
      sessionId: command.sessionId,
      runId: command.runId,
      agent: "codex",
      stream: "stdout",
      text: codexReviewStdout("Looks good.\nRELAY_REVIEW_VERDICT: APPROVED"),
      sequence: 0,
    }, "tok_carol");
    registry.handleEvent("sbx_carol", {
      type: "run.completed",
      commandId: command.id,
      sessionId: command.sessionId,
      runId: command.runId,
      agent: "codex",
      mode: "review",
      exitCode: 0,
      agentLog: "Looks good.",
      codexVerdict: "approved",
      codexFeedback: "Looks good.",
    }, "tok_carol");
    const session = await pending;

    assert.equal(session.status, "completed");
    assert.equal(session.workspacePath, "/workspace/carol");
    assert.equal(session.events.some((event: any) => event.type === "agent.output"), true);
    assert.equal(session.reviewVerdict, "approved");
  });

  it("runs Claude, Pi, and Codex assignments through one reverse daemon node", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-reverse-all-agents-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ReverseDaemonNodeBackend(registry);
    registry.register({
      sandboxId: "sbx_all_agents",
      employeeId: "all-agents",
      token: "tok_all_agents",
      workspacePath: "/workspace/all-agents",
      protocolVersion: 1,
      supportedAgents: ["claude", "pi", "codex"],
      status: "ready",
    });

    const pending = backend.run("sbx_all_agents", {
      taskGoal: "implement and verify auth",
      assignments: [
        { agent: "claude", mode: "implement" },
        { agent: "pi", mode: "implement" },
        { agent: "codex", mode: "review" },
      ],
    });

    const takeNextCommand = async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const [command] = registry.takeCommands("sbx_all_agents", "tok_all_agents");
        if (command) return command;
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      throw new Error("Timed out waiting for daemon node command.");
    };
    const completeNext = async (agent: "claude" | "pi" | "codex", text: string): Promise<void> => {
      const command = await takeNextCommand();
      assert.equal(command.agent, agent);
      registry.handleEvent("sbx_all_agents", {
        type: "run.output",
        commandId: command.id,
        sessionId: command.sessionId,
        runId: command.runId,
        agent,
        stream: "stdout",
        text,
        sequence: 0,
      }, "tok_all_agents");
      registry.handleEvent("sbx_all_agents", {
        type: "run.completed",
        commandId: command.id,
        sessionId: command.sessionId,
        runId: command.runId,
        agent,
        mode: command.mode,
        exitCode: 0,
        agentLog: `${agent} completed.`,
        codexVerdict: agent === "codex" ? "approved" : "",
        codexFeedback: agent === "codex" ? "Approved." : "",
      }, "tok_all_agents");
    };

    await completeNext("claude", "Claude implemented auth.\n");
    await completeNext("pi", "Pi checked auth.\n");
    await completeNext("codex", codexReviewStdout("Approved.\nRELAY_REVIEW_VERDICT: APPROVED"));
    const session = await pending;

    assert.equal(session.status, "completed");
    assert.deepEqual(session.agentRuns.map((run: any) => run.agent), ["claude", "pi", "codex"]);
    assert.deepEqual(session.agentRuns.map((run: any) => run.mode), ["implement", "implement", "review"]);
    assert.equal(session.events.filter((event: any) => event.type === "agent.output").length, 3);
    assert.equal(session.artifacts.length, 3);
    assert.equal(session.reviewVerdict, "approved");
    assert.equal(registry.get("sbx_all_agents")?.status, "ready");
  });

  it("cancels an active reverse daemon node run", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-reverse-cancel-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ReverseDaemonNodeBackend(registry);
    registry.register({
      sandboxId: "sbx_cancel",
      employeeId: "cancel",
      token: "tok_cancel",
      workspacePath: "/workspace/cancel",
      protocolVersion: 1,
      supportedAgents: ["claude", "pi", "codex"],
      status: "ready",
    });

    const pending = backend.run("sbx_cancel", {
      taskGoal: "long running task",
      assignments: [{ agent: "claude", mode: "implement" }],
    });
    const [startCommand] = registry.takeCommands("sbx_cancel", "tok_cancel");
    assert.equal(startCommand.type, "run.start");

    await backend.cancelRun("sbx_cancel", startCommand.sessionId, "Cancelled by test.");
    const [cancelCommand] = registry.takeCommands("sbx_cancel", "tok_cancel");
    assert.equal(cancelCommand.type, "run.cancel");
    assert.equal(cancelCommand.commandId, startCommand.id);
    assert.equal(cancelCommand.reason, "Cancelled by test.");

    registry.handleEvent("sbx_cancel", {
      type: "run.cancelled",
      commandId: startCommand.id,
      sessionId: startCommand.sessionId,
      runId: startCommand.runId,
      agent: "claude",
      mode: "implement",
      reason: "Cancelled by test.",
    }, "tok_cancel");
    const session = await pending;

    assert.equal(session.status, "cancelled");
    assert.equal(session.agentRuns[0].status, "cancelled");
    assert.equal(session.decisions.at(-1)?.kind, "cancel");
    assert.equal(registry.get("sbx_cancel")?.status, "ready");
    assert.equal(registry.get("sbx_cancel")?.lastError, "Cancelled by test.");
    assert.equal(registry.monitorNodes()[0].activeRuns.length, 0);
  });

  it("runs multiple daemon nodes concurrently with isolated command queues", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-concurrent-daemon-nodes-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ReverseDaemonNodeBackend(registry);
    registry.register({
      sandboxId: "sbx_alice",
      employeeId: "alice",
      token: "tok_alice",
      workspacePath: "/workspace/alice",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });
    registry.register({
      sandboxId: "sbx_bob",
      employeeId: "bob",
      token: "tok_bob",
      workspacePath: "/workspace/bob",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });

    const aliceRun = backend.run("sbx_alice", {
      taskGoal: "review alice",
      assignments: [{ agent: "codex", mode: "review" }],
    });
    const bobRun = backend.run("sbx_bob", {
      taskGoal: "review bob",
      assignments: [{ agent: "codex", mode: "review" }],
    });
    const [aliceCommand] = registry.takeCommands("sbx_alice", "tok_alice");
    const [bobCommand] = registry.takeCommands("sbx_bob", "tok_bob");

    assert.equal(registry.get("sbx_alice")?.status, "running");
    assert.equal(registry.get("sbx_bob")?.status, "running");
    assert.equal(aliceCommand.type, "run.start");
    assert.equal(bobCommand.type, "run.start");
    assert.equal(aliceCommand.taskGoal, "review alice");
    assert.equal(bobCommand.taskGoal, "review bob");
    assert.equal(registry.takeCommands("sbx_alice", "tok_alice").length, 0);
    assert.equal(registry.takeCommands("sbx_bob", "tok_bob").length, 0);

    registry.handleEvent("sbx_bob", {
      type: "run.completed",
      commandId: bobCommand.id,
      sessionId: bobCommand.sessionId,
      runId: bobCommand.runId,
      agent: "codex",
      mode: "review",
      exitCode: 0,
      agentLog: "Bob approved.",
      codexVerdict: "approved",
      codexFeedback: "Bob approved.",
    }, "tok_bob");
    registry.handleEvent("sbx_alice", {
      type: "run.completed",
      commandId: aliceCommand.id,
      sessionId: aliceCommand.sessionId,
      runId: aliceCommand.runId,
      agent: "codex",
      mode: "review",
      exitCode: 0,
      agentLog: "Alice approved.",
      codexVerdict: "approved",
      codexFeedback: "Alice approved.",
    }, "tok_alice");

    const [aliceSession, bobSession] = await Promise.all([aliceRun, bobRun]);
    assert.equal(aliceSession.workspacePath, "/workspace/alice");
    assert.equal(bobSession.workspacePath, "/workspace/bob");
    assert.equal(aliceSession.reviewVerdict, "approved");
    assert.equal(bobSession.reviewVerdict, "approved");
    assert.equal(registry.get("sbx_alice")?.status, "ready");
    assert.equal(registry.get("sbx_bob")?.status, "ready");
  });

  it("rejects concurrent runs on the same daemon node", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-same-daemon-node-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ReverseDaemonNodeBackend(registry);
    registry.register({
      sandboxId: "sbx_single",
      employeeId: "single",
      token: "tok_single",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });

    const firstRun = backend.run("sbx_single", {
      taskGoal: "first",
      assignments: [{ agent: "codex", mode: "review" }],
    });
    const [command] = registry.takeCommands("sbx_single", "tok_single");
    await assert.rejects(
      backend.run("sbx_single", {
        taskGoal: "second",
        assignments: [{ agent: "codex", mode: "review" }],
      }),
      /daemon node is not ready/,
    );

    registry.handleEvent("sbx_single", {
      type: "run.completed",
      commandId: command.id,
      sessionId: command.sessionId,
      runId: command.runId,
      agent: "codex",
      mode: "review",
      exitCode: 0,
      agentLog: "Approved.",
      codexVerdict: "approved",
      codexFeedback: "Approved.",
    }, "tok_single");
    const session = await firstRun;
    assert.equal(session.status, "completed");
    assert.equal(registry.get("sbx_single")?.status, "ready");
  });

  it("rejects unauthorized reverse daemon node command polling", () => {
    const registry = new DaemonNodeRegistry(new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-auth-"))));
    registry.register({
      sandboxId: "sbx_auth",
      employeeId: "auth",
      token: "secret",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });

    assert.throws(() => registry.takeCommands("sbx_auth", "wrong"), /Unauthorized/);
  });

  it("allows authorized daemon node command polling through the HTTP route", async () => {
    const registry = new DaemonNodeRegistry(new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-auth-route-"))));
    const backend = new ReverseDaemonNodeBackend(registry);
    await handleRelayDaemonRequest(backend, "POST", "/daemon-nodes/register", {
      sandboxId: "sbx_route",
      employeeId: "route",
      token: "route_secret",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    }, registry);

    const response = await handleRelayDaemonRequest(
      backend,
      "GET",
      "/daemon-nodes/sbx_route/commands",
      undefined,
      registry,
      "route_secret",
    );

    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { commands: [] });
  });

  it("persists daemon node registrations across daemon registry restarts", async () => {
    const root = mkdtempSync(join(tmpdir(), "relay-daemon-node-storage-"));
    const first = new DaemonNodeRegistry(new LocalSessionStore(root));
    first.register({
      sandboxId: "sbx_persisted",
      employeeId: "persisted",
      token: "tok_persisted",
      workspacePath: "/workspace/persisted",
      protocolVersion: 1,
      supportedAgents: ["claude", "codex"],
      status: "ready",
    });

    const restarted = new DaemonNodeRegistry(new LocalSessionStore(root));
    const backend = new ReverseDaemonNodeBackend(restarted);
    const loaded = restarted.get("sbx_persisted");
    const provisioned = await backend.provision({ employeeId: "persisted", token: "tok_persisted" });

    assert.equal(loaded?.employeeId, "persisted");
    assert.equal(loaded?.workspacePath, "/workspace/persisted");
    assert.equal(loaded?.status, "stopped");
    assert.equal(loaded?.token, undefined);
    assert.equal(typeof loaded?.tokenHash, "string");
    assert.equal(provisioned.id, "sbx_persisted");
    assert.equal(provisioned.status, "stopped");
    await assert.rejects(
      backend.run("sbx_persisted", {
        taskGoal: "review after restart",
        assignments: [{ agent: "codex", mode: "review" }],
      }),
      /daemon node is not ready/,
    );
  });

  it("persists queued daemon node commands across registry restarts", () => {
    const root = mkdtempSync(join(tmpdir(), "relay-daemon-queued-command-"));
    const first = new DaemonNodeRegistry(new LocalSessionStore(root));
    first.register({
      sandboxId: "sbx_queue",
      employeeId: "queue",
      token: "tok_queue",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });
    first.enqueue("sbx_queue", {
      id: "cmd_queue",
      type: "run.start",
      sessionId: "ses_queue",
      runId: "run_queue",
      taskGoal: "queued review",
      agent: "codex",
      mode: "review",
    });

    const restarted = new DaemonNodeRegistry(new LocalSessionStore(root));
    const [command] = restarted.takeCommands("sbx_queue", "tok_queue");
    const afterTake = restarted.takeCommands("sbx_queue", "tok_queue");

    assert.equal(command.id, "cmd_queue");
    assert.equal(command.sessionId, "ses_queue");
    assert.equal(command.runId, "run_queue");
    assert.deepEqual(afterTake, []);
  });

  it("does not redispatch completed daemon node commands after restart", () => {
    const root = mkdtempSync(join(tmpdir(), "relay-daemon-completed-command-"));
    const store = new LocalSessionStore(root);
    const session = store.createSession({ workspacePath: "/workspace", taskGoal: "completed command" });
    const first = new DaemonNodeRegistry(store);
    first.register({
      sandboxId: "sbx_done",
      employeeId: "done",
      token: "tok_done",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });
    first.enqueue("sbx_done", {
      id: "cmd_done",
      type: "run.start",
      sessionId: session.id,
      runId: "run_done",
      taskGoal: "completed review",
      agent: "codex",
      mode: "review",
    });
    const [command] = first.takeCommands("sbx_done", "tok_done");
    first.handleEvent("sbx_done", {
      type: "run.completed",
      commandId: command.id,
      sessionId: command.sessionId,
      runId: command.runId,
      agent: "codex",
      mode: "review",
      exitCode: 0,
      agentLog: "Approved.",
      codexVerdict: "approved",
      codexFeedback: "Approved.",
    }, "tok_done");

    const restarted = new DaemonNodeRegistry(new LocalSessionStore(root));

    assert.deepEqual(restarted.takeCommands("sbx_done", "tok_done"), []);
  });

  it("keeps daemon run output in session events without duplicating it into daemon monitor records", () => {
    const root = mkdtempSync(join(tmpdir(), "relay-daemon-output-storage-"));
    const store = new LocalSessionStore(root);
    const session = store.createSession({ workspacePath: "/workspace", taskGoal: "stream output" });
    const registry = new DaemonNodeRegistry(store);
    registry.register({
      sandboxId: "sbx_output",
      employeeId: "output",
      token: "tok_output",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });
    registry.enqueue("sbx_output", {
      id: "cmd_output",
      type: "run.start",
      sessionId: session.id,
      runId: "run_output",
      taskGoal: "stream output",
      agent: "codex",
      mode: "implement",
    });
    const [command] = registry.takeCommands("sbx_output", "tok_output");

    registry.handleEvent("sbx_output", {
      type: "run.output",
      commandId: command.id,
      sessionId: command.sessionId,
      runId: command.runId,
      agent: "codex",
      stream: "stdout",
      text: "hello",
      sequence: 1,
    }, "tok_output");

    const outputEvent = store.getSession(session.id).events.find((event) => event.type === "agent.output");
    const activeRun = registry.monitorNodes()[0].activeRuns[0];

    assert.equal(outputEvent?.type, "agent.output");
    assert.equal(outputEvent && "text" in outputEvent ? outputEvent.text : "", "hello");
    assert.equal("text" in activeRun, false);
  });

  it("lists sanitized daemon node monitor records without tokens", async () => {
    const registry = new DaemonNodeRegistry(new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-monitor-list-"))));
    const backend = new ReverseDaemonNodeBackend(registry);
    await handleRelayDaemonRequest(backend, "POST", "/daemon-nodes/register", {
      sandboxId: "sbx_monitor",
      employeeId: "monitor",
      token: "monitor_secret",
      workspacePath: "/workspace/monitor",
      protocolVersion: 1,
      supportedAgents: ["claude", "codex"],
      status: "ready",
    }, registry);

    const response = await handleRelayDaemonRequest(backend, "GET", "/daemon-nodes", undefined, registry);
    const body = JSON.parse(response.body);

    assert.equal(response.status, 200);
    assert.equal(body.nodes.length, 1);
    assert.equal(body.nodes[0].id, "sbx_monitor");
    assert.equal(body.nodes[0].employeeId, "monitor");
    assert.equal(body.nodes[0].workspacePath, "/workspace/monitor");
    assert.equal(body.nodes[0].agents.claude, "ready");
    assert.equal(body.nodes[0].agents.codex, "ready");
    assert.equal(body.nodes[0].queuedCommandCount, 0);
    assert.deepEqual(body.nodes[0].activeRuns, []);
    assert.equal("token" in body.nodes[0], false);
    assert.equal("tokenHash" in body.nodes[0], false);
    assert.equal(typeof body.nodes[0].lastSeenAt, "string");
  });

  it("tracks daemon node command polling and in-flight runs for monitoring", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-monitor-active-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ReverseDaemonNodeBackend(registry);
    registry.register({
      sandboxId: "sbx_active",
      employeeId: "active",
      token: "tok_active",
      workspacePath: "/workspace/active",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });

    const registeredLastSeenAt = registry.monitorNodes()[0].lastSeenAt;
    await new Promise((resolve) => setTimeout(resolve, 2));
    const pending = backend.run("sbx_active", {
      taskGoal: "review active run",
      assignments: [{ agent: "codex", mode: "review" }],
    });
    const queued = registry.monitorNodes()[0];
    const [command] = registry.takeCommands("sbx_active", "tok_active");
    const active = registry.monitorNodes()[0];

    assert.equal(queued.queuedCommandCount, 1);
    assert.equal(active.queuedCommandCount, 0);
    assert.notEqual(active.lastSeenAt, registeredLastSeenAt);
    assert.equal(active.activeRuns.length, 1);
    assert.equal(active.activeRuns[0].commandId, command.id);
    assert.equal(active.activeRuns[0].sessionId, command.sessionId);
    assert.equal(active.activeRuns[0].agent, "codex");
    assert.equal(active.activeRuns[0].mode, "review");
    assert.equal(active.activeRuns[0].taskGoal, "review active run");

    registry.handleEvent("sbx_active", {
      type: "run.completed",
      commandId: command.id,
      sessionId: command.sessionId,
      runId: command.runId,
      agent: "codex",
      mode: "review",
      exitCode: 0,
      agentLog: "Approved.",
      codexVerdict: "approved",
      codexFeedback: "Approved.",
    }, "tok_active");

    const session = await pending;
    assert.equal(session.status, "completed");
    assert.equal(registry.monitorNodes()[0].activeRuns.length, 0);
  });

  it("clears persisted daemon active runs after command timeout", async () => {
    const root = mkdtempSync(join(tmpdir(), "relay-monitor-timeout-"));
    const store = new LocalSessionStore(root);
    const registry = new DaemonNodeRegistry(store);
    registry.register({
      sandboxId: "sbx_timeout",
      employeeId: "timeout",
      token: "tok_timeout",
      workspacePath: "/workspace/timeout",
      protocolVersion: 1,
      supportedAgents: ["pi"],
      status: "ready",
    });
    const session = store.createSession({ workspacePath: "/workspace/timeout", taskGoal: "timeout run" });
    registry.enqueue("sbx_timeout", {
      id: "cmd_timeout",
      type: "run.start",
      sessionId: session.id,
      runId: "run_timeout",
      taskGoal: "timeout run",
      agent: "pi",
      mode: "implement",
      workspacePath: "/workspace/timeout",
    });
    const [command] = registry.takeCommands("sbx_timeout", "tok_timeout");

    await assert.rejects(
      registry.waitForCompletion(command.id, 1),
      /timed out/,
    );

    assert.equal(registry.monitorNodes()[0].activeRuns.length, 0);
    const restarted = new DaemonNodeRegistry(new LocalSessionStore(root));
    assert.equal(restarted.monitorNodes()[0].activeRuns.length, 0);
  });

  it("keeps the daemon node ready after a reported run failure", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-run-failed-ready-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ReverseDaemonNodeBackend(registry);
    registry.register({
      sandboxId: "sbx_failed_ready",
      employeeId: "failed-ready",
      token: "tok_failed_ready",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });
    const pending = backend.run("sbx_failed_ready", {
      taskGoal: "implement auth",
      assignments: [{ agent: "codex", mode: "implement" }],
    });
    const [command] = registry.takeCommands("sbx_failed_ready", "tok_failed_ready");
    registry.handleEvent("sbx_failed_ready", {
      type: "run.failed",
      commandId: command.id,
      sessionId: command.sessionId,
      runId: command.runId,
      agent: "codex",
      mode: "implement",
      error: "Missing OPENAI_API_KEY.",
    }, "tok_failed_ready");

    const session = await pending;
    assert.equal(session.status, "failed");
    assert.equal(registry.get("sbx_failed_ready")?.status, "ready");
    assert.equal(registry.get("sbx_failed_ready")?.lastError, "Missing OPENAI_API_KEY.");
  });

  it("fails reverse Codex review sessions when the verdict is rejected", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-reverse-rejected-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ReverseDaemonNodeBackend(registry);
    registry.register({
      sandboxId: "sbx_review",
      employeeId: "review",
      token: "tok_review",
      workspacePath: "/workspace/review",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });
    const pending = backend.run("sbx_review", {
      taskGoal: "review auth",
      assignments: [{ agent: "codex", mode: "review" }],
    });
    const [command] = registry.takeCommands("sbx_review", "tok_review");
    registry.handleEvent("sbx_review", {
      type: "run.completed",
      commandId: command.id,
      sessionId: command.sessionId,
      runId: command.runId,
      agent: "codex",
      mode: "review",
      exitCode: 0,
      agentLog: "Blocking issue.",
      codexVerdict: "rejected",
      codexFeedback: "Blocking issue.",
    }, "tok_review");

    const session = await pending;
    assert.equal(session.status, "failed");
    assert.equal(session.reviewVerdict, "rejected");
    assert.equal(session.finalOutcome, "Codex rejected the work.");
    assert.equal(registry.get("sbx_review")?.status, "ready");
  });
});
