import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBodyScrollLock } from "../src/lib/bodyScrollLock.js";

describe("bodyScrollLock", () => {
  it("restores the original overflow only after the final lock is released", () => {
    const target = { style: { overflow: "auto" } };
    const acquire = createBodyScrollLock(() => target);

    const releaseDrawer = acquire();
    const releaseDialog = acquire();
    assert.equal(target.style.overflow, "hidden");

    releaseDrawer();
    assert.equal(target.style.overflow, "hidden");

    releaseDialog();
    assert.equal(target.style.overflow, "auto");
  });

  it("makes each release idempotent", () => {
    const target = { style: { overflow: "clip" } };
    const acquire = createBodyScrollLock(() => target);
    const release = acquire();

    release();
    release();

    assert.equal(target.style.overflow, "clip");
  });
});
