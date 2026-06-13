import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { backendArgs, daemonArgs, resolveLocalRunConfig } from "../src/local-run.js";
import { LocalSessionStore } from "../../relay-core/src/index.js";

function testSessionStore(): LocalSessionStore {
  return new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-tui-")));
}

async function waitForInput(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
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
    assert.deepEqual(shortcutSuggestions("@claude /r")?.candidates, ["/reject", "/rerun"]);
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
      assignments: [{ agent: "codex", codexMode: "review" }],
      task: "review auth",
      sessionId: "ses_existing",
      log: (text) => {
        log += text;
      },
      onSessionUpdate: (session) => {
        updatedSession = session.id;
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://daemon.local/sandboxes/sbx_alice/runs");
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
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
      if (String(url) === "http://daemon.local/sessions" && init?.method === "POST") {
        return new Response(JSON.stringify({ ...session, events: [] }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (String(url) === "http://daemon.local/sessions/ses_poll") {
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
      assignments: [{ agent: "codex", codexMode: "review" }],
      task: "review auth",
      log: (text) => {
        log += text;
      },
    });

    assert.ok(calls.includes("http://daemon.local/sessions"));
    assert.ok(calls.includes("http://daemon.local/sessions/ses_poll"));
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
      agentRuns: [{ id: "run_cancel", agent: "claude", role: "implementer", mode: "implement", status: "running" }],
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
      if (String(url) === "http://daemon.local/sessions" && init?.method === "POST") {
        return new Response(JSON.stringify(session), { status: 201, headers: { "Content-Type": "application/json" } });
      }
      if (String(url) === "http://daemon.local/sessions/ses_cancel") {
        return new Response(JSON.stringify(cancelSeen ? cancelledSession : session), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(url) === "http://daemon.local/sandboxes/sbx_alice/runs/ses_cancel/cancel") {
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
      call.url === "http://daemon.local/sandboxes/sbx_alice/runs/ses_cancel/cancel" &&
      typeof call.body === "object" &&
      call.body !== null &&
      (call.body as { reason?: string }).reason === "Cancelled by human."
    ));
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
    assert.match(frame, /agent orchestration/);
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

    assert.match(lastFrame() ?? "", /\/rerun/);
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
    stdin.write("/handoff codex verify the fix");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.match(lastFrame() ?? "", /· @codex/);
    assert.doesNotMatch(lastFrame() ?? "", /waiting for \/approve|Approve session/);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].assignments, [{ agent: "codex", codexMode: "review" }]);
    assert.match(requests[1].task, /fix auth/);
    assert.match(requests[1].task, /verify the fix/);
    assert.equal(requests[1].sessionId, requests[0].sessionId);
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
    assert.deepEqual(requests[1].assignments, [{ agent: "codex", codexMode: "review" }]);
    assert.match(requests[1].task, /verify the fix/);
    assert.match(lastFrame() ?? "", /· @codex/);
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
    assert.deepEqual(requests[1].assignments, [{ agent: "codex", codexMode: "review" }]);
    assert.equal(requests[1].task, "fix auth");

    stdin.write("fix billing");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    assert.equal(requests.length, 3);
    assert.deepEqual(requests[2].assignments, [{ agent: "codex" }]);
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
    const workspace = mkdtempSync(join(tmpdir(), "relay-tui-host-workspace-"));
    const bodies: unknown[] = [];
    let sandboxPolls = 0;
    process.env.RELAY_WORKSPACE = workspace;
    process.env.RELAY_EMPLOYEE_ID = "host";
    process.env.RELAY_DAEMON_NODE_TOKEN = "tok_has_under_score";
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      if (String(url) === "http://127.0.0.1:8790/sandboxes" && init?.method === "POST") {
        return new Response(JSON.stringify({
          id: "sbx_host",
          employeeId: "host",
          workspacePath: workspace,
          status: "provisioning",
          agents: { claude: "unknown", pi: "unknown", codex: "unknown" },
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: "2026-06-07T00:00:00.000Z",
        }), { status: 201, headers: { "Content-Type": "application/json" } });
      }
      if (String(url) === "http://127.0.0.1:8790/sandboxes/sbx_host") {
        sandboxPolls += 1;
        return new Response(JSON.stringify({
          id: "sbx_host",
          employeeId: "host",
          workspacePath: workspace,
          status: sandboxPolls >= 1 ? "ready" : "provisioning",
          agents: { claude: "ready", pi: "ready", codex: "ready" },
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: "2026-06-07T00:00:01.000Z",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
      const { lastFrame, unmount } = render(<RelayTuiHost onExit={() => undefined} />);
      await waitForInput();
      const bootFrame = lastFrame() ?? "";
      assert.match(bootFrame, /Waiting for daemon node|Connecting to Relay daemon/);
      assert.match(bootFrame, /EMPLOYEE_ID=host/);
      assert.match(bootFrame, /SANDBOX_ID=sbx_host/);
      assert.match(bootFrame, /DAEMON_TOKEN=tok_has_under_score/);
      assert.doesNotMatch(bootFrame, /WORKSPACE=/);
      await new Promise((resolve) => setTimeout(resolve, 450));

      assert.match(lastFrame() ?? "", /Host daemon ready/);
      assert.ok(bodies.every((body) =>
        typeof body === "object" &&
        body !== null &&
        !("workspacePath" in body)
      ));
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
    }
  });

  it("uses the available live daemon node token instead of a stale TUI token", async () => {
    const oldFetch = globalThis.fetch;
    const oldWorkspace = process.env.RELAY_WORKSPACE;
    const oldEmployeeId = process.env.RELAY_EMPLOYEE_ID;
    const oldToken = process.env.RELAY_DAEMON_NODE_TOKEN;
    const workspace = mkdtempSync(join(tmpdir(), "relay-tui-live-node-"));
    const bodies: unknown[] = [];
    process.env.RELAY_WORKSPACE = workspace;
    process.env.RELAY_EMPLOYEE_ID = "alice";
    process.env.RELAY_DAEMON_NODE_TOKEN = "tok_stale";
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      if (String(url) === "http://127.0.0.1:8790/cp/daemon-nodes") {
        return new Response(JSON.stringify({
          nodes: [{
            id: "sbx_alice_live",
            employeeId: "alice",
            workspacePath: "/workspace/live",
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
      if (String(url) === "http://127.0.0.1:8790/sandboxes" && init?.method === "POST") {
        return new Response(JSON.stringify({
          id: "sbx_alice_live",
          employeeId: "alice",
          workspacePath: "/workspace/live",
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
      await new Promise((resolve) => setTimeout(resolve, 250));

      assert.match(lastFrame() ?? "", /Host daemon ready/);
      assert.match(lastFrame() ?? "", /\/workspace\/live/);
      assert.ok(bodies.some((body) =>
        typeof body === "object" &&
        body !== null &&
        (body as { employeeId?: string; nodeToken?: string; workspacePath?: string }).employeeId === "alice" &&
        (body as { nodeToken?: string }).nodeToken === "tok_live" &&
        !("workspacePath" in body)
      ));
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
    }
  });
});
