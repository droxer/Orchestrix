import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  advanceStreamingText,
  initialStreamingText,
  nextStreamingTextLength,
  reconcileStreamingText,
} from "../src/lib/smoothStreamingText.js";

describe("nextStreamingTextLength", () => {
  it("reveals a newly arrived network chunk over multiple animation frames", () => {
    const next = nextStreamingTextLength(0, 240, 16);

    assert.ok(next > 0, "the first frame should make visible progress");
    assert.ok(next < 240, "one irregular SSE chunk must not paint atomically");
  });

  it("catches up faster when more text is waiting", () => {
    const shortBacklog = nextStreamingTextLength(0, 20, 16);
    const longBacklog = nextStreamingTextLength(0, 400, 16);

    assert.ok(longBacklog > shortBacklog);
  });

  it("never advances beyond the available text", () => {
    assert.equal(nextStreamingTextLength(18, 20, 1000), 20);
  });

  it("resets safely when a reparsed stream becomes shorter", () => {
    assert.equal(nextStreamingTextLength(40, 12, 16), 12);
  });

  it("shows existing running-thread history immediately instead of replaying it from zero", () => {
    const history = "x".repeat(12_000);
    const visible = initialStreamingText(history, true, false);

    assert.ok(visible.length >= history.length - 120);
    assert.ok(visible.length < history.length);
  });

  it("still smooths a genuinely new first chunk", () => {
    assert.equal(initialStreamingText("new response", true, false), "");
  });

  it("bypasses animation for completed streams and reduced motion", () => {
    assert.equal(initialStreamingText("complete", false, false), "complete");
    assert.equal(initialStreamingText("accessible", true, true), "accessible");
    assert.equal(reconcileStreamingText("part", "partial", true, true), "partial");
  });

  it("settles immediately when the parser revises the unfinished prefix", () => {
    assert.equal(reconcileStreamingText("old tail", "corrected tail", true, false), "corrected tail");
  });

  it("reveals complete grapheme clusters", () => {
    assert.equal(advanceStreamingText("", "e\u0301x", 16), "e\u0301");
    assert.equal(advanceStreamingText("", "👨‍👩‍👧‍👦!", 16), "👨‍👩‍👧‍👦");
    assert.equal(advanceStreamingText("", "🇨🇳!", 16), "🇨🇳");
  });

  it("preserves progress while the target grows continuously", () => {
    let visible = initialStreamingText("a", true, false);
    visible = advanceStreamingText(visible, "a", 16);
    visible = reconcileStreamingText(visible, "ab", true, false);
    visible = advanceStreamingText(visible, "ab", 16);

    assert.equal(visible, "ab");
  });
});
