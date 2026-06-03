import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { render } from "ink-testing-library";

import {
  OrchestrixTui,
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

describe("OrchestrixTui component", () => {
  it("renders the header and input line", () => {
    const { lastFrame } = render(<OrchestrixTui runner={async () => undefined} />);

    const frame = lastFrame() ?? "";
    assert.match(frame, /Orchestrix/);
    assert.match(frame, /workspace/);
    assert.match(frame, />/);
  });

  it("submits a non-Codex task to the runner", async () => {
    const requests: RunRequest[] = [];
    const { stdin } = render(
      <OrchestrixTui
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
      <OrchestrixTui
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
      <OrchestrixTui
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
});
