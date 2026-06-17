import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractLastAssistantText } from "../src/last-assistant-text.js";

describe("extractLastAssistantText", () => {
  it("returns null for empty or whitespace-only input", () => {
    assert.equal(extractLastAssistantText(""), null);
    assert.equal(extractLastAssistantText("   \n\n"), null);
  });

  it("returns null when no '●' marker is present", () => {
    assert.equal(extractLastAssistantText("no marker here\njust text"), null);
  });

  it("returns the trimmed text of the last '●' segment", () => {
    const transcript = "● first turn\nsome body\n● second turn\nthe answer\n⏺ tool noise";
    assert.equal(extractLastAssistantText(transcript), "second turn\nthe answer");
  });

  it("ignores '○' (thinking) and '⏺' (tool) markers", () => {
    const transcript = "○ thinking line\n● real text\nbody\n⏺ tool";
    assert.equal(extractLastAssistantText(transcript), "real text\nbody");
  });

  it("returns null when '●' segments exist but are empty after trimming", () => {
    assert.equal(extractLastAssistantText("●   \n   \n"), null);
  });
});
