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
  shortcutSuggestions,
  parseAssignedTask,
  validateParsedTask,
  type RunRequest,
} from "../src/tui.js";
import { LocalSessionStore } from "../src/relay.js";

function testSessionStore(): LocalSessionStore {
  return new LocalSessionStore(mkdtempSync(join(tmpdir(), "relay-tui-")));
}

async function waitForInput(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
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
    assert.equal(completeShortcutInput("/approve").input, "/reject");
    assert.equal(completeShortcutInput("fix auth").completed, false);
  });

  it("finds shortcut dropdown suggestions for the current token", () => {
    assert.deepEqual(shortcutSuggestions("@c")?.candidates, ["@claude", "@codex"]);
    assert.deepEqual(shortcutSuggestions("@claude /r")?.candidates, ["/reject", "/rerun"]);
    assert.equal(shortcutSuggestions("@unknown"), null);
  });

});

describe("RelayTui component", () => {
  it("renders the header and input line", () => {
    const { lastFrame } = render(<RelayTui sessionStore={testSessionStore()} runner={async () => undefined} />);

    const frame = lastFrame() ?? "";
    assert.match(frame, /== Relay/);
    assert.match(frame, /INFO/);
    assert.match(frame, /workspace/);
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
    stdin.write("/approve");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(requests.length, 1);
    assert.equal(requests[0].task, "typ");
  });

  it("submits a non-Codex task to the runner", async () => {
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
    assert.equal(requests.length, 0);
    assert.match(lastFrame() ?? "", /Pending approval/);

    stdin.write("/approve");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].assignments, [{ agent: "claude" }]);
    assert.equal(requests[0].task, "fix auth");
  });

  it("asks for Codex mode before submitting Codex tasks for approval", async () => {
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

    assert.match(lastFrame() ?? "", /Codex mode/);
    assert.equal(requests.length, 0);

    stdin.write("r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(lastFrame() ?? "", /Pending approval/);

    stdin.write("/approve");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].assignments, [{ agent: "codex", codexMode: "review" }]);
    assert.equal(requests[0].task, "inspect auth");
  });

  it("asks for each Codex mention independently", async () => {
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
    assert.match(lastFrame() ?? "", /Codex mode:.*#1/);
    stdin.write("r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(lastFrame() ?? "", /Codex mode:.*#3/);
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(lastFrame() ?? "", /Pending approval/);
    stdin.write("/approve");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].assignments, [
      { agent: "codex", codexMode: "review" },
      { agent: "claude" },
      { agent: "codex", codexMode: "implement" },
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
    stdin.write("/approve");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    assert.match(lastFrame() ?? "", /SESSION .* completed completed/);
  });

  it("rejects a pending session without allowing a later approval to run", async () => {
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
    assert.match(lastFrame() ?? "", /Pending approval/);

    stdin.write("/reject missing tests");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();
    assert.doesNotMatch(lastFrame() ?? "", /Pending approval/);
    assert.match(lastFrame() ?? "", /waiting_for_human feedback/);

    stdin.write("/approve");
    await waitForInput();
    stdin.write("\r");
    await waitForInput();

    assert.equal(requests.length, 0);
    assert.match(lastFrame() ?? "", /No pending session to approve/);
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

  it("hands an active session off to another agent", async () => {
    const requests: RunRequest[] = [];
    const { stdin } = render(
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
    stdin.write("/approve");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("/handoff codex verify the fix");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].assignments, [{ agent: "codex", codexMode: "review" }]);
    assert.match(requests[1].task, /fix auth/);
    assert.match(requests[1].task, /verify the fix/);
    assert.equal(requests[1].sessionId, requests[0].sessionId);
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
    stdin.write("/approve");
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
