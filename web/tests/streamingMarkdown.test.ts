import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { splitStreamingMarkdown } from "../src/lib/streamingMarkdown.js";

describe("splitStreamingMarkdown", () => {
  it("keeps an empty live text node for the streaming caret", () => {
    assert.deepEqual(splitStreamingMarkdown(""), [
      { kind: "text", text: "" },
    ]);
  });

  it("separates completed code fences from the live plain-text tail", () => {
    const text = [
      "Starting analysis.",
      "```ts",
      "const answer: number = 42;",
      "```",
      "Still typing the explanation",
    ].join("\n");

    assert.deepEqual(splitStreamingMarkdown(text), [
      { kind: "text", text: "Starting analysis.\n" },
      { kind: "markdown", text: "```ts\nconst answer: number = 42;\n```\n" },
      { kind: "text", text: "Still typing the explanation" },
    ]);
  });

  it("keeps an unfinished fence in the plain-text tail", () => {
    const text = "Before\n```ts\nconst answer =";

    assert.deepEqual(splitStreamingMarkdown(text), [
      { kind: "text", text },
    ]);
  });

  it("supports tilde fences and longer closing delimiters", () => {
    const text = "~~~python\nprint('ok')\n~~~~\n";

    assert.deepEqual(splitStreamingMarkdown(text), [
      { kind: "markdown", text },
    ]);
  });
});
