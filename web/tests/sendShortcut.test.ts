import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sendShortcutLabel } from "../src/lib/sendShortcut.js";

describe("sendShortcutLabel", () => {
  it("returns a non-empty shortcut label", () => {
    const label = sendShortcutLabel();
    assert.match(label, /^(⌘ Enter|Ctrl\+Enter)$/);
  });
});
