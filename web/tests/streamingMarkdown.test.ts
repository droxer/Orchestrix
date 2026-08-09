import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { splitStreamingMarkdown } from "../src/lib/streamingMarkdown.js";

describe("splitStreamingMarkdown", () => {
  it("keeps an empty live text node for the streaming caret", () => {
    assert.deepEqual(splitStreamingMarkdown(""), [
      { kind: "text", text: "" },
    ]);
  });

  it("renders settled prose and completed code fences as stable markdown", () => {
    const text = [
      "Starting analysis.",
      "```ts",
      "const answer: number = 42;",
      "```",
      "Still typing the explanation",
    ].join("\n");

    assert.deepEqual(splitStreamingMarkdown(text), [
      { kind: "markdown", text: "Starting analysis.\n" },
      { kind: "markdown", text: "```ts\nconst answer: number = 42;\n```\n" },
      { kind: "text", text: "Still typing the explanation" },
    ]);
  });

  it("freezes blank-line-terminated prose blocks while the tail keeps growing", () => {
    const text = "# Result\n\n- one\n- two\n\nStill typing";

    assert.deepEqual(splitStreamingMarkdown(text), [
      { kind: "markdown", text: "# Result\n\n- one\n- two\n\n" },
      { kind: "text", text: "Still typing" },
    ]);
  });

  it("settles only the unfinished tail into markdown", () => {
    const text = "# Result\n\nStill typing";

    assert.deepEqual(splitStreamingMarkdown(text, false), [
      { kind: "markdown", text: "# Result\n\n" },
      { kind: "markdown", text: "Still typing" },
    ]);
  });

  it("keeps an unfinished fence in the plain-text tail after settled prose", () => {
    const text = "Before\n```ts\nconst answer =";

    assert.deepEqual(splitStreamingMarkdown(text), [
      { kind: "markdown", text: "Before\n" },
      { kind: "text", text: "```ts\nconst answer =" },
    ]);
  });

  it("supports tilde fences and longer closing delimiters", () => {
    const text = "~~~python\nprint('ok')\n~~~~\n";

    assert.deepEqual(splitStreamingMarkdown(text), [
      { kind: "markdown", text },
    ]);
  });
});

describe("streaming prose continuity", () => {
  it("uses one prose component before and after settlement", () => {
    const source = readFileSync("web/src/components/AgentStream.tsx", "utf8");

    assert.match(source, /<StreamingProse text=\{visibleText\} live=\{live\} \/>/);
    assert.doesNotMatch(source, /live\s*\?\s*\(?\s*<StreamingProse/);
  });
});
