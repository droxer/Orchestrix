import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isDrawerTop,
  isDrawerUnderlay,
  registerDrawer,
  subscribeDrawerStack,
} from "../src/lib/drawerStack.js";

describe("drawerStack", () => {
  const a = Symbol("a");
  const b = Symbol("b");

  it("marks lower-layer drawers as underlay when stacked", () => {
    registerDrawer(a, 0, true);
    registerDrawer(b, 1, true);

    assert.equal(isDrawerUnderlay(a), true);
    assert.equal(isDrawerUnderlay(b), false);

    registerDrawer(b, 1, false);
    assert.equal(isDrawerUnderlay(a), false);

    registerDrawer(a, 0, false);
  });

  it("gives keyboard ownership to the top of the stack only", () => {
    registerDrawer(a, 0, true);
    assert.equal(isDrawerTop(a), true);

    registerDrawer(b, 1, true);
    assert.equal(isDrawerTop(a), false);
    assert.equal(isDrawerTop(b), true);

    registerDrawer(b, 1, false);
    assert.equal(isDrawerTop(a), true);

    registerDrawer(a, 0, false);
    assert.equal(isDrawerTop(a), true);
  });

  it("notifies subscribers when the stack changes", () => {
    let count = 0;
    const unsubscribe = subscribeDrawerStack(() => {
      count += 1;
    });

    registerDrawer(a, 0, true);
    assert.ok(count >= 1);

    registerDrawer(a, 0, false);
    unsubscribe();
  });
});
