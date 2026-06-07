import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { render } from "ink-testing-library";

import {
  RelayTui,
  completeShortcutInput,
  createDaemonAssignmentRunner,
  shortcutSuggestions,
  parseAssignedTask,
  validateParsedTask,
  withDefaultAssignments,
  type RunRequest,
} from "../packages/relay-tui/src/tui.js";
import { LocalSessionStore } from "../packages/relay-daemon/src/index.js";

function testSessionStore(): LocalSessionStore {
  return new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-tui-")));
}

async function waitForInput(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("TUI task parsing", () => {
  it("parses a single Claude assignment", () => {
    const parsed = parseAssignedTask("@claude fix auth middleware");

    assert.deepEqual(parsed.assignments, [{ agent: "claude" }]);
    assert.equal(parsed.task, "fix auth middleware");
  });

  it("parses multiple assignments in mention order", () => {
    const parsed = parseAssignedTask("@claude @pi fix auth middleware");

    assert.deepEqual(parsed.assignments, [{ agent: "claude" }, { agent: "pi" }]);
    assert.equal(parsed.task, "fix auth middleware");
  });

  it("keeps non-leading mentions in task text", () => {
    const parsed = parseAssignedTask("@claude update README to explain @codex review mode");

    assert.deepEqual(parsed.assignments, [{ agent: "claude" }]);
    assert.equal(parsed.task, "update README to explain @codex review mode");
  });

  it("keeps unknown leading mentions in task text", () => {
    const parsed = parseAssignedTask("@gemini @claude fix auth middleware");

    assert.deepEqual(parsed.assignments, []);
    assert.equal(parsed.task, "@gemini @claude fix auth middleware");
  });

  it("rejects empty task text after mentions", () => {
    const parsed = parseAssignedTask("@claude @pi");

    assert.equal(validateParsedTask(parsed), "Enter a task after the @mentions.");
  });

  it("rejects tasks without an explicit agent assignment", () => {
    const parsed = parseAssignedTask("fix auth middleware");

    assert.deepEqual(parsed.assignments, []);
    assert.equal(parsed.task, "fix auth middleware");
    assert.equal(validateParsedTask(parsed), "Assign the task with @claude, @pi, or @codex.");
  });

  it("applies default assignments only when the task has no leading mention", () => {
    assert.deepEqual(withDefaultAssignments(parseAssignedTask("fix auth middleware"), [{ agent: "claude" }]), {
      assignments: [{ agent: "claude" }],
      task: "fix auth middleware",
    });
    assert.deepEqual(withDefaultAssignments(parseAssignedTask("@pi fix auth middleware"), [{ agent: "claude" }]), {
      assignments: [{ agent: "pi" }],
      task: "fix auth middleware",
    });
  });

  it("completes agent mention shortcuts", () => {
    assert.deepEqual(completeShortcutInput("@c"), {
      input: "@claude",
      completed: true,
      candidates: ["@claude", "@codex"],
    });
    assert.equal(completeShortcutInput("@claude").input, "@pi");
    assert.equal(completeShortcutInput("@claude @p").input, "@claude @pi");
  });

  it("completes slash command shortcuts", () => {
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

  it("finds shortcut dropdown suggestions for the current token", () => {
    assert.deepEqual(shortcutSuggestions("@c")?.candidates, ["@claude", "@codex"]);
    assert.deepEqual(shortcutSuggestions("@claude /r")?.candidates, ["/reject", "/rerun"]);
    assert.equal(shortcutSuggestions("@unknown"), null);
  });

});

describe("TUI daemon runner", () => {
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
            text: JSON.stringify({
              type: "item.completed",
              item: {
                type: "agent_message",
                text: "AI response from daemon",
              },
            }) + "\n",
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
    const { RelayDaemonClient } = await import("../packages/relay-daemon/src/index.js");
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
    assert.match(log, /AI response from daemon/);
    assert.doesNotMatch(log, /\{"type":"item.completed"/);
  });
});

describe("RelayTui component", () => {
  it("renders the header and input line", () => {
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
          request.log("\n# Plan\n- Use **tests** and `build`\n> shipped\n```ts\nconst ok = true;\n```\n");
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
    assert.match(frame, /│ const ok = true;/);
    assert.doesNotMatch(frame, /# Plan/);
    assert.doesNotMatch(frame, /\*\*tests\*\*/);
    assert.doesNotMatch(frame, /`build`/);
    assert.doesNotMatch(frame, /```ts/);
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
                request.controller?.failSession(request.sessionId, "Task cancelled during agent execution.");
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
    assert.equal(store.getSession(sessionId).status, "failed");
    assert.match(lastFrame() ?? "", /Task cancelled|Cancelling/);
  });
});
