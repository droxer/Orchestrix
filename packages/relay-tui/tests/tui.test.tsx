import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { render } from "ink-testing-library";

import {
  RelayTui,
  RelayTuiHost,
  completeShortcutInput,
  createDaemonAssignmentRunner,
  shortcutSuggestions,
  parseAssignedTask,
  replayDaemonAgentOutput,
  validateParsedTask,
  withDefaultAssignments,
  type RunRequest,
} from "../src/tui.js";
import { backendArgs, daemonArgs, liveDaemonExists, resolveLocalRunConfig, resolveRepoRootFromDist } from "../src/local-run.js";
import { type RelayDaemonClient, type RelaySession } from "../../relay-core/src/index.js";
import { LocalSessionStore } from "../../relay-core/src/session-store.js";

function testSessionStore(): LocalSessionStore {
  return new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-tui-")));
}

async function waitForInput(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function waitForFrame(lastFrame: () => string | undefined, pattern: RegExp, timeoutMs = 1500): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let frame = lastFrame() ?? "";
  while (!pattern.test(frame) && Date.now() < deadline) {
    await waitForInput();
    frame = lastFrame() ?? "";
  }
  assert.match(frame, pattern);
  return frame;
}

describe("TUI task parsing", () => {
  it("parses a single Claude assignment", async () => {
    const parsed = parseAssignedTask("@claude fix auth middleware");

    assert.deepEqual(parsed.assignments, [{ agent: "claude" }]);
    assert.equal(parsed.task, "fix auth middleware");
  });

  it("parses multiple assignments in mention order", async () => {
    const parsed = parseAssignedTask("@claude @pi fix auth middleware");

    assert.deepEqual(parsed.assignments, [{ agent: "claude" }, { agent: "pi" }]);
    assert.equal(parsed.task, "fix auth middleware");
  });

  it("keeps non-leading mentions in task text", async () => {
    const parsed = parseAssignedTask("@claude update README to explain @codex review mode");

    assert.deepEqual(parsed.assignments, [{ agent: "claude" }]);
    assert.equal(parsed.task, "update README to explain @codex review mode");
  });

  it("keeps unknown leading mentions in task text", async () => {
    const parsed = parseAssignedTask("@gemini @claude fix auth middleware");

    assert.deepEqual(parsed.assignments, []);
    assert.equal(parsed.task, "@gemini @claude fix auth middleware");
  });

  it("rejects empty task text after mentions", async () => {
    const parsed = parseAssignedTask("@claude @pi");

    assert.equal(validateParsedTask(parsed), "Enter a task after the @mentions.");
  });

  it("rejects tasks without an explicit agent assignment", async () => {
    const parsed = parseAssignedTask("fix auth middleware");

    assert.deepEqual(parsed.assignments, []);
    assert.equal(parsed.task, "fix auth middleware");
    assert.equal(validateParsedTask(parsed), "Assign the task with @claude, @pi, @codex, @kimi.");
  });

  it("applies default assignments only when the task has no leading mention", async () => {
    assert.deepEqual(withDefaultAssignments(parseAssignedTask("fix auth middleware"), [{ agent: "claude" }]), {
      assignments: [{ agent: "claude" }],
      task: "fix auth middleware",
    });
    assert.deepEqual(withDefaultAssignments(parseAssignedTask("@pi fix auth middleware"), [{ agent: "claude" }]), {
      assignments: [{ agent: "pi" }],
      task: "fix auth middleware",
    });
  });

  it("completes agent mention shortcuts", async () => {
    assert.deepEqual(completeShortcutInput("@c"), {
      input: "@claude",
      completed: true,
      candidates: ["@claude", "@codex"],
    });
    assert.equal(completeShortcutInput("@claude").input, "@pi");
    assert.equal(completeShortcutInput("@claude @p").input, "@claude @pi");
  });

  it("completes slash command shortcuts", async () => {
    assert.deepEqual(completeShortcutInput("/h"), {
      input: "/handoff",
      completed: true,
      candidates: ["/handoff"],
    });
    assert.deepEqual(completeShortcutInput("/q"), {
      input: "/quit",
      completed: true,
      candidates: ["/quit"],
    });
    assert.equal(completeShortcutInput("/approve").input, "/reject");
    assert.equal(completeShortcutInput("fix auth").completed, false);
  });

  it("finds shortcut dropdown suggestions for the current token", async () => {
    assert.deepEqual(shortcutSuggestions("@c")?.candidates, ["@claude", "@codex"]);
    assert.deepEqual(shortcutSuggestions("@claude /r")?.candidates, ["/reject", "/rerun", "/rename"]);
    assert.equal(shortcutSuggestions("@unknown"), null);
  });

});

describe("TUI daemon runner", () => {
  it("propagates one local run config to the backend, daemon, and TUI", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "relay-local-run-workspace-"));
    const config = resolveLocalRunConfig({
      RELAY_BACKEND_URL: "http://127.0.0.1:8790/",
      RELAY_WORKSPACE: workspace,
      RELAY_EMPLOYEE_ID: "alice",
      RELAY_DAEMON_TOKEN: "tok_test",
      RELAY_DAEMON_UI_TOKEN: "ui_test",
    });

    assert.equal(config.backendUrl, "http://127.0.0.1:8790");
    assert.equal(config.workspacePath, workspace);
    assert.equal(config.employeeId, "alice");
    assert.equal(config.token, "tok_test");
    assert.equal(config.uiToken, "ui_test");
    assert.equal(config.sandboxId, "sbx_alice");
    assert.equal(config.sandboxMode, "boxlite");
    assert.equal(config.childEnv.RELAY_BACKEND_URL, "http://127.0.0.1:8790");
    assert.equal(config.childEnv.RELAY_WORKSPACE, workspace);
    assert.equal(config.childEnv.RELAY_EMPLOYEE_ID, "alice");
    assert.equal(config.childEnv.RELAY_DAEMON_TOKEN, "tok_test");
    assert.equal(config.childEnv.RELAY_DAEMON_UI_TOKEN, "ui_test");
    assert.equal(config.childEnv.RELAY_SANDBOX_ID, "sbx_alice");
    assert.equal(config.childEnv.RELAY_SANDBOX_MODE, "boxlite");
  });

  it("accepts legacy env names for backend URL and daemon token", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "relay-local-run-workspace-"));
    const config = resolveLocalRunConfig({
      RELAY_DAEMON_URL: "http://127.0.0.1:9999/",
      RELAY_WORKSPACE: workspace,
      RELAY_EMPLOYEE_ID: "alice",
      RELAY_DAEMON_NODE_TOKEN: "tok_legacy",
    });

    assert.equal(config.backendUrl, "http://127.0.0.1:9999");
    assert.equal(config.token, "tok_legacy");
  });

  it("starts the backend on the configured port and the daemon with its sandbox", async () => {
    assert.deepEqual(backendArgs(new URL("http://127.0.0.1:8790")), ["--port", "8790"]);
    assert.deepEqual(daemonArgs("sbx_alice", "boxlite"), ["--sandbox-id", "sbx_alice", "--sandbox", "boxlite"]);
  });

  it("resolves the repository root from the relay-tui dist directory", async () => {
    assert.equal(
      resolveRepoRootFromDist("/Users/feihe/Workspace/Relay/packages/relay-tui/dist"),
      resolve("/Users/feihe/Workspace/Relay"),
    );
  });

  it("ignores blank workspace values when resolving local run config", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "relay-local-run-workspace-"));
    const config = resolveLocalRunConfig({
      RELAY_WORKSPACE: "",
      WORKSPACE: workspace,
      USER: "relay user",
      RELAY_DAEMON_TOKEN: "tok_test",
    });

    assert.equal(config.workspacePath, workspace);
    assert.equal(config.sandboxId, "sbx_relay_user");
    assert.equal(config.childEnv.RELAY_WORKSPACE, workspace);
  });

  it("surfaces daemon API detail errors", async () => {
    const { RelayDaemonClient } = await import("../../relay-core/src/index.js");
    const client = new RelayDaemonClient({
      baseUrl: "http://daemon.local",
      fetchFn: async () => new Response(JSON.stringify({ detail: "Invalid daemon node token." }), {
        status: 401,
        statusText: "Unauthorized",
        headers: { "Content-Type": "application/json" },
      }),
    });

    await assert.rejects(
      () => client.provisionSandbox({ employeeId: "alice" }),
      /Invalid daemon node token\./,
    );
  });

  it("surfaces non-JSON daemon API errors", async () => {
    const { RelayDaemonClient } = await import("../../relay-core/src/index.js");
    const client = new RelayDaemonClient({
      baseUrl: "http://daemon.local",
      fetchFn: async () => new Response("upstream gateway failed", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "Content-Type": "text/plain" },
      }),
    });

    await assert.rejects(
      () => client.provisionSandbox({ employeeId: "alice" }),
      /Relay daemon request failed: upstream gateway failed/,
    );
  });

  it("cleans up daemon run polling abort listeners after each wait", async () => {
    const { RelayDaemonClient } = await import("../../relay-core/src/index.js");
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let abortAdds = 0;
    let abortRemoves = 0;
    const signal = {
      aborted: false,
      addEventListener: (type: string) => {
        if (type === "abort") abortAdds += 1;
      },
      removeEventListener: (type: string) => {
        if (type === "abort") abortRemoves += 1;
      },
    } as unknown as AbortSignal;
    const session = (status: "running" | "completed"): RelaySession => ({
      id: "ses_poll_cleanup",
      workspacePath: "/workspace/alice",
      taskGoal: "fix auth",
      status,
      phase: status,
      participants: ["human", "codex"],
      currentAgent: status === "running" ? "codex" : undefined,
      pendingDecision: undefined,
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: status === "running" ? "2026-06-07T00:00:00.000Z" : "2026-06-07T00:00:01.000Z",
      events: [],
      decisions: [],
      agentRuns: [{
        id: "run_poll_cleanup",
        agent: "codex",
        role: "implementer",
        mode: "action",
        status,
        startedAt: "2026-06-07T00:00:00.000Z",
        completedAt: status === "running" ? undefined : "2026-06-07T00:00:01.000Z",
        exitCode: status === "running" ? undefined : 0,
        artifactIds: [],
      }],
      artifacts: [],
      finalOutcome: status === "running" ? undefined : "done",
    });
    const runningSession = session("running");
    const completedSession = session("completed");
    let sessionReads = 0;
    const client = new RelayDaemonClient({
      baseUrl: "http://daemon.local",
      fetchFn: (async (input, init) => {
        const url = new URL(String(input));
        if (init?.method === "POST" && url.pathname === "/api/v1/sandboxes/sbx_alice/runs") {
          return new Response(JSON.stringify(runningSession), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url.pathname === "/api/v1/threads/ses_poll_cleanup") {
          sessionReads += 1;
          return new Response(JSON.stringify(sessionReads === 1 ? runningSession : completedSession), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("not found", { status: 404, statusText: "Not Found" });
      }) as typeof fetch,
    });

    globalThis.setTimeout = ((handler: Parameters<typeof setTimeout>[0]) => {
      queueMicrotask(() => {
        if (typeof handler === "function") handler();
      });
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;
    try {
      const result = await client.runSandbox({
        sandboxId: "sbx_alice",
        taskGoal: "fix auth",
        assignments: [{ agent: "codex", mode: "action" }],
        signal,
      });

      assert.equal(result.status, "completed");
      assert.equal(sessionReads, 2);
      assert.equal(abortAdds, 1);
      assert.equal(abortRemoves, 1);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  it("matches live local-run daemons by employee and workspace", async () => {
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async (): Promise<Response> => new Response(JSON.stringify({
      nodes: [
        {
          id: "sbx_other",
          employeeId: "alice",
          workspacePath: "/workspace/other",
          online: true,
          stale: false,
        },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    try {
      assert.equal(await liveDaemonExists("http://daemon.local", "alice", "/workspace/current", "sbx_alice"), false);
    } finally {
      globalThis.fetch = oldFetch;
    }

    globalThis.fetch = (async (): Promise<Response> => new Response(JSON.stringify({
      nodes: [
        {
          id: "sbx_other",
          employeeId: "alice",
          workspacePath: "/workspace/current",
          online: true,
          stale: false,
        },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    try {
      assert.equal(await liveDaemonExists("http://daemon.local", "alice", "/workspace/current", "sbx_alice"), false);
      assert.equal(await liveDaemonExists("http://daemon.local", "alice", "/workspace/current", "sbx_other"), true);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("submits assignments to the host daemon sandbox", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({
        id: "ses_daemon",
        workspacePath: "/workspace/alice",
        taskGoal: "review auth",
        status: "completed",
        phase: "completed",
        participants: ["human", "codex"],
        currentAgent: "codex",
        pendingDecision: undefined,
        createdAt: "2026-06-07T00:00:00.000Z",
        updatedAt: "2026-06-07T00:00:00.000Z",
        events: [
          {
            id: "evt_output_1",
            type: "agent.output",
            sessionId: "ses_daemon",
            timestamp: "2026-06-07T00:00:01.000Z",
            runId: "run_daemon",
            agent: "codex",
            stream: "stdout",
            text: `event: agent.output\ndata: ${JSON.stringify({
              id: "evt_inner_output_1",
              type: "agent.output",
              sessionId: "ses_daemon",
              timestamp: "2026-06-07T00:00:01.000Z",
              runId: "run_daemon",
              agent: "codex",
              stream: "stdout",
              text: JSON.stringify({
                type: "item.completed",
                item: {
                  type: "agent_message",
                  text: "# Review\n- **AI response** from daemon",
                },
              }) + "\n",
            })}\n\n`,
          },
        ],
        decisions: [],
        agentRuns: [{ id: "run_daemon", agent: "codex", role: "reviewer", mode: "review", status: "completed" }],
        artifacts: [],
      }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    };
    const { RelayDaemonClient } = await import("../../relay-core/src/index.js");
    const client = new RelayDaemonClient({ baseUrl: "http://daemon.local", fetchFn });
    const runner = createDaemonAssignmentRunner(client, "sbx_alice");
    let updatedSession = "";
    let log = "";

    await runner({
      assignments: [{ agent: "codex", mode: "review" }],
      task: "review auth",
      sessionId: "ses_existing",
      log: (text) => {
        log += text;
      },
      onSessionUpdate: (session) => {
        updatedSession = session.id;
      },
    });

    const runCall = calls.find((call) => call.url === "http://daemon.local/api/v1/sandboxes/sbx_alice/runs");
    assert.ok(runCall);
    assert.equal(runCall.init.method, "POST");
    assert.deepEqual(JSON.parse(String(runCall.init.body)), {
      taskGoal: "review auth",
      assignments: [{ agent: "codex", mode: "review" }],
      sessionId: "ses_existing",
    });
    assert.equal(updatedSession, "ses_daemon");
    assert.match(log, /Submitting task to Relay daemon/);
    assert.match(log, /● # Review/);
    assert.match(log, /- \*\*AI response\*\* from daemon/);
    assert.doesNotMatch(log, /event: agent\.output/);
    assert.doesNotMatch(log, /data: /);
    assert.doesNotMatch(log, /"type":"agent.output"/);
    assert.doesNotMatch(log, /"text":"\{\\"type\\":\\"item.completed\\"/);
    assert.doesNotMatch(log, /\{"type":"item.completed"/);
  });

  it("rejects failed daemon sessions after rendering their output", async () => {
    const failedSession: RelaySession = {
      id: "ses_failed",
      workspacePath: "/workspace/alice",
      taskGoal: "fix auth",
      status: "failed",
      phase: "failed",
      participants: ["human", "codex"],
      currentAgent: undefined,
      pendingDecision: undefined,
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:02.000Z",
      events: [
        {
          id: "evt_failed_started",
          type: "agent.started",
          sessionId: "ses_failed",
          timestamp: "2026-06-07T00:00:00.000Z",
          runId: "run_failed",
          agent: "codex",
          role: "implementer",
          mode: "action",
        },
        {
          id: "evt_failed_output",
          type: "agent.output",
          sessionId: "ses_failed",
          timestamp: "2026-06-07T00:00:01.000Z",
          runId: "run_failed",
          agent: "codex",
          stream: "stderr",
          text: "Another Relay orchestrator is already running.\n",
        },
        {
          id: "evt_failed_completed",
          type: "agent.completed",
          sessionId: "ses_failed",
          timestamp: "2026-06-07T00:00:02.000Z",
          runId: "run_failed",
          agent: "codex",
          status: "failed",
          exitCode: 1,
        },
        {
          id: "evt_session_failed",
          type: "session.failed",
          sessionId: "ses_failed",
          timestamp: "2026-06-07T00:00:02.000Z",
          outcome: "Another Relay orchestrator is already running.",
        },
      ],
      decisions: [],
      agentRuns: [{
        id: "run_failed",
        agent: "codex",
        role: "implementer",
        mode: "action",
        status: "failed",
        startedAt: "2026-06-07T00:00:00.000Z",
        completedAt: "2026-06-07T00:00:02.000Z",
        exitCode: 1,
        artifactIds: [],
      }],
      artifacts: [],
      finalOutcome: "Another Relay orchestrator is already running.",
    };
    const fetchFn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (String(url) === "http://daemon.local/api/v1/sandboxes/sbx_alice/runs" && init?.method === "POST") {
        return new Response(JSON.stringify({ ...failedSession, events: [] }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (String(url) === "http://daemon.local/api/v1/threads/ses_failed") {
        return new Response(JSON.stringify(failedSession), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected request ${String(url)}`);
    };
    const { RelayDaemonClient } = await import("../../relay-core/src/index.js");
    const client = new RelayDaemonClient({ baseUrl: "http://daemon.local", fetchFn });
    const runner = createDaemonAssignmentRunner(client, "sbx_alice");
    let log = "";

    await assert.rejects(
      () => runner({
        assignments: [{ agent: "codex" }],
        task: "fix auth",
        sessionId: "ses_failed",
        log: (text) => {
          log += text;
        },
      }),
      /Another Relay orchestrator is already running\./,
    );

    assert.match(log, /ERR\s+codex\s+failed \(exit 1\)/);
    assert.match(log, /Another Relay orchestrator is already running\./);
  });

  it("condenses BoxLite single-runtime daemon failures for the TUI", async () => {
    const failureMessage = [
      "Another Relay orchestrator is already running:",
      "  55975 node packages/relay-daemon/dist/cli.js --sandbox-id sbx_bob",
      "Stop it first (only one BoxLite runtime can use /Users/alice/.relay/boxlite/workspace-123456789abc).",
    ].join("\n");
    const failedSession: RelaySession = {
      id: "ses_boxlite_busy",
      workspacePath: "/workspace/alice",
      taskGoal: "fix auth",
      status: "failed",
      phase: "failed",
      participants: ["human", "claude"],
      currentAgent: undefined,
      pendingDecision: undefined,
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:02.000Z",
      events: [
        {
          id: "evt_boxlite_started",
          type: "agent.started",
          sessionId: "ses_boxlite_busy",
          timestamp: "2026-06-07T00:00:00.000Z",
          runId: "run_boxlite_busy",
          agent: "claude",
          role: "implementer",
          mode: "action",
        },
        {
          id: "evt_boxlite_output",
          type: "agent.output",
          sessionId: "ses_boxlite_busy",
          timestamp: "2026-06-07T00:00:01.000Z",
          runId: "run_boxlite_busy",
          agent: "claude",
          stream: "stderr",
          text: `${failureMessage}\n`,
        },
        {
          id: "evt_boxlite_completed",
          type: "agent.completed",
          sessionId: "ses_boxlite_busy",
          timestamp: "2026-06-07T00:00:02.000Z",
          runId: "run_boxlite_busy",
          agent: "claude",
          status: "failed",
          exitCode: 1,
        },
        {
          id: "evt_boxlite_session_failed",
          type: "session.failed",
          sessionId: "ses_boxlite_busy",
          timestamp: "2026-06-07T00:00:02.000Z",
          outcome: failureMessage,
        },
      ],
      decisions: [],
      agentRuns: [{
        id: "run_boxlite_busy",
        agent: "claude",
        role: "implementer",
        mode: "action",
        status: "failed",
        startedAt: "2026-06-07T00:00:00.000Z",
        completedAt: "2026-06-07T00:00:02.000Z",
        exitCode: 1,
        artifactIds: [],
      }],
      artifacts: [],
      finalOutcome: failureMessage,
    };
    const fetchFn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (String(url) === "http://daemon.local/api/v1/sandboxes/sbx_alice/runs" && init?.method === "POST") {
        return new Response(JSON.stringify({ ...failedSession, events: [] }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (String(url) === "http://daemon.local/api/v1/threads/ses_boxlite_busy") {
        return new Response(JSON.stringify(failedSession), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected request ${String(url)}`);
    };
    const { RelayDaemonClient } = await import("../../relay-core/src/index.js");
    const client = new RelayDaemonClient({ baseUrl: "http://daemon.local", fetchFn });
    const runner = createDaemonAssignmentRunner(client, "sbx_alice");
    let log = "";

    await assert.rejects(
      () => runner({
        assignments: [{ agent: "claude" }],
        task: "fix auth",
        sessionId: "ses_boxlite_busy",
        log: (text) => {
          log += text;
        },
      }),
      /Stop the existing Relay daemon first/,
    );

    assert.match(log, /ERR\s+claude\s+failed \(exit 1\)/);
    assert.match(log, /ERR\s+Another Relay orchestrator is already running\. Stop the existing Relay daemon first/);
    assert.equal(log.match(/Another Relay orchestrator is already running/g)?.length, 1);
    assert.doesNotMatch(log, /55975 node packages\/relay-daemon/);
    assert.doesNotMatch(log, /only one BoxLite runtime/);
  });

  it("creates and polls daemon sessions while a Codex run is still in flight", async () => {
    const calls: string[] = [];
    const outputEvent = {
      id: "evt_polled_output",
      type: "agent.output",
      sessionId: "ses_poll",
      timestamp: "2026-06-07T00:00:01.000Z",
      runId: "run_poll",
      agent: "codex",
      stream: "stdout",
      text: JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: "Polled Codex output",
        },
      }) + "\n",
    };
    const session = {
      id: "ses_poll",
      workspacePath: "/workspace/alice",
      taskGoal: "review auth",
      status: "completed",
      phase: "completed",
      participants: ["human", "codex"],
      currentAgent: undefined,
      pendingDecision: undefined,
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:01.000Z",
      events: [outputEvent],
      decisions: [],
      agentRuns: [{ id: "run_poll", agent: "codex", role: "reviewer", mode: "review", status: "completed" }],
      artifacts: [],
    };
    const fetchFn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push(String(url));
      if (String(url) === "http://daemon.local/api/v1/threads" && init?.method === "POST") {
        return new Response(JSON.stringify({ ...session, events: [] }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (String(url) === "http://daemon.local/api/v1/threads/ses_poll") {
        return new Response(JSON.stringify(session), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 450));
      return new Response(JSON.stringify(session), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    };
    const { RelayDaemonClient } = await import("../../relay-core/src/index.js");
    const client = new RelayDaemonClient({ baseUrl: "http://daemon.local", fetchFn });
    const runner = createDaemonAssignmentRunner(client, "sbx_alice");
    let log = "";

    await runner({
      assignments: [{ agent: "codex", mode: "review" }],
      task: "review auth",
      log: (text) => {
        log += text;
      },
    });

    assert.ok(calls.includes("http://daemon.local/api/v1/threads"));
    assert.ok(calls.includes("http://daemon.local/api/v1/threads/ses_poll"));
    assert.match(log, /Polled Codex output/);
  });

  it("sends a daemon cancel request when the daemon runner signal is aborted", async () => {
    let cancelSeen = false;
    let resolveRun: (() => void) | undefined;
    const calls: Array<{ url: string; body?: unknown }> = [];
    const session = {
      id: "ses_cancel",
      workspacePath: "/workspace/alice",
      taskGoal: "cancel auth",
      status: "running",
      phase: "running",
      participants: ["human", "claude"],
      currentAgent: "claude",
      pendingDecision: undefined,
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
      events: [],
      decisions: [],
      agentRuns: [{ id: "run_cancel", agent: "claude", role: "implementer", mode: "action", status: "running" }],
      artifacts: [],
    };
    const cancelledSession = {
      ...session,
      status: "cancelled",
      phase: "cancelled",
      currentAgent: undefined,
      decisions: [{ id: "dec_cancel", kind: "cancel", createdAt: "2026-06-07T00:00:01.000Z", note: "Cancelled by human." }],
      agentRuns: [{ ...session.agentRuns[0], status: "cancelled" }],
    };
    const fetchFn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: String(url), body });
      if (String(url) === "http://daemon.local/api/v1/threads" && init?.method === "POST") {
        return new Response(JSON.stringify(session), { status: 201, headers: { "Content-Type": "application/json" } });
      }
      if (String(url) === "http://daemon.local/api/v1/threads/ses_cancel") {
        return new Response(JSON.stringify(cancelSeen ? cancelledSession : session), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(url) === "http://daemon.local/api/v1/threads/ses_cancel/cancellations") {
        cancelSeen = true;
        resolveRun?.();
        return new Response(JSON.stringify(cancelledSession), { status: 202, headers: { "Content-Type": "application/json" } });
      }
      await new Promise<void>((resolve) => {
        resolveRun = resolve;
      });
      return new Response(JSON.stringify(cancelledSession), { status: 202, headers: { "Content-Type": "application/json" } });
    };
    const { RelayDaemonClient } = await import("../../relay-core/src/index.js");
    const client = new RelayDaemonClient({ baseUrl: "http://daemon.local", fetchFn });
    const runner = createDaemonAssignmentRunner(client, "sbx_alice");
    const controller = new AbortController();
    let updatedStatus = "";

    const running = runner({
      assignments: [{ agent: "claude" }],
      task: "cancel auth",
      log: () => undefined,
      signal: controller.signal,
      onSessionUpdate: (updated) => {
        updatedStatus = updated.status;
      },
    });
    await waitForInput();
    controller.abort();
    await running;

    assert.equal(cancelSeen, true);
    assert.equal(updatedStatus, "cancelled");
    assert.ok(calls.some((call) =>
      call.url === "http://daemon.local/api/v1/threads/ses_cancel/cancellations" &&
      typeof call.body === "object" &&
      call.body !== null &&
      (call.body as { reason?: string }).reason === "Cancelled by human."
    ));
  });

  it("returns the cancelled daemon session when the run wait rejects after abort", async () => {
    let cancelSeen = false;
    let releaseRun: (() => void) | undefined;
    const session: RelaySession = {
      id: "ses_abort_reject",
      workspacePath: "/workspace/alice",
      taskGoal: "cancel auth",
      status: "running",
      phase: "running",
      participants: ["human", "claude"],
      currentAgent: "claude",
      pendingDecision: undefined,
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
      events: [],
      decisions: [],
      agentRuns: [{
        id: "run_abort_reject",
        agent: "claude",
        role: "implementer",
        mode: "action",
        status: "running",
        startedAt: "2026-06-07T00:00:00.000Z",
        artifactIds: [],
      }],
      artifacts: [],
    };
    const cancelledSession: RelaySession = {
      ...session,
      status: "cancelled",
      phase: "cancelled",
      currentAgent: undefined,
      decisions: [{ id: "dec_cancel", kind: "cancel", createdAt: "2026-06-07T00:00:01.000Z", note: "Cancelled by human." }],
      agentRuns: [{ ...session.agentRuns[0], status: "cancelled" }],
    };
    const client = {
      createSession: async () => session,
      getSession: async () => cancelSeen ? cancelledSession : session,
      cancelSandboxRun: async () => {
        cancelSeen = true;
        releaseRun?.();
        return cancelledSession;
      },
      runSandbox: async () => {
        await new Promise<void>((resolve) => {
          releaseRun = resolve;
        });
        throw new Error("Relay daemon request cancelled.");
      },
    } as unknown as RelayDaemonClient;
    const runner = createDaemonAssignmentRunner(client, "sbx_alice");
    const controller = new AbortController();
    let updatedStatus = "";
    let log = "";

    const running = runner({
      assignments: [{ agent: "claude" }],
      task: "cancel auth",
      log: (text) => {
        log += text;
      },
      signal: controller.signal,
      onSessionUpdate: (updated) => {
        updatedStatus = updated.status;
      },
    });
    await waitForInput();
    controller.abort();
    await running;

    assert.equal(cancelSeen, true);
    assert.equal(updatedStatus, "cancelled");
    assert.doesNotMatch(log, /ERR\s+Relay daemon request cancelled/);
  });

  it("waits for the daemon cancel response before completing an aborted run", async () => {
    let cancelSeen = false;
    let releaseRun: (() => void) | undefined;
    let releaseCancel: (() => void) | undefined;
    let completed = false;
    const session: RelaySession = {
      id: "ses_abort_race",
      workspacePath: "/workspace/alice",
      taskGoal: "cancel auth",
      status: "running",
      phase: "running",
      participants: ["human", "claude"],
      currentAgent: "claude",
      pendingDecision: undefined,
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
      events: [],
      decisions: [],
      agentRuns: [{
        id: "run_abort_race",
        agent: "claude",
        role: "implementer",
        mode: "action",
        status: "running",
        startedAt: "2026-06-07T00:00:00.000Z",
        artifactIds: [],
      }],
      artifacts: [],
    };
    const cancelledSession: RelaySession = {
      ...session,
      status: "cancelled",
      phase: "cancelled",
      currentAgent: undefined,
      decisions: [{ id: "dec_cancel", kind: "cancel", createdAt: "2026-06-07T00:00:01.000Z", note: "Cancelled by human." }],
      agentRuns: [{ ...session.agentRuns[0], status: "cancelled" }],
    };
    const client = {
      createSession: async () => session,
      getSession: async () => cancelSeen ? cancelledSession : session,
      cancelSandboxRun: async () => {
        await new Promise<void>((resolve) => {
          releaseCancel = resolve;
        });
        cancelSeen = true;
        return cancelledSession;
      },
      runSandbox: async () => {
        await new Promise<void>((resolve) => {
          releaseRun = resolve;
        });
        throw new Error("Relay daemon request cancelled.");
      },
    } as unknown as RelayDaemonClient;
    const runner = createDaemonAssignmentRunner(client, "sbx_alice");
    const controller = new AbortController();
    let updatedStatus = "";

    const running = runner({
      assignments: [{ agent: "claude" }],
      task: "cancel auth",
      log: () => undefined,
      signal: controller.signal,
      onSessionUpdate: (updated) => {
        updatedStatus = updated.status;
      },
    }).finally(() => {
      completed = true;
    });

    await waitForInput();
    controller.abort();
    await waitForInput();
    releaseRun?.();
    await waitForInput();

    assert.equal(completed, false);
    assert.notEqual(updatedStatus, "cancelled");

    releaseCancel?.();
    await running;

    assert.equal(completed, true);
    assert.equal(updatedStatus, "cancelled");
  });

  it("rejects aborted daemon runs when cancel delivery fails", async () => {
    let runSignal: AbortSignal | undefined;
    const session: RelaySession = {
      id: "ses_cancel_failed",
      workspacePath: "/workspace/alice",
      taskGoal: "cancel auth",
      status: "running",
      phase: "running",
      participants: ["human", "claude"],
      currentAgent: "claude",
      pendingDecision: undefined,
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
      events: [],
      decisions: [],
      agentRuns: [{
        id: "run_cancel_failed",
        agent: "claude",
        role: "implementer",
        mode: "action",
        status: "running",
        startedAt: "2026-06-07T00:00:00.000Z",
        artifactIds: [],
      }],
      artifacts: [],
    };
    const client = {
      createSession: async () => session,
      getSession: async () => session,
      cancelSandboxRun: async () => {
        throw new Error("cancel endpoint unavailable");
      },
      runSandbox: async (input: { signal?: AbortSignal }) => {
        runSignal = input.signal;
        await new Promise<void>((_resolve, reject) => {
          input.signal?.addEventListener("abort", () => reject(new Error("Relay daemon request cancelled.")), { once: true });
        });
        return session;
      },
    } as unknown as RelayDaemonClient;
    const runner = createDaemonAssignmentRunner(client, "sbx_alice");
    const controller = new AbortController();
    let log = "";

    const running = runner({
      assignments: [{ agent: "claude" }],
      task: "cancel auth",
      log: (text) => {
        log += text;
      },
      signal: controller.signal,
    });
    await waitForInput();
    assert.equal(runSignal, controller.signal);
    controller.abort();

    await assert.rejects(running, /cancel endpoint unavailable/);
    assert.match(log, /ERR daemon cancel failed: cancel endpoint unavailable/);
  });

  it("replays daemon Pi output as readable transcript text", async () => {
    const events = [{
      id: "evt_pi_output",
      type: "agent.output" as const,
      sessionId: "ses_pi",
      timestamp: "2026-06-07T00:00:01.000Z",
      runId: "run_pi",
      agent: "pi" as const,
      stream: "stdout" as const,
      text: "Pi response line\nnext line\n",
    }];
    let log = "";

    replayDaemonAgentOutput(events, new Set(), (text) => {
      log += text;
    });

    assert.match(log, /● Pi response line/);
    assert.match(log, /next line/);
  });

  it("replays mixed daemon agent output with readable styled markers", async () => {
    const events = [
      {
        id: "evt_claude_output",
        type: "agent.output" as const,
        sessionId: "ses_mixed",
        timestamp: "2026-06-07T00:00:01.000Z",
        runId: "run_claude",
        agent: "claude" as const,
        stream: "stdout" as const,
        text: JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "Claude implemented it." },
          },
        }) + "\n",
      },
      {
        id: "evt_pi_output",
        type: "agent.output" as const,
        sessionId: "ses_mixed",
        timestamp: "2026-06-07T00:00:02.000Z",
        runId: "run_pi",
        agent: "pi" as const,
        stream: "stdout" as const,
        text: "Pi verified it.\n",
      },
      {
        id: "evt_codex_output",
        type: "agent.output" as const,
        sessionId: "ses_mixed",
        timestamp: "2026-06-07T00:00:03.000Z",
        runId: "run_codex",
        agent: "codex" as const,
        stream: "stdout" as const,
        text: JSON.stringify({
          type: "item.completed",
          item: {
            type: "agent_message",
            text: "Codex approved it.",
          },
        }) + "\n",
      },
    ];
    let log = "";

    replayDaemonAgentOutput(events, new Set(), (text) => {
      log += text;
    });

    assert.match(log, /● Claude implemented it\./);
    assert.match(log, /● Pi verified it\./);
    assert.match(log, /● Codex approved it\./);
    assert.doesNotMatch(log, /stream_event/);
    assert.doesNotMatch(log, /item\.completed/);
  });
});

describe("RelayTui component", () => {
  it("renders the header and input line", async () => {
    const { lastFrame } = render(<RelayTui sessionStore={testSessionStore()} runner={async () => undefined} />);

    const frame = lastFrame() ?? "";
    assert.match(frame, /Relay/);
    assert.match(frame, /Agent Orchestration/);
    assert.match(frame, /cwd/);
    assert.match(frame, />/);
  });

  it("does not submit tasks before the session is ready", async () => {
    const requests: RunRequest[] = [];
    const { lastFrame, stdin } = render(
      <RelayTui
        sessionStore={testSessionStore()}
        ready={false}
        disabledMessage="Starting Relay..."
        runner={async (request) => {
          requests.push(request);
        }}
      />,
    );

    stdin.write("@claude fix auth");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(requests.length, 0);
    assert.match(lastFrame() ?? "", /Starting Relay/);
    assert.match(lastFrame() ?? "", /@claude fix auth/);
  });

  it("exits when the quit command is submitted", async () => {
    let exited = false;
    const { stdin } = render(
      <RelayTui
        sessionStore={testSessionStore()}
        runner={async () => undefined}
        onExit={() => {
          exited = true;
        }}
      />,
    );

    stdin.write("/quit");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    assert.equal(exited, true);
  });

  it("selects @ and / shortcuts from a dropdown", async () => {
    const { lastFrame, stdin } = render(
      <RelayTui
        sessionStore={testSessionStore()}
        runner={async () => undefined}
      />,
    );

    stdin.write("@c");
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.match(lastFrame() ?? "", /@claude/);
    assert.match(lastFrame() ?? "", /@codex/);

    stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.match(lastFrame() ?? "", /@codex/);

    stdin.write("\u007f");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\u007f");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\u007f");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\u007f");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\u007f");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\u007f");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\u007f");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("/h");
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.match(lastFrame() ?? "", /\/handoff/);

    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.match(lastFrame() ?? "", /\/handoff/);
  });

  it("offers the /new and /rename conversation shortcuts", async () => {
    const { lastFrame, stdin } = render(
      <RelayTui
        sessionStore={testSessionStore()}
        runner={async () => undefined}
      />,
    );

    stdin.write("/ne");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(lastFrame() ?? "", /\/new/);

    stdin.write("");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("");
    await new Promise((resolve) => setTimeout(resolve, 20));

    stdin.write("/ren");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(lastFrame() ?? "", /\/rename/);
  });

  it("renames local sessions and lists the custom title", async () => {
    const store = testSessionStore();
    const { lastFrame, stdin } = render(
      <RelayTui
        sessionStore={store}
        runner={async () => undefined}
      />,
    );

    stdin.write("@claude fix auth");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();
    stdin.write("/rename Auth repair");
    await waitForInput();
    stdin.write("\r");
    await waitForFrame(lastFrame, /Renamed to Auth repair/);

    const [session] = await store.listSessions();
    assert.equal(session.title, "Auth repair");

    stdin.write("/sessions");
    await waitForInput();
    stdin.write("\r");
    await waitForFrame(lastFrame, /Auth repair/);
  });

  it("clears transcript state when starting a new conversation", async () => {
    const { lastFrame, stdin } = render(
      <RelayTui
        sessionStore={testSessionStore()}
        runner={async (request) => {
          request.log("\nold transcript line\n");
        }}
      />,
    );

    stdin.write("@claude fix auth");
    await waitForInput();
    stdin.write("\r");
    await waitForFrame(lastFrame, /old transcript line/);

    stdin.write("/new");
    await waitForInput();
    stdin.write("\r");
    const frame = await waitForFrame(lastFrame, /Started a new conversation/);
    assert.doesNotMatch(frame, /old transcript line/);
    assert.match(frame, /No Agent Yet/);
  });

  it("selects agent and command shortcuts with left and right arrows", async () => {
    const { lastFrame, stdin } = render(
      <RelayTui
        sessionStore={testSessionStore()}
        runner={async () => undefined}
      />,
    );

    stdin.write("@c");
    await waitForInput();
    stdin.write("\x1B[C");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    assert.match(lastFrame() ?? "", /@codex/);

    stdin.write("\u007f");
    await waitForInput();
    stdin.write("\u007f");
    await waitForInput();
    stdin.write("\u007f");
    await waitForInput();
    stdin.write("\u007f");
    await waitForInput();
    stdin.write("\u007f");
    await waitForInput();
    stdin.write("\u007f");
    await waitForInput();
    stdin.write("\u007f");
    await waitForInput();
    stdin.write("/r");
    await waitForInput();
    stdin.write("\x1B[D");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    // Left-arrow from the first candidate wraps to the last; with /rename now
    // registered, "/r" yields [/reject, /rerun, /rename] so the wrap lands on it.
    assert.match(lastFrame() ?? "", /\/rename/);
  });

  it("supports delete as an input erase key", async () => {
    const requests: RunRequest[] = [];
    const { stdin } = render(
      <RelayTui
        sessionStore={testSessionStore()}
        runner={async (request) => {
          requests.push(request);
        }}
      />,
    );

    stdin.write("@claude typo");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\u007f");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(requests.length, 1);
    assert.equal(requests[0].task, "typ");
  });

  it("runs a non-Codex task immediately", async () => {
    const requests: RunRequest[] = [];
    const { lastFrame, stdin } = render(
      <RelayTui
        sessionStore={testSessionStore()}
        runner={async (request) => {
          requests.push(request);
        }}
      />,
    );

    stdin.write("@claude fix auth");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].assignments, [{ agent: "claude" }]);
    assert.equal(requests[0].task, "fix auth");
    assert.doesNotMatch(lastFrame() ?? "", /Approve session\?/);
  });

  it("keeps using the last assigned agent until a new one is provided", async () => {
    const requests: RunRequest[] = [];
    const { lastFrame, stdin } = render(
      <RelayTui
        sessionStore={testSessionStore()}
        runner={async (request) => {
          requests.push(request);
        }}
      />,
    );

    stdin.write("@claude fix auth");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    stdin.write("fix billing");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();
    assert.match(lastFrame() ?? "", /· @claude/);

    stdin.write("@pi fix search");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    stdin.write("fix checkout");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();
    assert.match(lastFrame() ?? "", /· @pi/);

    assert.deepEqual(requests.map((request) => request.assignments), [
      [{ agent: "claude" }],
      [{ agent: "claude" }],
      [{ agent: "pi" }],
      [{ agent: "pi" }],
    ]);
    assert.deepEqual(requests.map((request) => request.task), [
      "fix auth",
      "fix billing",
      "fix search",
      "fix checkout",
    ]);
  });

  it("renders markdown transcript lines with cleaner terminal text", async () => {
    const { lastFrame, stdin } = render(
      <RelayTui
        sessionStore={testSessionStore()}
        runner={async (request) => {
          request.log("\n# Plan\n- Use **tests** and `build`\n> shipped\n```json\n{\"ok\":true}\n```\n");
        }}
      />,
    );

    stdin.write("@claude format transcript");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    const frame = lastFrame() ?? "";
    assert.match(frame, /Plan/);
    assert.match(frame, /- Use tests and build/);
    assert.match(frame, /│ shipped/);
    assert.match(frame, /│ \{"ok":true\}/);
    assert.doesNotMatch(frame, /# Plan/);
    assert.doesNotMatch(frame, /\*\*tests\*\*/);
    assert.doesNotMatch(frame, /`build`/);
    assert.doesNotMatch(frame, /```json/);
  });

  it("parses raw SSE and JSON transcript events into markdown output", async () => {
    const { lastFrame, stdin } = render(
      <RelayTui
        sessionStore={testSessionStore()}
        runner={async (request) => {
          request.log(`event: agent.output\ndata: ${JSON.stringify({
            type: "agent.output",
            text: JSON.stringify({
              type: "item.completed",
              item: {
                type: "agent_message",
                text: "# Review\n- **AI response** from JSON",
              },
            }) + "\n",
          })}\n\n`);
          request.log(JSON.stringify({
            type: "item.completed",
            item: {
              type: "agent_message",
              text: "## Direct\n- Use `build`",
            },
          }) + "\n");
          request.log(JSON.stringify({
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Top-level Codex message" }],
          }) + "\n");
          request.log(`● Hi${JSON.stringify({
            type: "streamevent",
            event: {
              type: "contentblockdelta",
              index: 1,
              delta: { type: "textdelta", text: "!" },
            },
            sessionid: "ses_json",
          })}${JSON.stringify({
            type: "streamevent",
            event: {
              type: "contentblockdelta",
              index: 1,
              delta: { type: "textdelta", text: "\nHow" },
            },
            sessionid: "ses_json",
          })}${JSON.stringify({
            type: "streamevent",
            event: {
              type: "contentblockdelta",
              index: 1,
              delta: { type: "textdelta", text: "\ncan" },
            },
            sessionid: "ses_json",
          })}\n`);
        }}
      />,
    );

    stdin.write("@claude parse raw json");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    const frame = lastFrame() ?? "";
    assert.match(frame, /Review/);
    assert.match(frame, /- AI response from JSON/);
    assert.match(frame, /Direct/);
    assert.match(frame, /- Use build/);
    assert.match(frame, /Top-level Codex message/);
    assert.match(frame, /● Hi!/);
    assert.match(frame, /How/);
    assert.match(frame, /can/);
    assert.doesNotMatch(frame, /event: agent\.output/);
    assert.doesNotMatch(frame, /data: /);
    assert.doesNotMatch(frame, /streamevent/);
    assert.doesNotMatch(frame, /contentblockdelta/);
    assert.doesNotMatch(frame, /"type":"agent.output"/);
    assert.doesNotMatch(frame, /\{"type":"item.completed"/);
  });

  it("strips the renderers' inline ANSI from AI responses", async () => {
    const { lastFrame, stdin } = render(
      <RelayTui
        sessionStore={testSessionStore()}
        runner={async (request) => {
          // Mirror what the stream renderers emit in a TTY: a coloured turn
          // marker followed by spoken text and a reasoning line.
          request.log("\x1b[38;5;173m●\x1b[0m Shipping the fix now\n");
          request.log("\x1b[2m\x1b[3m○ weighing options\x1b[0m\n");
          request.log("\nOK  Claude finished.\n");
        }}
      />,
    );

    stdin.write("@claude ship it");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    const frame = lastFrame() ?? "";
    assert.match(frame, /● Shipping the fix now/);
    assert.match(frame, /○ weighing options/);
    assert.match(frame, /OK\s+Claude finished\./);
    // No raw escape sequences from the renderers should survive into the frame.
    assert.doesNotMatch(frame, /38;5;173/);
    assert.doesNotMatch(frame, /\x1b\[2m/);
  });

  it("runs Codex tasks immediately without asking for a mode", async () => {
    const requests: RunRequest[] = [];
    const { lastFrame, stdin } = render(
      <RelayTui
        sessionStore={testSessionStore()}
        runner={async (request) => {
          requests.push(request);
        }}
      />,
    );

    stdin.write("@codex inspect auth");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].assignments, [{ agent: "codex" }]);
    assert.equal(requests[0].task, "inspect auth");
    assert.doesNotMatch(lastFrame() ?? "", /Approve session\?/);
  });

  it("keeps multiple Codex mentions in assignment order", async () => {
    const requests: RunRequest[] = [];
    const { lastFrame, stdin } = render(
      <RelayTui
        sessionStore={testSessionStore()}
        runner={async (request) => {
          requests.push(request);
        }}
      />,
    );

    stdin.write("@codex @claude @codex fix auth");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].assignments, [
      { agent: "codex" },
      { agent: "claude" },
      { agent: "codex" },
    ]);
    assert.equal(requests[0].task, "fix auth");
  });

  it("updates the active session line after completion", async () => {
    const store = testSessionStore();
    const { lastFrame, stdin } = render(
      <RelayTui
        sessionStore={store}
        runner={async (request) => {
          request.controller?.completeSession(request.sessionId ?? "", "Assignments completed.");
        }}
      />,
    );

    stdin.write("@claude fix auth");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    assert.match(lastFrame() ?? "", /completed\/completed/);
  });

  it("does not require approval after submitting a prompt", async () => {
    const requests: RunRequest[] = [];
    const { lastFrame, stdin } = render(
      <RelayTui
        sessionStore={testSessionStore()}
        runner={async (request) => {
          requests.push(request);
        }}
      />,
    );

    stdin.write("@claude fix auth");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();
    assert.doesNotMatch(lastFrame() ?? "", /Approve session\?/);
    assert.equal(requests.length, 1);

    stdin.write("/approve");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    assert.equal(requests.length, 1);
    assert.match(lastFrame() ?? "", /Approval is not required/);
  });

  it("shows an error instead of crashing for unknown sessions", async () => {
    const { lastFrame, stdin } = render(
      <RelayTui
        sessionStore={testSessionStore()}
        runner={async () => undefined}
      />,
    );

    stdin.write("/open missing-session");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    assert.match(lastFrame() ?? "", /Unknown Relay session missing-session/);
  });

  it("runs an active-session handoff immediately", async () => {
    const requests: RunRequest[] = [];
    const store = testSessionStore();
    const { lastFrame, stdin } = render(
      <RelayTui
        sessionStore={store}
        runner={async (request) => {
          requests.push(request);
        }}
      />,
    );

    stdin.write("@claude fix auth");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("/handoff codex verify the fix");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.match(lastFrame() ?? "", /· @codex/);
    assert.doesNotMatch(lastFrame() ?? "", /waiting for \/approve|Approve session/);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].assignments, [{ agent: "codex", mode: "action" }]);
    assert.equal(requests[1].task, "fix auth");
    assert.equal(requests[1].sessionId, requests[0].sessionId);
    const session = await store.getSession(requests[0].sessionId ?? "");
    assert.ok(session.decisions.some((decision) => (
      decision.kind === "handoff"
      && decision.targetAgent === "codex"
      && decision.note === "verify the fix"
    )));
    assert.ok(session.artifacts.some((artifact) => artifact.kind === "plan" && artifact.title === "Assignment plan"));
  });

  it("runs an explicit review handoff for any agent", async () => {
    const requests: RunRequest[] = [];
    const store = testSessionStore();
    const { lastFrame, stdin } = render(
      <RelayTui
        sessionStore={store}
        runner={async (request) => {
          requests.push(request);
        }}
      />,
    );

    stdin.write("@claude fix auth");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();
    stdin.write("/handoff pi --review verify the fix");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    assert.match(lastFrame() ?? "", /· @pi:review/);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].assignments, [{ agent: "pi", mode: "review" }]);
    assert.equal(requests[1].task, "fix auth");
    const session = await store.getSession(requests[0].sessionId ?? "");
    assert.ok(session.decisions.some((decision) => (
      decision.kind === "handoff"
      && decision.targetAgent === "pi"
      && decision.note === "verify the fix"
    )));
  });

  it("runs an active-session handoff in daemon mode", async () => {
    const requests: RunRequest[] = [];
    const { lastFrame, stdin } = render(
      <RelayTui
        localSessionControl={false}
        sessionStore={testSessionStore()}
        workspacePath="/workspace/alice"
        runner={async (request) => {
          requests.push(request);
          request.onSessionUpdate?.({
            id: request.sessionId ?? "ses_daemon",
            workspacePath: request.workspacePath ?? "/workspace/alice",
            taskGoal: request.task,
            participants: ["human", ...request.assignments.map((assignment) => assignment.agent)],
            status: "completed",
            phase: "completed",
            createdAt: "2026-06-07T00:00:00.000Z",
            updatedAt: "2026-06-07T00:00:00.000Z",
            agentRuns: [],
            artifacts: [],
            decisions: [],
            events: [],
            finalOutcome: "Assignments completed.",
          });
        }}
      />,
    );

    stdin.write("@claude fix auth");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();
    stdin.write("/handoff codex verify the fix");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    assert.equal(requests.length, 2);
    assert.equal(requests[0].sessionId, undefined);
    assert.equal(requests[1].sessionId, "ses_daemon");
    assert.deepEqual(requests[1].assignments, [{ agent: "codex", mode: "action" }]);
    assert.equal(requests[1].task, "fix auth");
    assert.match(lastFrame() ?? "", /· @codex/);
  });

  it("does not mark failed daemon assignments as finished", async () => {
    const failureMessage = "Another Relay orchestrator is already running.";
    const { lastFrame, stdin } = render(
      <RelayTui
        localSessionControl={false}
        sessionStore={testSessionStore()}
        workspacePath="/workspace/alice"
        runner={async (request) => {
          request.log("\nERR   codex  failed (exit 1)\n");
          request.log(`\nERR   ${failureMessage}\n`);
          const error = new Error(failureMessage) as Error & { logAlreadyRendered: true };
          error.logAlreadyRendered = true;
          throw error;
        }}
      />,
    );

    stdin.write("@codex fix auth");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    const frame = lastFrame() ?? "";
    assert.match(frame, /ERR\s+Another Relay orchestrator is already running\./);
    assert.equal(frame.match(/ERR\s+Another Relay orchestrator is already running\./g)?.length, 1);
    assert.doesNotMatch(frame, /OK\s+Task finished\./);
  });

  it("lists and opens sessions in daemon mode", async () => {
    const remoteSession: RelaySession = {
      id: "ses_remote",
      workspacePath: "/workspace/alice",
      taskGoal: "remote task",
      participants: ["human", "codex"],
      status: "completed",
      phase: "completed",
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:01.000Z",
      agentRuns: [],
      artifacts: [],
      decisions: [],
      events: [],
      finalOutcome: "Done.",
    };
    const { lastFrame, stdin } = render(
      <RelayTui
        localSessionControl={false}
        sessionStore={testSessionStore()}
        workspacePath="/workspace/alice"
        remoteSessionControl={{
          listSessions: async () => [remoteSession],
          getSession: async (sessionId) => {
            if (sessionId === remoteSession.id) return remoteSession;
            throw new Error(`Unknown Relay session ${sessionId}.`);
          },
          recordDecision: async () => {
            throw new Error("unexpected decision");
          },
          recordHandoff: async () => {
            throw new Error("unexpected handoff");
          },
        }}
        runner={async () => undefined}
      />,
    );

    stdin.write("/sessions");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    assert.match(lastFrame() ?? "", /ses_remote\s+completed\s+remote task/);

    stdin.write("/open ses_remote");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    const frame = lastFrame() ?? "";
    assert.match(frame, /Opened ses_remote/);
    assert.match(frame, /ses_remote completed\/completed/);
  });

  it("waits for remote handoff recording before starting the handoff run", async () => {
    const events: string[] = [];
    let releaseHandoff: (() => void) | undefined;
    const { stdin } = render(
      <RelayTui
        localSessionControl={false}
        sessionStore={testSessionStore()}
        workspacePath="/workspace/alice"
        remoteSessionControl={{
          recordDecision: async () => {
            throw new Error("unexpected decision");
          },
          recordHandoff: async (input) => {
            assert.equal(input.note, "verify the fix");
            events.push("handoff:start");
            await new Promise<void>((resolve) => {
              releaseHandoff = resolve;
            });
            events.push("handoff:end");
            return {
              id: "ses_daemon",
              workspacePath: "/workspace/alice",
              taskGoal: "fix auth",
              participants: ["human", "codex"],
              status: "running",
              phase: "handoff:codex",
              createdAt: "2026-06-07T00:00:00.000Z",
              updatedAt: "2026-06-07T00:00:01.000Z",
              agentRuns: [],
              artifacts: [],
              decisions: [],
              events: [],
            };
          },
        }}
        runner={async (request) => {
          assert.equal(request.task, "fix auth");
          events.push(events.includes("run:initial") ? "run:handoff" : "run:initial");
          request.onSessionUpdate?.({
            id: request.sessionId ?? "ses_daemon",
            workspacePath: request.workspacePath ?? "/workspace/alice",
            taskGoal: request.task,
            participants: ["human", ...request.assignments.map((assignment) => assignment.agent)],
            status: "completed",
            phase: "completed",
            createdAt: "2026-06-07T00:00:00.000Z",
            updatedAt: "2026-06-07T00:00:00.000Z",
            agentRuns: [],
            artifacts: [],
            decisions: [],
            events: [],
            finalOutcome: "Assignments completed.",
          });
        }}
      />,
    );

    stdin.write("@claude fix auth");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();
    stdin.write("/handoff codex verify the fix");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    assert.deepEqual(events, ["run:initial", "handoff:start"]);
    releaseHandoff?.();
    await waitForInput();

    assert.deepEqual(events, ["run:initial", "handoff:start", "handoff:end", "run:handoff"]);
  });

  it("waits for remote rerun recording before starting the rerun", async () => {
    const events: string[] = [];
    let releaseRerun: (() => void) | undefined;
    const { stdin } = render(
      <RelayTui
        localSessionControl={false}
        sessionStore={testSessionStore()}
        workspacePath="/workspace/alice"
        remoteSessionControl={{
          recordDecision: async (input) => {
            assert.equal(input.kind, "rerun");
            events.push("rerun:start");
            await new Promise<void>((resolve) => {
              releaseRerun = resolve;
            });
            events.push("rerun:end");
            return {
              id: "ses_daemon",
              workspacePath: "/workspace/alice",
              taskGoal: "fix auth",
              participants: ["human", "claude"],
              status: "running",
              phase: "rerun:codex",
              createdAt: "2026-06-07T00:00:00.000Z",
              updatedAt: "2026-06-07T00:00:01.000Z",
              agentRuns: [],
              artifacts: [],
              decisions: [],
              events: [],
            };
          },
          recordHandoff: async () => {
            throw new Error("unexpected handoff");
          },
        }}
        runner={async (request) => {
          events.push(request.sessionId ? "run:rerun" : "run:initial");
          request.onSessionUpdate?.({
            id: request.sessionId ?? "ses_daemon",
            workspacePath: request.workspacePath ?? "/workspace/alice",
            taskGoal: request.task,
            participants: ["human", ...request.assignments.map((assignment) => assignment.agent)],
            status: "completed",
            phase: "completed",
            createdAt: "2026-06-07T00:00:00.000Z",
            updatedAt: "2026-06-07T00:00:00.000Z",
            agentRuns: [],
            artifacts: [],
            decisions: [],
            events: [],
            finalOutcome: "Assignments completed.",
          });
        }}
      />,
    );

    stdin.write("@claude fix auth");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();
    stdin.write("/rerun codex");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    assert.deepEqual(events, ["run:initial", "rerun:start"]);
    releaseRerun?.();
    await waitForInput();

    assert.deepEqual(events, ["run:initial", "rerun:start", "rerun:end", "run:rerun"]);
  });

  it("runs a no-note handoff immediately and updates the default assignment", async () => {
    const requests: RunRequest[] = [];
    const { lastFrame, stdin } = render(
      <RelayTui
        sessionStore={testSessionStore()}
        runner={async (request) => {
          requests.push(request);
        }}
      />,
    );

    stdin.write("@claude fix auth");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();
    stdin.write("/handoff codex");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    assert.match(lastFrame() ?? "", /· @codex/);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].assignments, [{ agent: "codex", mode: "action" }]);
    assert.equal(requests[1].task, "fix auth");

    stdin.write("fix billing");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    assert.equal(requests.length, 3);
    assert.deepEqual(requests[2].assignments, [{ agent: "codex", mode: "action" }]);
    assert.equal(requests[2].task, "fix billing");
  });

  it("aborts the active runner when Esc is pressed while running", async () => {
    let seenSignal: AbortSignal | undefined;
    let sessionId = "";
    let resolveRunner: (() => void) | undefined;
    const store = testSessionStore();
    const { lastFrame, stdin } = render(
      <RelayTui
        sessionStore={store}
        runner={async (request) => {
          seenSignal = request.signal;
          sessionId = request.sessionId ?? "";
          await new Promise<void>((resolve) => {
            resolveRunner = resolve;
            request.signal?.addEventListener("abort", () => {
              if (request.sessionId) {
                request.controller?.cancelSession(request.sessionId, "Task cancelled during agent execution.");
              }
              resolve();
            }, { once: true });
          });
        }}
      />,
    );

    stdin.write("@claude fix auth");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\u001b");
    await new Promise((resolve) => setTimeout(resolve, 20));
    resolveRunner?.();
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(seenSignal?.aborted, true);
    assert.equal((await store.getSession(sessionId)).status, "cancelled");
    assert.match(lastFrame() ?? "", /Task cancelled|Cancelling/);
  });

  it("keeps daemon host booting until the daemon-node sandbox is ready", async () => {
    const oldFetch = globalThis.fetch;
    const oldWorkspace = process.env.RELAY_WORKSPACE;
    const oldEmployeeId = process.env.RELAY_EMPLOYEE_ID;
    const oldToken = process.env.RELAY_DAEMON_NODE_TOKEN;
    const oldUiToken = process.env.RELAY_DAEMON_UI_TOKEN;
    const workspace = mkdtempSync(join(tmpdir(), "relay-tui-host-workspace-"));
    const bodies: unknown[] = [];
    const authorizationHeaders: string[] = [];
    let provisionCalls = 0;
    process.env.RELAY_WORKSPACE = workspace;
    process.env.RELAY_EMPLOYEE_ID = "host";
    process.env.RELAY_DAEMON_NODE_TOKEN = "tok_has_under_score";
    delete process.env.RELAY_DAEMON_UI_TOKEN;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      authorizationHeaders.push(String(new Headers(init?.headers).get("authorization") ?? ""));
      if (String(url) === "http://127.0.0.1:8790/api/v1/sandboxes" && init?.method === "POST") {
        provisionCalls += 1;
        if (provisionCalls === 1) {
          return new Response(JSON.stringify({
            id: "sbx_host_stale",
            employeeId: "host",
            workspacePath: workspace,
            status: "provisioning",
            agents: { claude: "unknown", pi: "unknown", codex: "unknown" },
            createdAt: "2026-06-07T00:00:00.000Z",
            updatedAt: "2026-06-07T00:00:00.000Z",
            lastError: "Waiting for daemon node registration.",
          }), { status: 201, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({
          id: "sbx_host",
          employeeId: "host",
          workspacePath: workspace,
          status: "ready",
          agents: { claude: "ready", pi: "ready", codex: "ready" },
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: "2026-06-07T00:00:01.000Z",
        }), { status: 201, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
      const { lastFrame, unmount } = render(<RelayTuiHost onExit={() => undefined} />);
      const bootFrame = await waitForFrame(lastFrame, /EMPLOYEE_ID=host/);
      assert.match(bootFrame, /Waiting for daemon node|Connecting to Relay daemon/);
      assert.match(bootFrame, /SANDBOX_ID=sbx_host_stale/);
      assert.match(bootFrame, /DAEMON_TOKEN=tok_has_under_score/);
      assert.match(bootFrame, /WORKSPACE=/);

      const readyFrame = await waitForFrame(lastFrame, /Host daemon ready/);
      assert.match(readyFrame, /Sandbox sbx_host assigned/);
      assert.equal(provisionCalls, 2);
      assert.ok(bodies.every((body) =>
        typeof body === "object" &&
        body !== null &&
        (body as { workspacePath?: string }).workspacePath === workspace
      ));
      assert.ok(authorizationHeaders.includes("Bearer tok_has_under_score"));
      unmount();
    } finally {
      globalThis.fetch = oldFetch;
      if (oldWorkspace === undefined) {
        delete process.env.RELAY_WORKSPACE;
      } else {
        process.env.RELAY_WORKSPACE = oldWorkspace;
      }
      if (oldEmployeeId === undefined) {
        delete process.env.RELAY_EMPLOYEE_ID;
      } else {
        process.env.RELAY_EMPLOYEE_ID = oldEmployeeId;
      }
      if (oldToken === undefined) {
        delete process.env.RELAY_DAEMON_NODE_TOKEN;
      } else {
        process.env.RELAY_DAEMON_NODE_TOKEN = oldToken;
      }
      if (oldUiToken === undefined) {
        delete process.env.RELAY_DAEMON_UI_TOKEN;
      } else {
        process.env.RELAY_DAEMON_UI_TOKEN = oldUiToken;
      }
    }
  });

  it("uses the available live daemon node token instead of a stale TUI token", async () => {
    const oldFetch = globalThis.fetch;
    const oldWorkspace = process.env.RELAY_WORKSPACE;
    const oldEmployeeId = process.env.RELAY_EMPLOYEE_ID;
    const oldToken = process.env.RELAY_DAEMON_NODE_TOKEN;
    const oldUiToken = process.env.RELAY_DAEMON_UI_TOKEN;
    const workspace = mkdtempSync(join(tmpdir(), "relay-tui-live-node-"));
    const bodies: unknown[] = [];
    const authorizationHeaders: string[] = [];
    process.env.RELAY_WORKSPACE = workspace;
    process.env.RELAY_EMPLOYEE_ID = "alice";
    process.env.RELAY_DAEMON_NODE_TOKEN = "tok_stale";
    delete process.env.RELAY_DAEMON_UI_TOKEN;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      authorizationHeaders.push(String(new Headers(init?.headers).get("authorization") ?? ""));
      if (String(url) === "http://127.0.0.1:8790/api/v1/daemon-nodes") {
        return new Response(JSON.stringify({
          nodes: [{
            id: "sbx_alice_live",
            employeeId: "alice",
            workspacePath: workspace,
            status: "ready",
            agents: { claude: "ready", pi: "ready", codex: "ready" },
            createdAt: "2026-06-07T00:00:00.000Z",
            updatedAt: "2026-06-07T00:00:01.000Z",
            lastSeenAt: "2026-06-07T00:00:01.000Z",
            queuedCommandCount: 0,
            activeRuns: [],
            online: true,
            stale: false,
            nodeToken: "tok_live",
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(url) === "http://127.0.0.1:8790/api/v1/sandboxes" && init?.method === "POST") {
        return new Response(JSON.stringify({
          id: "sbx_alice_live",
          employeeId: "alice",
          workspacePath: workspace,
          status: "ready",
          agents: { claude: "ready", pi: "ready", codex: "ready" },
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: "2026-06-07T00:00:01.000Z",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
      const { lastFrame, unmount } = render(<RelayTuiHost onExit={() => undefined} />);
      await waitForFrame(lastFrame, /Host daemon ready/);

      assert.match(lastFrame() ?? "", /Host daemon ready/);
      assert.match(lastFrame() ?? "", new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.ok(bodies.some((body) =>
        typeof body === "object" &&
        body !== null &&
        (body as { employeeId?: string; nodeToken?: string; workspacePath?: string }).employeeId === "alice" &&
        (body as { nodeToken?: string }).nodeToken === "tok_live" &&
        (body as { workspacePath?: string }).workspacePath === workspace
      ));
      assert.ok(authorizationHeaders.includes("Bearer tok_live"));
      unmount();
    } finally {
      globalThis.fetch = oldFetch;
      if (oldWorkspace === undefined) {
        delete process.env.RELAY_WORKSPACE;
      } else {
        process.env.RELAY_WORKSPACE = oldWorkspace;
      }
      if (oldEmployeeId === undefined) {
        delete process.env.RELAY_EMPLOYEE_ID;
      } else {
        process.env.RELAY_EMPLOYEE_ID = oldEmployeeId;
      }
      if (oldToken === undefined) {
        delete process.env.RELAY_DAEMON_NODE_TOKEN;
      } else {
        process.env.RELAY_DAEMON_NODE_TOKEN = oldToken;
      }
      if (oldUiToken === undefined) {
        delete process.env.RELAY_DAEMON_UI_TOKEN;
      } else {
        process.env.RELAY_DAEMON_UI_TOKEN = oldUiToken;
      }
    }
  });

  it("provisions the explicitly requested sandbox id in daemon host mode", async () => {
    const oldFetch = globalThis.fetch;
    const oldWorkspace = process.env.RELAY_WORKSPACE;
    const oldEmployeeId = process.env.RELAY_EMPLOYEE_ID;
    const oldToken = process.env.RELAY_DAEMON_NODE_TOKEN;
    const oldUiToken = process.env.RELAY_DAEMON_UI_TOKEN;
    const oldRelaySandboxId = process.env.RELAY_SANDBOX_ID;
    const oldSandboxId = process.env.SANDBOX_ID;
    const workspace = mkdtempSync(join(tmpdir(), "relay-tui-explicit-sandbox-"));
    const bodies: unknown[] = [];
    const authorizationHeaders: string[] = [];
    process.env.RELAY_WORKSPACE = workspace;
    process.env.RELAY_EMPLOYEE_ID = "admin";
    process.env.RELAY_DAEMON_NODE_TOKEN = "tok_bob";
    process.env.RELAY_SANDBOX_ID = "sbx_bob";
    delete process.env.RELAY_DAEMON_UI_TOKEN;
    delete process.env.SANDBOX_ID;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      authorizationHeaders.push(String(new Headers(init?.headers).get("authorization") ?? ""));
      if (String(url) === "http://127.0.0.1:8790/api/v1/daemon-nodes") {
        return new Response(JSON.stringify({ nodes: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(url) === "http://127.0.0.1:8790/api/v1/sandboxes" && init?.method === "POST") {
        return new Response(JSON.stringify({
          id: "sbx_bob",
          employeeId: "bob",
          workspacePath: workspace,
          status: "ready",
          agents: { claude: "ready", pi: "ready", codex: "ready" },
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: "2026-06-07T00:00:01.000Z",
        }), { status: 201, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
      const { lastFrame, unmount } = render(<RelayTuiHost onExit={() => undefined} />);
      await waitForFrame(lastFrame, /Host daemon ready/);

      assert.match(lastFrame() ?? "", /Host daemon ready/);
      assert.match(lastFrame() ?? "", /Sandbox sbx_bob assigned/);
      assert.ok(bodies.some((body) =>
        typeof body === "object" &&
        body !== null &&
        (body as { employeeId?: string; nodeToken?: string; sandboxId?: string }).employeeId === "admin" &&
        (body as { nodeToken?: string }).nodeToken === "tok_bob" &&
        (body as { sandboxId?: string }).sandboxId === "sbx_bob"
      ));
      assert.ok(authorizationHeaders.includes("Bearer tok_bob"));
      unmount();
    } finally {
      globalThis.fetch = oldFetch;
      if (oldWorkspace === undefined) {
        delete process.env.RELAY_WORKSPACE;
      } else {
        process.env.RELAY_WORKSPACE = oldWorkspace;
      }
      if (oldEmployeeId === undefined) {
        delete process.env.RELAY_EMPLOYEE_ID;
      } else {
        process.env.RELAY_EMPLOYEE_ID = oldEmployeeId;
      }
      if (oldToken === undefined) {
        delete process.env.RELAY_DAEMON_NODE_TOKEN;
      } else {
        process.env.RELAY_DAEMON_NODE_TOKEN = oldToken;
      }
      if (oldUiToken === undefined) {
        delete process.env.RELAY_DAEMON_UI_TOKEN;
      } else {
        process.env.RELAY_DAEMON_UI_TOKEN = oldUiToken;
      }
      if (oldRelaySandboxId === undefined) {
        delete process.env.RELAY_SANDBOX_ID;
      } else {
        process.env.RELAY_SANDBOX_ID = oldRelaySandboxId;
      }
      if (oldSandboxId === undefined) {
        delete process.env.SANDBOX_ID;
      } else {
        process.env.SANDBOX_ID = oldSandboxId;
      }
    }
  });
});
