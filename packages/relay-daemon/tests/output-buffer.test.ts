import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OutputEventBuffer } from "../src/output-event-buffer.js";

describe("OutputEventBuffer", () => {
  it("coalesces adjacent chunks from the same stream", () => {
    const emitted: Array<{ stream: "stdout" | "stderr"; text: string }> = [];
    const buffer = new OutputEventBuffer((stream, text) => emitted.push({ stream, text }), {
      delayMs: 1_000,
      maxChars: 32_768,
    });

    buffer.push("stdout", "one");
    buffer.push("stdout", " two");
    buffer.flush();

    assert.deepEqual(emitted, [{ stream: "stdout", text: "one two" }]);
    buffer.close();
  });

  it("bounds emissions when stdout and stderr alternate", () => {
    const emitted: Array<{ stream: "stdout" | "stderr"; text: string }> = [];
    const buffer = new OutputEventBuffer((stream, text) => emitted.push({ stream, text }), {
      delayMs: 1_000,
      maxChars: 32_768,
    });

    buffer.push("stdout", "out-1");
    buffer.push("stderr", "err");
    buffer.push("stdout", "out-2");
    buffer.flush();

    assert.deepEqual(emitted, [
      { stream: "stdout", text: "out-1out-2" },
      { stream: "stderr", text: "err" },
    ]);
    buffer.close();
  });

  it("flushes immediately at the bounded character budget", () => {
    const emitted: string[] = [];
    const buffer = new OutputEventBuffer((_stream, text) => emitted.push(text), {
      delayMs: 1_000,
      maxChars: 5,
    });

    buffer.push("stdout", "hello");

    assert.deepEqual(emitted, ["hello"]);
    buffer.close();
  });

  it("flushes after the latency window", async () => {
    const emitted: string[] = [];
    const buffer = new OutputEventBuffer((_stream, text) => emitted.push(text), {
      delayMs: 5,
      maxChars: 32_768,
    });

    buffer.push("stdout", "live");
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(emitted, ["live"]);
    buffer.close();
  });
});
