import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resizeComposerTextarea } from "../src/lib/composerResize.js";

describe("resizeComposerTextarea", () => {
  it("sets height from scrollHeight and caps overflow", () => {
    const el = {
      style: { height: "", overflowY: "" },
      scrollHeight: 120,
    } as unknown as HTMLTextAreaElement;

    const originalGetComputedStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({
      fontSize: "15px",
      lineHeight: "22.5px",
      paddingTop: "12px",
      paddingBottom: "4px",
    }) as CSSStyleDeclaration;

    try {
      resizeComposerTextarea(el);
      assert.equal(el.style.height, "120px");
      assert.equal(el.style.overflowY, "hidden");
    } finally {
      globalThis.getComputedStyle = originalGetComputedStyle;
    }
  });

  it("scrolls when content exceeds the row cap", () => {
    const el = {
      style: { height: "", overflowY: "" },
      scrollHeight: 320,
    } as unknown as HTMLTextAreaElement;

    const originalGetComputedStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({
      fontSize: "15px",
      lineHeight: "22.5px",
      paddingTop: "12px",
      paddingBottom: "4px",
    }) as CSSStyleDeclaration;

    try {
      resizeComposerTextarea(el);
      assert.equal(el.style.height, "151px");
      assert.equal(el.style.overflowY, "auto");
    } finally {
      globalThis.getComputedStyle = originalGetComputedStyle;
    }
  });
});
