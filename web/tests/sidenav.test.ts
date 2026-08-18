import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clampSidenavWidth,
  maxSidenavWidth,
  SIDENAV_WIDTH_DEFAULT,
  SIDENAV_WIDTH_MAX,
  SIDENAV_WIDTH_MIN,
} from "../src/lib/sidenav.js";
import { TRANSCRIPT_MIN_WIDTH } from "../src/lib/threadSpace.js";

describe("clampSidenavWidth", () => {
  it("keeps the dragged width inside the rail bounds", () => {
    assert.equal(clampSidenavWidth(SIDENAV_WIDTH_DEFAULT), SIDENAV_WIDTH_DEFAULT);
    assert.equal(clampSidenavWidth(10), SIDENAV_WIDTH_MIN);
    assert.equal(clampSidenavWidth(10_000), SIDENAV_WIDTH_MAX);
    assert.equal(clampSidenavWidth(Number.NaN), SIDENAV_WIDTH_DEFAULT);
  });

  it("honours a tighter ceiling from the available room", () => {
    assert.equal(clampSidenavWidth(300, 240), 240);
    assert.equal(clampSidenavWidth(200, 240), 200);
    // A ceiling below the minimum still yields a usable rail.
    assert.equal(clampSidenavWidth(300, 40), SIDENAV_WIDTH_MIN);
    assert.equal(clampSidenavWidth(10_000, 10_000), SIDENAV_WIDTH_MAX);
  });
});

describe("maxSidenavWidth", () => {
  it("lets the rail take only what the chat column can spare", () => {
    // 480px chat column, 420px floor → 60px of room on top of the current
    // width. Kept under SIDENAV_WIDTH_MAX so this exercises the room
    // calculation rather than the absolute cap.
    assert.equal(
      maxSidenavWidth(SIDENAV_WIDTH_DEFAULT, 480),
      SIDENAV_WIDTH_DEFAULT + (480 - TRANSCRIPT_MIN_WIDTH),
    );
  });

  it("caps at the absolute maximum however wide the chat column is", () => {
    assert.equal(maxSidenavWidth(SIDENAV_WIDTH_DEFAULT, 4000), SIDENAV_WIDTH_MAX);
  });

  it("shrinks the ceiling below the current width once the floor is crossed", () => {
    // This is what makes the transcript-floor guard give room back when the
    // rail is expanded on top of an already-tight chat column.
    assert.ok(maxSidenavWidth(300, TRANSCRIPT_MIN_WIDTH - 100) < 300);
  });

  it("falls back to the absolute maximum with nothing to measure", () => {
    assert.equal(maxSidenavWidth(SIDENAV_WIDTH_DEFAULT, null), SIDENAV_WIDTH_MAX);
    assert.equal(maxSidenavWidth(SIDENAV_WIDTH_DEFAULT, Number.NaN), SIDENAV_WIDTH_MAX);
  });

  it("never reports a ceiling below the rail minimum", () => {
    assert.equal(maxSidenavWidth(SIDENAV_WIDTH_MIN, 0), SIDENAV_WIDTH_MIN);
  });

  it("shares the transcript floor with the other panes", () => {
    // The rail, the thread list and the space panel all yield to the same
    // floor — three panes competing for one column with three different
    // floors would let two of them each think there was room.
    assert.equal(maxSidenavWidth(200, TRANSCRIPT_MIN_WIDTH), 200);
  });
});
