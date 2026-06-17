import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chooseSendAction } from "../src/lib/sendAction.js";

describe("chooseSendAction", () => {
  it("appends when active session exists and is open", () => {
    const action = chooseSendAction({
      activeSessionId: "s1",
      session: { id: "s1", archived: false },
    });
    assert.deepEqual(action, { kind: "append", sessionId: "s1" });
  });

  it("creates when no active session", () => {
    const action = chooseSendAction({ activeSessionId: null, session: undefined });
    assert.deepEqual(action, { kind: "create" });
  });

  it("creates when active session is archived", () => {
    const action = chooseSendAction({
      activeSessionId: "s1",
      session: { id: "s1", archived: true },
    });
    assert.deepEqual(action, { kind: "create" });
  });

  it("creates when active session id no longer maps to a session", () => {
    const action = chooseSendAction({ activeSessionId: "s_gone", session: undefined });
    assert.deepEqual(action, { kind: "create" });
  });
});
