import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chooseSendAction, sendThreadSessionId, suppressActiveSessionDuringPendingSend } from "../src/lib/sendAction.js";
import { pathForAppState, parseAppPath } from "../src/lib/appRoute.js";

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

  it("suppresses the prior active transcript while a new thread is pending", () => {
    assert.equal(suppressActiveSessionDuringPendingSend({ kind: "create" }), true);
    assert.equal(suppressActiveSessionDuringPendingSend({ kind: "append", sessionId: "s1" }), false);
  });
});

describe("sendThreadSessionId", () => {
  it("keeps a pending create on the staged-new path", () => {
    const sessionId = sendThreadSessionId({ kind: "create" });
    assert.equal(sessionId, null);
    const path = pathForAppState({
      route: "main",
      mobileView: "chat",
      sessionId,
      composingNew: sessionId === null,
    });
    assert.equal(path, "/threads/new");
    assert.equal(parseAppPath(path).composingNew, true);
  });

  it("keeps a continued send on its own thread path", () => {
    const sessionId = sendThreadSessionId({ kind: "append", sessionId: "s1" });
    assert.equal(sessionId, "s1");
    const path = pathForAppState({
      route: "main",
      mobileView: "chat",
      sessionId,
      composingNew: sessionId === null,
    });
    assert.equal(path, "/threads/s1");
    assert.equal(parseAppPath(path).sessionId, "s1");
  });

  it("never lands a send on the bare threads route, which resets composing state", () => {
    for (const action of [{ kind: "create" as const }, { kind: "append" as const, sessionId: "s1" }]) {
      const sessionId = sendThreadSessionId(action);
      const path = pathForAppState({
        route: "main",
        mobileView: "chat",
        sessionId,
        composingNew: sessionId === null,
      });
      assert.notEqual(path, "/threads");
      const parsed = parseAppPath(path);
      assert.equal(Boolean(parsed.composingNew) || Boolean(parsed.sessionId), true);
    }
  });
});
