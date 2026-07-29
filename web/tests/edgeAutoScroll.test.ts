import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EDGE_ZONE_PX, MAX_SCROLL_STEP_PX, edgeScrollVelocity } from "../src/lib/edgeAutoScroll.js";

const bounds = { left: 200, right: 1400 };

describe("edgeScrollVelocity", () => {
  it("stays still while the pointer is away from both edges", () => {
    assert.equal(edgeScrollVelocity(bounds, 800), 0);
    assert.equal(edgeScrollVelocity(bounds, bounds.left + EDGE_ZONE_PX), 0);
    assert.equal(edgeScrollVelocity(bounds, bounds.right - EDGE_ZONE_PX), 0);
  });

  it("scrolls forward near the right edge and back near the left edge", () => {
    assert.ok(edgeScrollVelocity(bounds, bounds.right - 10) > 0);
    assert.ok(edgeScrollVelocity(bounds, bounds.left + 10) < 0);
  });

  it("ramps with depth so a card parked at the edge moves fastest", () => {
    const shallow = edgeScrollVelocity(bounds, bounds.right - EDGE_ZONE_PX + 8);
    const deep = edgeScrollVelocity(bounds, bounds.right - 4);
    assert.ok(deep > shallow, `expected ${deep} > ${shallow}`);
    assert.equal(edgeScrollVelocity(bounds, bounds.right), MAX_SCROLL_STEP_PX);
  });

  it("clamps speed once the pointer passes outside the container", () => {
    assert.equal(edgeScrollVelocity(bounds, bounds.right + 500), MAX_SCROLL_STEP_PX);
    assert.equal(edgeScrollVelocity(bounds, bounds.left - 500), -MAX_SCROLL_STEP_PX);
  });
});
