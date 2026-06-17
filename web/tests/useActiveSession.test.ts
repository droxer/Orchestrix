import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickInitialActiveSessionId } from "../src/hooks/useActiveSession.js";

describe("pickInitialActiveSessionId", () => {
  it("returns stored id when session exists and is not archived", () => {
    const sessions = [
      { id: "s1", archived: false, createdAt: "2026-06-01" },
      { id: "s2", archived: false, createdAt: "2026-06-10" },
    ];
    assert.equal(pickInitialActiveSessionId("s2", sessions), "s2");
  });

  it("falls back to newest non-archived session when stored id is missing", () => {
    const sessions = [
      { id: "s1", archived: false, createdAt: "2026-06-01" },
      { id: "s2", archived: false, createdAt: "2026-06-10" },
    ];
    assert.equal(pickInitialActiveSessionId(null, sessions), "s2");
  });

  it("skips archived sessions on fallback", () => {
    const sessions = [
      { id: "s1", archived: false, createdAt: "2026-06-01" },
      { id: "s2", archived: true, createdAt: "2026-06-10" },
    ];
    assert.equal(pickInitialActiveSessionId(null, sessions), "s1");
  });

  it("returns null when no eligible session", () => {
    assert.equal(pickInitialActiveSessionId(null, []), null);
  });

  it("returns null when stored id points to archived session and no other eligible", () => {
    const sessions = [{ id: "s2", archived: true, createdAt: "2026-06-10" }];
    assert.equal(pickInitialActiveSessionId("s2", sessions), null);
  });

  it("falls back to newest non-archived when stored id is missing from list", () => {
    const sessions = [{ id: "s1", archived: false, createdAt: "2026-06-01" }];
    assert.equal(pickInitialActiveSessionId("ghost", sessions), "s1");
  });
});
