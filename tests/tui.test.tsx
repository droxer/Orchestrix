import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { render } from "ink-testing-library";

import {
  RelayTui,
  parseAssignedTask,
  taskNeedsCodexMode,
  validateParsedTask,
  type RunRequest,
} from "../src/tui.js";

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

  it("requires Codex mode when Codex is assigned", () => {
    assert.equal(taskNeedsCodexMode(parseAssignedTask("@codex review auth")), true);
    assert.equal(taskNeedsCodexMode(parseAssignedTask("@claude fix auth")), false);
  });
});

describe("RelayTui component", () => {
  it("renders the header and input line", () => {
    const { lastFrame } = render(<RelayTui runner={async () => undefined} />);

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

  it("supports delete as an input erase key", async () => {
    const requests: RunRequest[] = [];
    const { stdin } = render(
      <RelayTui
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

  it("submits a non-Codex task to the runner", async () => {
    const requests: RunRequest[] = [];
    const { stdin } = render(
      <RelayTui
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
  });

  it("asks for Codex mode before submitting Codex tasks", async () => {
    const requests: RunRequest[] = [];
    const { lastFrame, stdin } = render(
      <RelayTui
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

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].assignments, [{ agent: "codex", codexMode: "review" }]);
    assert.equal(requests[0].task, "inspect auth");
  });

  it("asks for each Codex mention independently", async () => {
    const requests: RunRequest[] = [];
    const { stdin } = render(
      <RelayTui
        runner={async (request) => {
          requests.push(request);
        }}
      />,
    );

    stdin.write("@codex @claude @codex fix auth");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
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

  it("aborts the active runner when Esc is pressed while running", async () => {
    let seenSignal: AbortSignal | undefined;
    let resolveRunner: (() => void) | undefined;
    const { lastFrame, stdin } = render(
      <RelayTui
        runner={async (request) => {
          seenSignal = request.signal;
          await new Promise<void>((resolve) => {
            resolveRunner = resolve;
            request.signal?.addEventListener("abort", () => resolve(), { once: true });
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
    assert.match(lastFrame() ?? "", /Task cancelled|Cancelling/);
  });
});
