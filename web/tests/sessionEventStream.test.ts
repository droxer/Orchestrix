import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lastSessionEventId, sessionEventsUrl } from "../src/lib/sessionEventStream.js";
import type { RelaySession } from "../src/types.js";

function session(partial: Partial<RelaySession>): RelaySession {
  return {
    id: "ses_1",
    workspacePath: "/workspace",
    taskGoal: "fix auth",
    participants: ["human"],
    status: "running",
    phase: "created",
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    agentRuns: [],
    artifacts: [],
    decisions: [],
    events: [],
    ...partial,
  } as RelaySession;
}

describe("session event stream helpers", () => {
  it("finds the last cached event id for the active session", () => {
    assert.equal(lastSessionEventId([
      session({
        id: "ses_1",
        events: [
          { id: "evt_1", type: "session.created", sessionId: "ses_1", timestamp: "2026-06-20T00:00:00.000Z", workspacePath: "/workspace", taskGoal: "fix auth", participants: ["human"] },
          { id: "evt_2", type: "session.status", sessionId: "ses_1", timestamp: "2026-06-20T00:00:01.000Z", status: "running", phase: "approved" },
        ],
      }),
    ], "ses_1"), "evt_2");
  });

  it("returns undefined without a cached session event cursor", () => {
    assert.equal(lastSessionEventId(undefined, "ses_1"), undefined);
    assert.equal(lastSessionEventId([session({ id: "other" })], "ses_1"), undefined);
    assert.equal(lastSessionEventId([session({ id: "ses_1" })], "ses_1"), undefined);
  });

  it("builds an encoded session stream URL with an optional cursor", () => {
    assert.equal(sessionEventsUrl("ses 1"), "/sessions/ses%201/events");
    assert.equal(sessionEventsUrl("ses 1", "evt/2"), "/sessions/ses%201/events?after=evt%2F2");
  });
});
