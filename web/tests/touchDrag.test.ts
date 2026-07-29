import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SCROLL_SLOP_PX, laneStatusAtPoint, movedBeyondSlop } from "../src/lib/touchDrag.js";

describe("movedBeyondSlop", () => {
  const origin = { x: 100, y: 200 };

  it("treats a resting finger as a hold, not a scroll", () => {
    assert.equal(movedBeyondSlop(origin, { x: 100, y: 200 }), false);
    assert.equal(movedBeyondSlop(origin, { x: 100 + SCROLL_SLOP_PX, y: 200 }), false);
  });

  it("treats travel on either axis as a scroll", () => {
    assert.equal(movedBeyondSlop(origin, { x: 100 + SCROLL_SLOP_PX + 1, y: 200 }), true);
    assert.equal(movedBeyondSlop(origin, { x: 100, y: 200 - SCROLL_SLOP_PX - 1 }), true);
  });
});

describe("laneStatusAtPoint", () => {
  function documentWith(element: unknown): Document {
    return { elementFromPoint: () => element } as unknown as Document;
  }

  const lane = (status: string) => ({
    closest: (selector: string) => (selector === ".backlog-lane" ? { dataset: { status } } : null),
  });

  it("reads the status off the lane under the finger", () => {
    assert.equal(laneStatusAtPoint(documentWith(lane("review")), { x: 10, y: 10 }), "review");
  });

  it("returns null off-lane, on an empty hit test, and with no document", () => {
    assert.equal(laneStatusAtPoint(documentWith({ closest: () => null }), { x: 0, y: 0 }), null);
    assert.equal(laneStatusAtPoint(documentWith(null), { x: 0, y: 0 }), null);
    assert.equal(laneStatusAtPoint(null, { x: 0, y: 0 }), null);
  });
});
