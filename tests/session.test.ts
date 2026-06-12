import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  type AgentState,
  type SandboxBackend,
  type SandboxRecord,
  type SandboxRunRequest,
  LocalSessionStore,
  LocalDaemonStore,
  LocalSandboxBackend,
  LocalTaskStore,
  DaemonNodeRegistry,
  ServerDaemonNodeBackend,
  SessionController,
  handleRelayDaemonRequest,
  handleRelayApiRequest,
  RelayDaemonClient,
  initialAgentState,
  relayEvent,
} from "../packages/relay-daemon/src/index.js";
import { createDaemonNodeLogger } from "../packages/relay-daemon-node/src/index.js";
import { ensureDaemonNodeToken, readDaemonNodeToken } from "../packages/relay-core/src/index.js";
import {
  createSession as createWebSession,
  listControlPanelDaemonNodes as listWebControlPanelDaemonNodes,
  listDaemonNodes as listWebDaemonNodes,
  listSandboxes as listWebSandboxes,
  listSessions as listWebSessions,
  provisionSandbox as provisionWebSandbox,
  runSandbox as runWebSandbox,
} from "../packages/relay-web/src/api.js";

function codexReviewStdout(message: string): string {
  return JSON.stringify({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: message,
    },
  }) + "\n";
}

async function takeCommandEventually(registry: DaemonNodeRegistry, sandboxId: string, token: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const [command] = await registry.takeCommands(sandboxId, token);
    if (command) return command;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`Timed out waiting for daemon node command for ${sandboxId}.`);
}

async function monitorNodeEventually(
  registry: DaemonNodeRegistry,
  sandboxId: string,
  predicate: (node: Awaited<ReturnType<DaemonNodeRegistry["monitorNodes"]>>[number]) => boolean,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const node = (await registry.monitorNodes()).find((item) => item.id === sandboxId);
    if (node && predicate(node)) return node;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`Timed out waiting for daemon node monitor state for ${sandboxId}.`);
}

class FakeSandboxBackend implements SandboxBackend {
  private sandboxes = new Map<string, SandboxRecord>();

  constructor(private readonly store: LocalSessionStore) {}

  async provision(input: { employeeId: string; workspacePath?: string; token?: string }): Promise<SandboxRecord> {
    const now = new Date().toISOString();
    const sandbox: SandboxRecord = {
      id: `sbx_${input.employeeId}`,
      employeeId: input.employeeId,
      workspacePath: input.workspacePath,
      status: "ready",
      agents: { claude: "unknown", pi: "unknown", codex: "unknown" },
      token: input.token,
      createdAt: now,
      updatedAt: now,
    };
    this.sandboxes.set(sandbox.id, sandbox);
    return sandbox;
  }

  async get(sandboxId: string): Promise<SandboxRecord | undefined> {
    return this.sandboxes.get(sandboxId);
  }

  async list(): Promise<SandboxRecord[]> {
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
    const sessionId = request.sessionId ?? (await controller.createSession(
      request.taskGoal,
      ["human", ...request.assignments.map((item) => item.agent)],
    )).id;
    await controller.runAssignments(sessionId, request.taskGoal, request.assignments.map((assignment) => ({
      agent: assignment.agent,
      mode: assignment.mode ?? "implement",
    })));
    return this.store.getSession(sessionId);
  }
}

describe("Project command scripts", () => {
  it("keeps builds explicit while running dist-backed entrypoints", async () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    const makefile = readFileSync("Makefile", "utf8");

    assert.equal(packageJson.scripts.run, "npm run build && node packages/relay-tui/dist/local-run.js");
    assert.match(makefile, /^build:\n\tnpm run build$/m);
    assert.equal((makefile.match(/\bnpm run build\b/g) ?? []).length, 1);
    assert.match(makefile, /^test:\n\tnpm test$/m);
    assert.match(makefile, /^tui-local:$/m);
    assert.match(makefile, /^tui:$/m);
    assert.match(makefile, /^run: tui$/m);
    assert.match(makefile, /node packages\/relay-tui\/dist\/local-run\.js/);
    assert.match(makefile, /node packages\/relay-tui\/dist\/cli\.js/);
    assert.match(makefile, /^daemon-local:$/m);
    assert.match(makefile, /^daemon-server:$/m);
    assert.match(makefile, /^daemon: daemon-server$/m);
    assert.match(makefile, /^daemon-node:$/m);
    assert.match(makefile, /^serve:$/m);
  });
});

describe("Relay session store", () => {
  it("persists append-only events and materialized snapshots", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-sessions-")));
    const created = await store.createSession({
      workspacePath: "/workspace",
      taskGoal: "fix auth",
      participants: ["human", "claude"],
      status: "pending_approval",
      pendingDecision: "start",
    });

    const approved = await store.appendEvent(created.id, relayEvent("human.decision", created.id, {
      decision: {
        id: "dec_test",
        kind: "approve",
        createdAt: "2026-06-05T00:00:00.000Z",
      },
    }));

    assert.equal(approved.id, created.id);
    assert.equal(approved.taskGoal, "fix auth");
    assert.equal(approved.events.length, 3);
    assert.equal((await store.getSession(created.id)).decisions[0].kind, "approve");
    assert.equal((await store.listSessions())[0].id, created.id);
  });

  it("writes artifacts and links them to session state", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-artifacts-")));
    const session = await store.createSession({ workspacePath: "/workspace", taskGoal: "review diff" });
    const artifact = await store.writeArtifact(session.id, {
      kind: "review",
      title: "Codex review",
      body: "Looks good.",
      extension: "md",
    });
    const updated = await store.appendEvent(session.id, relayEvent("artifact.created", session.id, { artifact }));

    assert.equal(updated.artifacts[0].id, artifact.id);
    assert.equal(await store.readArtifact(session.id, artifact.id), "Looks good.");
  });
});

describe("Relay task store", () => {
  it("persists tasks, assignment, status, activity, and linked sessions", async () => {
    const store = new LocalTaskStore(mkdtempSync(join(tmpdir(), "relay-tasks-")));
    const created = await store.createTask({
      title: "Add Kanban board",
      description: "Show backlog and agent state.",
      priority: "high",
    });

    let updated = await store.assignTask(created.id, "codex");
    updated = await store.linkSession(updated.id, "ses_test");
    updated = await store.updateTask(updated.id, { status: "running" });

    assert.equal(updated.title, "Add Kanban board");
    assert.equal(updated.priority, "high");
    assert.equal(updated.assignedAgent, "codex");
    assert.equal(updated.status, "running");
    assert.deepEqual(updated.linkedSessionIds, ["ses_test"]);
    assert.equal(updated.activity.some((item) => item.message.includes("Assigned to codex")), true);
    assert.equal((await store.getTask(created.id)).events.some((event) => event.type === "task.session_linked"), true);
  });
});

describe("Relay daemon node tokens", () => {
  it("generates and reuses a workspace token when no explicit token is provided", async () => {
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
	    token: "ui_alice",
	    nodeToken: "node_alice",
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

	  assert.deepEqual(requestBody, { employeeId: "alice", nodeToken: "node_alice" });
	  assert.equal(authorization, "Bearer ui_alice");
	});
});

describe("Relay daemon node logging", () => {
  it("writes node and run scoped JSONL logs", async () => {
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
    const session = await controller.createSession("implement search");

    const state = await controller.runStep(session.id, initialAgentState(session.taskGoal), {
      agent: "codex",
      mode: "implement",
    });
    const updated = await store.getSession(session.id);

    assert.equal(state.last_exit_code, 0);
    assert.equal(updated.agentRuns.length, 1);
    assert.equal(updated.agentRuns[0].agent, "codex");
    assert.equal(updated.artifacts.length, 1);
    assert.equal(updated.events.some((event) => event.type === "agent.output"), true);
    assert.equal(updated.events.some((event) => event.type === "agent.completed"), true);
  });

  it("reopens a completed session when it is handed off", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-handoff-agent-")));
    const controller = new SessionController(store);
    const session = await controller.createSession("fix auth");
    await controller.completeSession(session.id, "Assignments completed.");

    const updated = await controller.recordDecision(session.id, "handoff", "Review the fix.", "codex");

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
    const task = await taskStore.createTask({ title: "Implement task board" });
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
    const session = await controller.createSession("implement task board");

    await controller.runAssignments(session.id, session.taskGoal, [{ agent: "codex", mode: "implement" }]);
    const updated = await taskStore.getTask(task.id);

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
    const session = await controller.createSession("review auth fix");

    const state = await controller.runAssignments(session.id, session.taskGoal, [{ agent: "codex", mode: "review" }]);
    const updated = await store.getSession(session.id);

    assert.equal(state.codex_verdict, "rejected");
    assert.equal(updated.status, "failed");
    assert.equal(updated.phase, "failed");
    assert.equal(updated.reviewVerdict, "rejected");
    assert.equal(updated.finalOutcome, "Codex rejected the work.");
    assert.equal(updated.events.some((event) => event.type === "session.completed"), false);
  });
});

describe("Relay read-only HTTP API", () => {
  it("serves an API index at the root route without a web UI", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-web-")));
    const taskStore = new LocalTaskStore(mkdtempSync(join(tmpdir(), "relay-web-tasks-")));
    const response = await handleRelayApiRequest(store, taskStore, "GET", "/", undefined);
    const body = JSON.parse(response.body);

    assert.equal(response.status, 200);
    assert.equal(response.contentType, "application/json; charset=utf-8");
    assert.equal(body.name, "Relay API");
    assert.equal(body.ui, false);
    assert.equal(body.endpoints.includes("GET /tasks"), true);
    assert.doesNotMatch(response.body, /<html/i);
  });

  it("creates, updates, assigns, picks up, and serves task events", async () => {
    const root = mkdtempSync(join(tmpdir(), "relay-task-api-"));
    const store = new LocalSessionStore(root);
    const taskStore = new LocalTaskStore(root);
    const created = JSON.parse((await handleRelayApiRequest(store, taskStore, "POST", "/tasks", {
      title: "Add task board",
      description: "Build backlog and Kanban.",
      priority: "high",
    })).body);

    assert.equal(created.status, "backlog");
    assert.equal(created.priority, "high");

    const assigned = JSON.parse((await handleRelayApiRequest(store, taskStore, "POST", `/tasks/${created.id}/assign`, {
      agent: "claude",
    })).body);
    assert.equal(assigned.status, "assigned");
    assert.equal(assigned.assignedAgent, "claude");

    const patched = JSON.parse((await handleRelayApiRequest(store, taskStore, "PATCH", `/tasks/${created.id}`, {
      status: "review",
      priority: "normal",
    })).body);
    assert.equal(patched.status, "review");
    assert.equal(patched.priority, "normal");

    const pickedUp = JSON.parse((await handleRelayApiRequest(store, taskStore, "POST", `/tasks/${created.id}/pickup`, {
      agent: "codex",
      mode: "review",
    })).body);
    assert.equal(pickedUp.task.status, "assigned");
    assert.equal(pickedUp.task.assignedAgent, "codex");
    assert.equal(pickedUp.task.linkedSessionIds.length, 1);
    assert.equal(pickedUp.session.status, "pending_approval");

    const list = JSON.parse((await handleRelayApiRequest(store, taskStore, "GET", "/tasks", undefined)).body);
    const events = JSON.parse((await handleRelayApiRequest(store, taskStore, "GET", `/tasks/${created.id}/events`, undefined)).body);
    assert.equal(list.tasks.length, 1);
    assert.equal(events.events.some((event: any) => event.type === "task.session_linked"), true);
  });

  it("creates, assigns, approves, and hands off real task sessions", async () => {
    const root = mkdtempSync(join(tmpdir(), "relay-session-api-"));
    const store = new LocalSessionStore(root);
    const taskStore = new LocalTaskStore(root);
    const created = JSON.parse((await handleRelayApiRequest(store, taskStore, "POST", "/sessions", {
      taskGoal: "Add upload progress tracking",
      assignments: [
        { agent: "claude", mode: "implement" },
        { agent: "codex", mode: "review" },
      ],
    })).body);

    assert.equal(created.status, "pending_approval");
    assert.equal(created.pendingDecision, "start");
    assert.equal(created.artifacts.some((artifact: any) => artifact.kind === "plan"), true);

    const assigned = JSON.parse((await handleRelayApiRequest(store, taskStore, "POST", `/sessions/${created.id}/assignments`, {
      assignments: [{ agent: "pi", mode: "implement", role: "tester" }],
    })).body);
    assert.equal(assigned.status, "pending_approval");
    assert.equal(assigned.artifacts.filter((artifact: any) => artifact.kind === "plan").length, 2);

    const approved = JSON.parse((await handleRelayApiRequest(store, taskStore, "POST", `/sessions/${created.id}/decisions`, {
      kind: "approve",
      note: "Start implementation.",
    })).body);
    assert.equal(approved.status, "running");
    assert.equal(approved.decisions.some((decision: any) => decision.kind === "approve"), true);

    const handedOff = JSON.parse((await handleRelayApiRequest(store, taskStore, "POST", `/sessions/${created.id}/handoffs`, {
      targetAgent: "codex",
      note: "Review after implementation.",
    })).body);
    assert.equal(handedOff.status, "pending_approval");
    assert.equal(handedOff.phase, "handoff:codex");
    assert.equal(handedOff.decisions.some((decision: any) => decision.kind === "handoff" && decision.targetAgent === "codex"), true);
    assert.equal(handedOff.artifacts.filter((artifact: any) => artifact.kind === "plan").length, 3);
    const handoffPlan = JSON.parse(await store.readArtifact(created.id, handedOff.artifacts.at(-1).id));
    assert.deepEqual(handoffPlan.assignments, [{ agent: "codex", mode: "review" }]);
  });

  it("serves sessions, session detail, artifacts, and SSE events", async () => {
    const root = mkdtempSync(join(tmpdir(), "relay-api-"));
    const store = new LocalSessionStore(root);
    const taskStore = new LocalTaskStore(root);
    const session = await store.createSession({ workspacePath: "/workspace", taskGoal: "ship api" });
    const artifact = await store.writeArtifact(session.id, {
      kind: "summary",
      title: "Summary",
      body: "API ready.",
    });
    await store.appendEvent(session.id, relayEvent("artifact.created", session.id, { artifact }));
    const list = JSON.parse((await handleRelayApiRequest(store, taskStore, "GET", "/sessions", undefined)).body);
    const detail = JSON.parse((await handleRelayApiRequest(store, taskStore, "GET", `/sessions/${session.id}`, undefined)).body);
    const events = await handleRelayApiRequest(store, taskStore, "GET", `/sessions/${session.id}/events`, undefined);
    const body = await handleRelayApiRequest(store, taskStore, "GET", `/sessions/${session.id}/artifacts/${artifact.id}`, undefined);

    assert.equal(list.sessions.length, 1);
    assert.equal(detail.id, session.id);
    assert.equal(events.sse, true);
    assert.match(events.body, /event: session\.created/);
    assert.equal(body.body, "API ready.");
  });
});

describe("Relay web API helpers", () => {
  it("omits synthetic workspace paths and starts runs with an existing session", async () => {
    const oldFetch = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit; body?: unknown }> = [];
    const assignment = { agent: "claude" as const, mode: "implement" as const };
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) as unknown : undefined;
	      calls.push({ url: String(url), init, body });
	      if (String(url) === "/sandboxes" && init?.method !== "POST") {
	        return new Response(JSON.stringify({ sandboxes: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
	      }
	      if (String(url) === "/daemon-nodes") {
	        return new Response(JSON.stringify({ nodes: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
	      }
      if (String(url) === "/cp/daemon-nodes") {
        return new Response(JSON.stringify({ nodes: [{ id: "sbx_alice", employeeId: "alice", nodeToken: "node_alice" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
	      if (String(url) === "/sessions" && init?.method !== "POST") {
	        return new Response(JSON.stringify({ sessions: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
	      }
	      if (String(url) === "/sandboxes") {
	        return new Response(JSON.stringify({
          id: "sbx_alice",
          employeeId: "alice",
          status: "ready",
          agents: { claude: "unknown", pi: "unknown", codex: "unknown" },
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: "2026-06-07T00:00:00.000Z",
        }), { status: 201, headers: { "Content-Type": "application/json" } });
      }
      if (String(url) === "/sessions") {
        return new Response(JSON.stringify({ id: "ses_web" }), { status: 201, headers: { "Content-Type": "application/json" } });
      }
      if (String(url) === "/sandboxes/sbx_alice/runs") {
        return new Response(JSON.stringify({ id: "ses_web", status: "completed" }), { status: 202, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
      await provisionWebSandbox("alice", "tok_web");
      await createWebSession({
        taskGoal: "fix auth",
        assignments: [assignment],
        workspacePath: "/host/workspace",
      }, "tok_web");
	      await runWebSandbox({
	        sandboxId: "sbx_alice",
	        taskGoal: "fix auth",
	        assignments: [assignment],
	        sessionId: "ses_web",
	      }, "tok_web");
	      await listWebSandboxes("tok_web");
	      await listWebDaemonNodes("tok_web");
      await listWebControlPanelDaemonNodes();
	      await listWebSessions("tok_web");
      await provisionWebSandbox("alice", "tok_claim", "node_alice");

	      assert.deepEqual(calls.map((call) => call.url), [
	        "/sandboxes",
	        "/sessions",
	        "/sandboxes/sbx_alice/runs",
	        "/sandboxes",
	        "/daemon-nodes",
        "/cp/daemon-nodes",
	        "/sessions",
        "/sandboxes",
	      ]);
      assert.deepEqual(calls[0].body, { employeeId: "alice" });
      assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer tok_web");
      assert.deepEqual(calls[1].body, {
        taskGoal: "fix auth",
        assignments: [assignment],
        workspacePath: "/host/workspace",
      });
      assert.equal((calls[1].init?.headers as Record<string, string>).Authorization, "Bearer tok_web");
	      assert.deepEqual(calls[2].body, {
	        taskGoal: "fix auth",
	        assignments: [assignment],
	        sessionId: "ses_web",
	      });
	      assert.equal((calls[3].init?.headers as Record<string, string>).Authorization, "Bearer tok_web");
	      assert.equal((calls[4].init?.headers as Record<string, string>).Authorization, "Bearer tok_web");
      assert.equal((calls[5].init?.headers as Record<string, string>).Authorization, undefined);
	      assert.equal((calls[6].init?.headers as Record<string, string>).Authorization, "Bearer tok_web");
      assert.deepEqual(calls[7].body, { employeeId: "alice", nodeToken: "node_alice" });
      assert.equal((calls[7].init?.headers as Record<string, string>).Authorization, "Bearer tok_claim");
    } finally {
      globalThis.fetch = oldFetch;
    }
  });
});

describe("Relay daemon API", () => {
  it("advertises and serves the read-only daemon control panel", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-daemon-control-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ServerDaemonNodeBackend(registry);

    const root = JSON.parse((await handleRelayDaemonRequest(backend, "GET", "/", undefined, registry)).body);
    const localRoot = JSON.parse((await handleRelayDaemonRequest(new LocalSandboxBackend({ store }), "GET", "/", undefined, registry)).body);
    const panel = await handleRelayDaemonRequest(backend, "GET", "/cp", undefined, registry);
    const version = JSON.parse((await handleRelayDaemonRequest(backend, "GET", "/cp/version", undefined, registry)).body);
    const oldPanel = await handleRelayDaemonRequest(backend, "GET", "/control", undefined, registry);

    assert.equal(root.daemonNodeMode, "server");
    assert.equal(localRoot.daemonNodeMode, "local");
    assert.equal(root.ui, true);
    assert.equal(root.uiPath, "/cp");
    assert.equal(root.webUiPath, "/web");
    assert.equal(root.endpoints.includes("GET /cp"), true);
    assert.equal(root.endpoints.includes("GET /cp/version"), true);
    assert.equal(root.endpoints.includes("GET /cp/daemon-nodes"), true);
    assert.equal(root.endpoints.includes("GET /control"), false);
    assert.equal(root.endpoints.includes("GET /web"), true);
    assert.equal(root.endpoints.includes("GET /daemon-nodes"), true);
    assert.equal(root.endpoints.includes("POST /daemon-nodes/:sandboxId/token-check"), false);
    assert.equal(oldPanel.status, 404);
    assert.equal(panel.status, 200);
    assert.equal(panel.contentType, "text/html; charset=utf-8");
    assert.match(panel.body, /Relay.*Control Panel|Control panel/);
    assert.match(panel.body, /\/cp\/daemon-nodes/);
    assert.doesNotMatch(panel.body, /\/token-check/);
    assert.match(panel.body, /Daemon token/);
    assert.match(panel.body, /Read only/);
    assert.match(panel.body, /\/cp\/version/);
    assert.match(panel.body, /window\.location\.reload/);
    assert.equal(typeof version.version, "string");
    assert.notEqual(version.version, "");
  });

  it("cancels an active local daemon run", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "relay-local-cancel-workspace-"));
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-local-cancel-")));
    let seenSignal: AbortSignal | undefined;
    let resolveRunStarted!: () => void;
    const runStarted = new Promise<void>((resolve) => {
      resolveRunStarted = resolve;
    });
    const backend = new LocalSandboxBackend({
      store,
      withOrchestratorSession: async (action) => action({
        rootfsPath: "test-rootfs",
        hostWorkspace: workspace,
        hostUid: 501,
        hostGid: 20,
        syncedUid: 501,
        syncedGid: 20,
      }),
      ensureAgentReady: async (_agent, _sink, signal) => {
        assert.equal(signal?.aborted, false);
      },
      execStream: async (_cmd, _args, options) => {
        seenSignal = options?.signal;
        resolveRunStarted();
        await new Promise<void>((resolve) => {
          if (options?.signal?.aborted) {
            resolve();
            return;
          }
          options?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return { exit_code: 130, stdout: "", stderr: "", error_message: "Execution cancelled." };
      },
    });
    const sandbox = await backend.provision({ employeeId: "local", workspacePath: workspace, token: "ui_local" });

    const pending = backend.run(sandbox.id, {
      taskGoal: "long running local task",
      assignments: [{ agent: "claude", mode: "implement" }],
    });
    await runStarted;
    const sessionId = (await store.listSessions())[0].id;

    const cancelled = await backend.cancelRun(sandbox.id, sessionId, "Cancelled by local test.");
    assert.equal(seenSignal?.aborted, true);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.decisions.at(-1)?.kind, "cancel");

    const final = await pending;
    assert.equal(final.status, "cancelled");
    assert.equal(final.phase, "cancelled");
    assert.equal(final.agentRuns[0].status, "cancelled");
    assert.equal((await backend.get(sandbox.id))?.status, "ready");
    await assert.rejects(
      backend.cancelRun(sandbox.id, "missing-session", "Cancelled by local test."),
      /no active local sandbox run/,
    );
  });

  it("requires a UI token for local daemon sandbox provisioning and listing", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-local-auth-")));
    const backend = new LocalSandboxBackend({ store });

    const missing = await handleRelayDaemonRequest(backend, "POST", "/sandboxes", {
      employeeId: "local",
      workspacePath: "/workspace/local",
    });
    const created = await handleRelayDaemonRequest(backend, "POST", "/sandboxes", {
      employeeId: "local",
      workspacePath: "/workspace/local",
    }, undefined, "ui_local");
    const missingList = await handleRelayDaemonRequest(backend, "GET", "/sandboxes");
    const listed = await handleRelayDaemonRequest(backend, "GET", "/sandboxes", undefined, undefined, "ui_local");
    const body = JSON.parse(listed.body);

    assert.equal(missing.status, 401);
    assert.equal(created.status, 201);
    assert.equal(missingList.status, 401);
    assert.equal(listed.status, 200);
    assert.equal(body.sandboxes.length, 1);
    assert.equal("token" in body.sandboxes[0], false);
    assert.equal("tokenHash" in body.sandboxes[0], false);
  });

  it("serves the exported Next.js web UI under /web", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-web-ui-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ServerDaemonNodeBackend(registry);

    const web = await handleRelayDaemonRequest(backend, "GET", "/web", undefined, registry);

    assert.equal(web.status, 200);
    assert.equal(web.contentType, "text/html; charset=utf-8");
    assert.match(web.body, /Relay Web UI|__next/);
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

    const listed = JSON.parse((await handleRelayDaemonRequest(backend, "GET", "/sandboxes", undefined, undefined, "tok_alice")).body);
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
    }, undefined, "tok_bob")).body);

    const response = await handleRelayDaemonRequest(backend, "POST", `/sandboxes/${created.id}/runs`, {
      taskGoal: " ",
      assignments: [{ agent: "codex" }],
    }, undefined, "tok_bob");

    assert.equal(response.status, 400);
    assert.match(response.body, /taskGoal/);
  });

  it("runs daemon handoffs against an existing session id", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-daemon-handoff-")));
    const backend = new FakeSandboxBackend(store);
    const created = JSON.parse((await handleRelayDaemonRequest(backend, "POST", "/sandboxes", {
      employeeId: "carol",
    }, undefined, "tok_carol")).body);
    const first = JSON.parse((await handleRelayDaemonRequest(backend, "POST", `/sandboxes/${created.id}/runs`, {
      taskGoal: "fix auth",
      assignments: [{ agent: "claude" }],
    }, undefined, "tok_carol")).body);

    const handoff = JSON.parse((await handleRelayDaemonRequest(backend, "POST", `/sandboxes/${created.id}/runs`, {
      taskGoal: "fix auth\n\nHandoff note:\nverify the fix",
      sessionId: first.id,
      assignments: [{ agent: "codex", mode: "review" }],
    }, undefined, "tok_carol")).body);

    assert.equal(handoff.id, first.id);
    assert.equal(handoff.agentRuns.length, 2);
    assert.equal(handoff.agentRuns[1].agent, "codex");
    assert.equal(handoff.agentRuns[1].mode, "review");
  });

  it("serves session API routes from the host daemon", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-daemon-session-api-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ServerDaemonNodeBackend(registry);
    await registry.register({
      sandboxId: "sbx_alice",
      employeeId: "alice",
      token: "node_alice",
      workspacePath: "/workspace/alice",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    }, "ui_alice");
    await registry.register({
      sandboxId: "sbx_bob",
      employeeId: "bob",
      token: "node_bob",
      workspacePath: "/workspace/bob",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    }, "ui_bob");

    const missing = await handleRelayDaemonRequest(backend, "POST", "/sessions", {
      taskGoal: "review auth",
      workspacePath: "/workspace/alice",
      assignments: [{ agent: "codex", mode: "review" }],
    }, registry);
    const created = await handleRelayDaemonRequest(backend, "POST", "/sessions", {
      taskGoal: "review auth",
      workspacePath: "/workspace/alice",
      assignments: [{ agent: "codex", mode: "review" }],
    }, registry, "ui_alice");
    assert.equal(created.status, 201);
    const session = JSON.parse(created.body);
    await store.createSession({
      workspacePath: "/workspace/bob",
      taskGoal: "bob task",
    });

    const wrong = await handleRelayDaemonRequest(backend, "GET", `/sessions/${session.id}`, undefined, registry, "ui_bob");
    const detail = await handleRelayDaemonRequest(backend, "GET", `/sessions/${session.id}`, undefined, registry, "ui_alice");
    const listed = await handleRelayDaemonRequest(backend, "GET", "/sessions", undefined, registry, "ui_alice");
    const list = JSON.parse(listed.body);
    assert.equal(missing.status, 401);
    assert.equal(wrong.status, 403);
    assert.equal(detail.status, 200);
    assert.equal(JSON.parse(detail.body).id, session.id);
    assert.deepEqual(list.sessions.map((item: any) => item.workspacePath), ["/workspace/alice"]);
  });

  it("requires the sandbox token for existing daemon node sandboxes", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-token-auth-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ServerDaemonNodeBackend(registry);
    await registry.register({
      sandboxId: "sbx_token",
      employeeId: "token",
      token: "node_token",
      workspacePath: "/workspace/token",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    }, "ui_token");

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
    }, registry, "ui_token");

    assert.equal(missing.status, 401);
    assert.equal(wrong.status, 401);
    assert.equal(ok.status, 201);
    const okBody = JSON.parse(ok.body);
    assert.equal(okBody.id, "sbx_token");
    assert.equal("nodeToken" in okBody, false);
    assert.equal("nodeTokenHash" in okBody, false);
    await assert.rejects(() => registry.takeCommands("sbx_token", "ui_token"), /Unauthorized/);
  });

  it("runs through a server-registered daemon node", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-server-daemon-node-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ServerDaemonNodeBackend(registry);
    await registry.register({
      sandboxId: "sbx_carol",
      employeeId: "carol",
      token: "node_carol",
      workspacePath: "/workspace/carol",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    }, "ui_carol");

    const sandbox = await backend.provision({ employeeId: "carol", workspacePath: "/workspace/carol", token: "ui_carol" });
    const pending = backend.run(sandbox.id, {
      taskGoal: "review auth",
      assignments: [{ agent: "codex", mode: "review" }],
    });
    const command = await takeCommandEventually(registry, "sbx_carol", "node_carol");

    assert.equal(command.type, "run.start");
    assert.equal(command.agent, "codex");
    assert.equal(command.mode, "review");

    await registry.handleEvent("sbx_carol", {
      type: "run.output",
      commandId: command.id,
      sessionId: command.sessionId,
      runId: command.runId,
      agent: "codex",
      stream: "stdout",
      text: codexReviewStdout("Looks good.\nRELAY_REVIEW_VERDICT: APPROVED"),
      sequence: 0,
    }, "node_carol");
    await registry.handleEvent("sbx_carol", {
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
    }, "node_carol");
    const session = await pending;

    assert.equal(session.status, "completed");
    assert.equal(session.workspacePath, "/workspace/carol");
    assert.equal(session.events.some((event: any) => event.type === "agent.output"), true);
    assert.equal(session.reviewVerdict, "approved");
  });

  it("runs Claude, Pi, and Codex assignments through one server daemon node", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-server-all-agents-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ServerDaemonNodeBackend(registry);
    await registry.register({
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

    const completeNext = async (agent: "claude" | "pi" | "codex", text: string): Promise<void> => {
      const command = await takeCommandEventually(registry, "sbx_all_agents", "tok_all_agents");
      assert.equal(command.agent, agent);
      await registry.handleEvent("sbx_all_agents", {
        type: "run.output",
        commandId: command.id,
        sessionId: command.sessionId,
        runId: command.runId,
        agent,
        stream: "stdout",
        text,
        sequence: 0,
      }, "tok_all_agents");
      await registry.handleEvent("sbx_all_agents", {
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

  it("cancels an active server daemon node run", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-server-cancel-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ServerDaemonNodeBackend(registry);
    await registry.register({
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
    const startCommand = await takeCommandEventually(registry, "sbx_cancel", "tok_cancel");
    assert.equal(startCommand.type, "run.start");

    await backend.cancelRun("sbx_cancel", startCommand.sessionId, "Cancelled by test.");
    const [cancelCommand] = await registry.takeCommands("sbx_cancel", "tok_cancel");
    assert.equal(cancelCommand.type, "run.cancel");
    assert.equal(cancelCommand.commandId, startCommand.id);
    assert.equal(cancelCommand.reason, "Cancelled by test.");

    await registry.handleEvent("sbx_cancel", {
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
    assert.equal((await registry.monitorNodes())[0].activeRuns.length, 0);
  });

  it("runs multiple daemon nodes concurrently with isolated command queues", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-concurrent-daemon-nodes-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ServerDaemonNodeBackend(registry);
    await registry.register({
      sandboxId: "sbx_alice",
      employeeId: "alice",
      token: "tok_alice",
      workspacePath: "/workspace/alice",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });
    await registry.register({
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
    const aliceCommand = await takeCommandEventually(registry, "sbx_alice", "tok_alice");
    const bobCommand = await takeCommandEventually(registry, "sbx_bob", "tok_bob");

    assert.equal(registry.get("sbx_alice")?.status, "running");
    assert.equal(registry.get("sbx_bob")?.status, "running");
    assert.equal(aliceCommand.type, "run.start");
    assert.equal(bobCommand.type, "run.start");
    assert.equal(aliceCommand.taskGoal, "review alice");
    assert.equal(bobCommand.taskGoal, "review bob");
    assert.equal((await registry.takeCommands("sbx_alice", "tok_alice")).length, 0);
    assert.equal((await registry.takeCommands("sbx_bob", "tok_bob")).length, 0);

    await registry.handleEvent("sbx_bob", {
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
    await registry.handleEvent("sbx_alice", {
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
    const backend = new ServerDaemonNodeBackend(registry);
    await registry.register({
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
    const command = await takeCommandEventually(registry, "sbx_single", "tok_single");
    await assert.rejects(
      backend.run("sbx_single", {
        taskGoal: "second",
        assignments: [{ agent: "codex", mode: "review" }],
      }),
      /daemon node is not ready/,
    );

    await registry.handleEvent("sbx_single", {
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

  it("rejects unauthorized server daemon node command polling", async () => {
    const registry = new DaemonNodeRegistry(new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-auth-"))));
    await registry.register({
      sandboxId: "sbx_auth",
      employeeId: "auth",
      token: "secret",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });

    await assert.rejects(() => registry.takeCommands("sbx_auth", "wrong"), /Unauthorized/);
  });

  it("rejects daemon node re-registration with a mismatched token", async () => {
    const registry = new DaemonNodeRegistry(new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-reregister-"))));
    const backend = new ServerDaemonNodeBackend(registry);
    await registry.register({
      sandboxId: "sbx_takeover",
      employeeId: "takeover",
      token: "tok_original",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });

    await assert.rejects(() => registry.register({
      sandboxId: "sbx_takeover",
      employeeId: "attacker",
      token: "tok_attacker",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    }), /Unauthorized/);
    assert.equal(registry.get("sbx_takeover")?.employeeId, "takeover");
    assert.equal((await registry.takeCommands("sbx_takeover", "tok_original")).length, 0);
    await assert.rejects(() => registry.takeCommands("sbx_takeover", "tok_attacker"), /Unauthorized/);

    const reRegistered = await registry.register({
      sandboxId: "sbx_takeover",
      employeeId: "takeover",
      token: "tok_original",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });
    assert.equal(reRegistered.status, "ready");

    const response = await handleRelayDaemonRequest(backend, "POST", "/daemon-nodes/register", {
      sandboxId: "sbx_takeover",
      employeeId: "attacker",
      token: "tok_attacker",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    }, registry);
    assert.equal(response.status, 401);
  });

  it("rejects daemon node events that target another sandbox's command", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-cross-sandbox-")));
    const session = await store.createSession({ workspacePath: "/workspace", taskGoal: "cross sandbox" });
    const registry = new DaemonNodeRegistry(store);
    for (const name of ["alpha", "beta"]) {
      await registry.register({
        sandboxId: `sbx_${name}`,
        employeeId: name,
        token: `tok_${name}`,
        protocolVersion: 1,
        supportedAgents: ["codex"],
        status: "ready",
      });
    }
    await registry.enqueue("sbx_alpha", {
      id: "cmd_alpha",
      type: "run.start",
      sessionId: session.id,
      runId: "run_alpha",
      taskGoal: "cross sandbox",
      agent: "codex",
      mode: "implement",
    });
    const [command] = await registry.takeCommands("sbx_alpha", "tok_alpha");

    await assert.rejects(() => registry.handleEvent("sbx_beta", {
      type: "run.completed",
      commandId: command.id,
      sessionId: command.sessionId,
      runId: command.runId,
      agent: "codex",
      mode: "implement",
      exitCode: 0,
      agentLog: "forged",
    }, "tok_beta"), /Unauthorized/);
    assert.equal((await registry.monitorNodes()).find((node) => node.id === "sbx_alpha")?.activeRuns.length, 1);

    // Events for commands the daemon is not tracking are dropped, not applied.
    await registry.handleEvent("sbx_beta", {
      type: "run.output",
      commandId: "cmd_unknown",
      sessionId: session.id,
      runId: "run_unknown",
      agent: "codex",
      stream: "stdout",
      text: "injected",
      sequence: 0,
    }, "tok_beta");
    assert.equal((await store.getSession(session.id)).events.some((event) => event.type === "agent.output"), false);
  });

  it("enqueues a cancel command when a daemon node run times out", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-timeout-cancel-")));
    const session = await store.createSession({ workspacePath: "/workspace", taskGoal: "timeout cancel" });
    const registry = new DaemonNodeRegistry(store);
    await registry.register({
      sandboxId: "sbx_timeout_cancel",
      employeeId: "timeout-cancel",
      token: "tok_timeout_cancel",
      protocolVersion: 1,
      supportedAgents: ["claude"],
      status: "ready",
    });
    await registry.enqueue("sbx_timeout_cancel", {
      id: "cmd_timeout_cancel",
      type: "run.start",
      sessionId: session.id,
      runId: "run_timeout_cancel",
      taskGoal: "timeout cancel",
      agent: "claude",
      mode: "implement",
    });
    const [command] = await registry.takeCommands("sbx_timeout_cancel", "tok_timeout_cancel");

    await assert.rejects(registry.waitForCompletion(command.id, 1), /timed out/);

    const cancel = await takeCommandEventually(registry, "sbx_timeout_cancel", "tok_timeout_cancel");
    assert.equal(cancel?.type, "run.cancel");
    assert.equal(cancel?.type === "run.cancel" ? cancel.commandId : undefined, command.id);
  });

  it("skips corrupt daemon store records instead of failing polls", async () => {
    const root = mkdtempSync(join(tmpdir(), "relay-corrupt-store-"));
    const registry = new DaemonNodeRegistry(new LocalSessionStore(root));
    await registry.register({
      sandboxId: "sbx_corrupt",
      employeeId: "corrupt",
      token: "tok_corrupt",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });
    mkdirSync(join(root, "daemon", "commands"), { recursive: true });
    writeFileSync(join(root, "daemon", "commands", "cmd_torn.json"), '{"id": "cmd_torn", "nodeId": "sbx');

    assert.deepEqual(await registry.takeCommands("sbx_corrupt", "tok_corrupt"), []);
  });

  it("allows authorized daemon node command polling through the HTTP route", async () => {
    const registry = new DaemonNodeRegistry(new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-auth-route-"))));
    const backend = new ServerDaemonNodeBackend(registry);
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
    await first.register({
      sandboxId: "sbx_persisted",
      employeeId: "persisted",
      token: "node_persisted",
      workspacePath: "/workspace/persisted",
      protocolVersion: 1,
      supportedAgents: ["claude", "codex"],
      status: "ready",
    }, "ui_persisted");

    const restarted = new DaemonNodeRegistry(new LocalSessionStore(root));
    const backend = new ServerDaemonNodeBackend(restarted);
    await restarted.listReady();
    const loaded = restarted.get("sbx_persisted");
    const provisioned = await backend.provision({ employeeId: "persisted", token: "ui_persisted" });

    assert.equal(loaded?.employeeId, "persisted");
    assert.equal(loaded?.workspacePath, "/workspace/persisted");
    assert.equal(loaded?.status, "stopped");
    assert.equal(loaded?.token, undefined);
    assert.equal(typeof loaded?.tokenHash, "string");
    assert.equal(typeof loaded?.uiTokenHash, "string");
    assert.equal(typeof loaded?.nodeTokenHash, "string");
    assert.equal(loaded?.nodeToken, "node_persisted");
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

  it("persists queued daemon node commands across registry restarts", async () => {
    const root = mkdtempSync(join(tmpdir(), "relay-daemon-queued-command-"));
    const first = new DaemonNodeRegistry(new LocalSessionStore(root));
    await first.register({
      sandboxId: "sbx_queue",
      employeeId: "queue",
      token: "tok_queue",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });
    await first.enqueue("sbx_queue", {
      id: "cmd_queue",
      type: "run.start",
      sessionId: "ses_queue",
      runId: "run_queue",
      taskGoal: "queued review",
      agent: "codex",
      mode: "review",
    });

    const restarted = new DaemonNodeRegistry(new LocalSessionStore(root));
    const [command] = await restarted.takeCommands("sbx_queue", "tok_queue");
    const afterTake = await restarted.takeCommands("sbx_queue", "tok_queue");

    assert.equal(command.id, "cmd_queue");
    assert.equal(command.sessionId, "ses_queue");
    assert.equal(command.runId, "run_queue");
    assert.deepEqual(afterTake, []);
  });

  it("does not redispatch completed daemon node commands after restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "relay-daemon-completed-command-"));
    const store = new LocalSessionStore(root);
    const session = await store.createSession({ workspacePath: "/workspace", taskGoal: "completed command" });
    const first = new DaemonNodeRegistry(store);
    await first.register({
      sandboxId: "sbx_done",
      employeeId: "done",
      token: "tok_done",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });
    await first.enqueue("sbx_done", {
      id: "cmd_done",
      type: "run.start",
      sessionId: session.id,
      runId: "run_done",
      taskGoal: "completed review",
      agent: "codex",
      mode: "review",
    });
    const [command] = await first.takeCommands("sbx_done", "tok_done");
    await first.handleEvent("sbx_done", {
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

    assert.deepEqual(await restarted.takeCommands("sbx_done", "tok_done"), []);
  });

  it("keeps daemon run output in session events without duplicating it into daemon monitor records", async () => {
    const root = mkdtempSync(join(tmpdir(), "relay-daemon-output-storage-"));
    const store = new LocalSessionStore(root);
    const session = await store.createSession({ workspacePath: "/workspace", taskGoal: "stream output" });
    const registry = new DaemonNodeRegistry(store);
    await registry.register({
      sandboxId: "sbx_output",
      employeeId: "output",
      token: "tok_output",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });
    await registry.enqueue("sbx_output", {
      id: "cmd_output",
      type: "run.start",
      sessionId: session.id,
      runId: "run_output",
      taskGoal: "stream output",
      agent: "codex",
      mode: "implement",
    });
    const [command] = await registry.takeCommands("sbx_output", "tok_output");

    await registry.handleEvent("sbx_output", {
      type: "run.output",
      commandId: command.id,
      sessionId: command.sessionId,
      runId: command.runId,
      agent: "codex",
      stream: "stdout",
      text: "hello",
      sequence: 1,
    }, "tok_output");

    const outputEvent = (await store.getSession(session.id)).events.find((event) => event.type === "agent.output");
    const activeRun = (await registry.monitorNodes())[0].activeRuns[0];

    assert.equal(outputEvent?.type, "agent.output");
    assert.equal(outputEvent && "text" in outputEvent ? outputEvent.text : "", "hello");
    assert.equal("text" in activeRun, false);
  });

  it("lists sanitized daemon node monitor records without tokens", async () => {
    const registry = new DaemonNodeRegistry(new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-monitor-list-"))));
    const backend = new ServerDaemonNodeBackend(registry);
    await registry.register({
      sandboxId: "sbx_monitor",
      employeeId: "monitor",
      token: "node_monitor",
      workspacePath: "/workspace/monitor",
      protocolVersion: 1,
      supportedAgents: ["claude", "codex"],
      status: "ready",
    }, "ui_monitor");

    const missing = await handleRelayDaemonRequest(backend, "GET", "/daemon-nodes", undefined, registry);
    const response = await handleRelayDaemonRequest(backend, "GET", "/daemon-nodes", undefined, registry, "ui_monitor");
    const body = JSON.parse(response.body);

    assert.equal(missing.status, 401);
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
    assert.equal("uiTokenHash" in body.nodes[0], false);
    assert.equal("nodeTokenHash" in body.nodes[0], false);
    assert.equal("nodeToken" in body.nodes[0], false);
    assert.equal(typeof body.nodes[0].lastSeenAt, "string");
  });

  it("serves daemon node records with tokens to the control panel", async () => {
    const registry = new DaemonNodeRegistry(new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-control-nodes-"))));
    const backend = new ServerDaemonNodeBackend(registry);
    await registry.register({
      sandboxId: "sbx_control",
      employeeId: "control",
      token: "node_control",
      workspacePath: "/workspace/control",
      protocolVersion: 1,
      supportedAgents: ["claude"],
      status: "ready",
    }, "ui_control");

    const response = await handleRelayDaemonRequest(backend, "GET", "/cp/daemon-nodes", undefined, registry);
    const body = JSON.parse(response.body);

    assert.equal(response.status, 200);
    assert.equal(body.nodes.length, 1);
    assert.equal(body.nodes[0].id, "sbx_control");
    assert.equal(body.nodes[0].nodeToken, "node_control");
    assert.equal("token" in body.nodes[0], false);
    assert.equal("tokenHash" in body.nodes[0], false);
    assert.equal("uiTokenHash" in body.nodes[0], false);
    assert.equal("nodeTokenHash" in body.nodes[0], false);
  });

  it("marks daemon nodes stale when their heartbeat lease expires", async () => {
    const root = mkdtempSync(join(tmpdir(), "relay-monitor-stale-"));
    const store = new LocalSessionStore(root);
    let now = Date.now();
    const registry = new DaemonNodeRegistry(store, new LocalDaemonStore(root), {
      now: () => now,
      livenessTimeoutMs: 1_000,
    });
    const backend = new ServerDaemonNodeBackend(registry);
    await registry.register({
      sandboxId: "sbx_stale",
      employeeId: "stale",
      token: "tok_stale",
      workspacePath: "/workspace/stale",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });

    const fresh = (await registry.monitorNodes())[0];
    now = new Date(fresh.lastSeenAt ?? "").getTime() + 1_001;
    const stale = (await registry.monitorNodes())[0];

    assert.equal(fresh.online, true);
    assert.equal(fresh.stale, false);
    assert.equal(stale.online, false);
    assert.equal(stale.stale, true);
    assert.equal(stale.status, "ready");
    await assert.rejects(
      backend.run("sbx_stale", {
        taskGoal: "run on stale node",
        assignments: [{ agent: "codex", mode: "review" }],
      }),
      /heartbeat expired/,
    );

    await registry.takeCommands("sbx_stale", "tok_stale");
    now = new Date(registry.get("sbx_stale")?.lastSeenAt ?? "").getTime();
    const revived = (await registry.monitorNodes())[0];
    assert.equal(revived.online, true);
    assert.equal(revived.stale, false);
  });

  it("does not expose a daemon node token check route", async () => {
    const registry = new DaemonNodeRegistry(new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-monitor-token-route-"))));
    const backend = new ServerDaemonNodeBackend(registry);
    await registry.register({
      sandboxId: "sbx_check",
      employeeId: "check",
      token: "node_check",
      workspacePath: "/workspace/check",
      protocolVersion: 1,
      supportedAgents: ["claude"],
      status: "ready",
    }, "ui_check");

    const response = await handleRelayDaemonRequest(backend, "POST", "/daemon-nodes/sbx_check/token-check", {
      token: "node_check",
    }, registry);
    const body = JSON.parse(response.body);

    assert.equal(response.status, 404);
    assert.equal(body.error, "Not found");
  });

  it("tracks daemon node command polling and in-flight runs for monitoring", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-monitor-active-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ServerDaemonNodeBackend(registry);
    await registry.register({
      sandboxId: "sbx_active",
      employeeId: "active",
      token: "tok_active",
      workspacePath: "/workspace/active",
      protocolVersion: 1,
      supportedAgents: ["codex"],
      status: "ready",
    });

    const registeredLastSeenAt = (await registry.monitorNodes())[0].lastSeenAt;
    await new Promise((resolve) => setTimeout(resolve, 2));
    const pending = backend.run("sbx_active", {
      taskGoal: "review active run",
      assignments: [{ agent: "codex", mode: "review" }],
    });
    const queued = await monitorNodeEventually(registry, "sbx_active", (node) => node.queuedCommandCount === 1);
    const command = await takeCommandEventually(registry, "sbx_active", "tok_active");
    const active = (await registry.monitorNodes())[0];

    assert.equal(queued.queuedCommandCount, 1);
    assert.equal(active.queuedCommandCount, 0);
    assert.notEqual(active.lastSeenAt, registeredLastSeenAt);
    assert.equal(active.activeRuns.length, 1);
    assert.equal(active.activeRuns[0].commandId, command.id);
    assert.equal(active.activeRuns[0].sessionId, command.sessionId);
    assert.equal(active.activeRuns[0].agent, "codex");
    assert.equal(active.activeRuns[0].mode, "review");
    assert.equal(active.activeRuns[0].taskGoal, "review active run");

    await registry.handleEvent("sbx_active", {
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
    assert.equal((await registry.monitorNodes())[0].activeRuns.length, 0);
  });

  it("clears persisted daemon active runs after command timeout", async () => {
    const root = mkdtempSync(join(tmpdir(), "relay-monitor-timeout-"));
    const store = new LocalSessionStore(root);
    const registry = new DaemonNodeRegistry(store);
    await registry.register({
      sandboxId: "sbx_timeout",
      employeeId: "timeout",
      token: "tok_timeout",
      workspacePath: "/workspace/timeout",
      protocolVersion: 1,
      supportedAgents: ["pi"],
      status: "ready",
    });
    const session = await store.createSession({ workspacePath: "/workspace/timeout", taskGoal: "timeout run" });
    await registry.enqueue("sbx_timeout", {
      id: "cmd_timeout",
      type: "run.start",
      sessionId: session.id,
      runId: "run_timeout",
      taskGoal: "timeout run",
      agent: "pi",
      mode: "implement",
      workspacePath: "/workspace/timeout",
    });
    const [command] = await registry.takeCommands("sbx_timeout", "tok_timeout");

    await assert.rejects(
      registry.waitForCompletion(command.id, 1),
      /timed out/,
    );

    assert.equal((await registry.monitorNodes())[0].activeRuns.length, 0);
    const restarted = new DaemonNodeRegistry(new LocalSessionStore(root));
    assert.equal((await restarted.monitorNodes())[0].activeRuns.length, 0);
  });

  it("keeps the daemon node ready after a reported run failure", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-run-failed-ready-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ServerDaemonNodeBackend(registry);
    await registry.register({
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
    const command = await takeCommandEventually(registry, "sbx_failed_ready", "tok_failed_ready");
    await registry.handleEvent("sbx_failed_ready", {
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

  it("fails server Codex review sessions when the verdict is rejected", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-server-rejected-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ServerDaemonNodeBackend(registry);
    await registry.register({
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
    const command = await takeCommandEventually(registry, "sbx_review", "tok_review");
    await registry.handleEvent("sbx_review", {
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

  it("adopts the one-time provision token for follow-up daemon client requests", async () => {
    const headersSeen: Array<string | null> = [];
    const client = new RelayDaemonClient({
      baseUrl: "http://relay-daemon.test",
      fetchFn: (async (input, init) => {
        headersSeen.push(new Headers(init?.headers).get("authorization"));
        if (String(input).endsWith("/sandboxes")) {
          return new Response(JSON.stringify({
            id: "sbx_adopt",
            employeeId: "adopt",
            status: "stopped",
            agents: { claude: "unknown", pi: "unknown", codex: "unknown" },
            token: "tok_issued_once",
            createdAt: "2026-06-07T00:00:00.000Z",
            updatedAt: "2026-06-07T00:00:00.000Z",
          }), { status: 201, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({
          id: "sbx_adopt",
          employeeId: "adopt",
          status: "ready",
          agents: { claude: "ready", pi: "ready", codex: "ready" },
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: "2026-06-07T00:00:01.000Z",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }) as typeof fetch,
    });

    await client.provisionSandbox({ employeeId: "adopt" });
    await client.getSandbox("sbx_adopt");

    assert.equal(headersSeen[0], null);
    assert.equal(headersSeen[1], "Bearer tok_issued_once");
  });

  it("rejects daemon node re-registration with a mismatched token", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-register-mismatch-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ServerDaemonNodeBackend(registry);
    await registry.register({
      sandboxId: "sbx_mismatch",
      employeeId: "mismatch",
      token: "tok_original",
      protocolVersion: 1,
      supportedAgents: ["claude"],
      status: "ready",
    });

    const rejected = await handleRelayDaemonRequest(backend, "POST", "/daemon-nodes/register", {
      sandboxId: "sbx_mismatch",
      employeeId: "mismatch",
      token: "tok_hijack",
      protocolVersion: 1,
      supportedAgents: ["claude"],
    }, registry);
    const accepted = await handleRelayDaemonRequest(backend, "POST", "/daemon-nodes/register", {
      sandboxId: "sbx_mismatch",
      employeeId: "mismatch",
      token: "tok_original",
      protocolVersion: 1,
      supportedAgents: ["claude"],
    }, registry);

    assert.equal(rejected.status, 401);
    assert.equal(accepted.status, 200);
    // The hijack attempt must not replace the original token.
    assert.deepEqual(await registry.takeCommands("sbx_mismatch", "tok_original"), []);
    await assert.rejects(() => registry.takeCommands("sbx_mismatch", "tok_hijack"), /Unauthorized/);
  });

  it("revives a persisted daemon node when it polls after a daemon restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "relay-daemon-revive-"));
    const first = new DaemonNodeRegistry(new LocalSessionStore(root));
    await first.register({
      sandboxId: "sbx_revive",
      employeeId: "revive",
      token: "tok_revive",
      protocolVersion: 1,
      supportedAgents: ["claude"],
      status: "ready",
    });

    const restarted = new DaemonNodeRegistry(new LocalSessionStore(root));
    await restarted.listReady();
    assert.equal(restarted.get("sbx_revive")?.status, "stopped");

    // The still-running daemon node keeps polling for commands; an authorized
    // poll proves it is alive and must make the sandbox schedulable again.
    await restarted.takeCommands("sbx_revive", "tok_revive");

    assert.equal(restarted.get("sbx_revive")?.status, "ready");
    assert.equal(restarted.get("sbx_revive")?.lastError, undefined);
  });

  it("re-provisions onto the live daemon node instead of an offline placeholder", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-placeholder-converge-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ServerDaemonNodeBackend(registry);

    const placeholder = await backend.provision({
      employeeId: "late",
      workspacePath: "/workspace/late",
      token: "ui_late",
      nodeToken: "node_late",
    });
    assert.notEqual(placeholder.status, "ready");

    await registry.register({
      sandboxId: "sbx_late_node",
      employeeId: "late",
      token: "node_late",
      workspacePath: "/workspace/late/",
      protocolVersion: 1,
      supportedAgents: ["claude", "pi", "codex"],
      status: "ready",
    }, "ui_late");

    const reprovisioned = await backend.provision({ employeeId: "late", workspacePath: "/workspace/late", token: "ui_late" });
    assert.equal(reprovisioned.id, "sbx_late_node");
    assert.equal(reprovisioned.status, "ready");
  });

  it("matches a provision request to the authenticated live daemon node workspace", async () => {
    const store = new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-authenticated-workspace-")));
    const registry = new DaemonNodeRegistry(store);
    const backend = new ServerDaemonNodeBackend(registry);

    await registry.register({
      sandboxId: "sbx_live_workspace",
      employeeId: "workspace-user",
      token: "node_workspace",
      workspacePath: "/workspace/live",
      protocolVersion: 1,
      supportedAgents: ["claude", "pi", "codex"],
      status: "ready",
    }, "ui_old");

    const matched = await backend.provision({
      employeeId: "workspace-user",
      workspacePath: "/workspace/requested",
      token: "ui_new",
      nodeToken: "node_workspace",
    });
    const detail = await handleRelayDaemonRequest(backend, "GET", "/sandboxes/sbx_live_workspace", undefined, registry, "ui_new");
    const body = JSON.parse(detail.body);

    assert.equal(matched.id, "sbx_live_workspace");
    assert.equal(matched.workspacePath, "/workspace/live");
    assert.equal(matched.status, "ready");
    assert.equal(detail.status, 200);
    assert.equal(body.workspacePath, "/workspace/live");
  });
});
