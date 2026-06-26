import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeSessionEventIntoSessions } from "../src/lib/sessionEventMerge.js";
import { applySessionEvent } from "../src/lib/sessionEvents.js";
import type { RelaySession } from "../src/types.js";

function session(partial: Partial<RelaySession> = {}): RelaySession {
  return {
    id: "ses_1",
    workspacePath: "/workspace",
    taskGoal: "fix auth",
    participants: ["human", "codex"],
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

describe("mergeSessionEventIntoSessions", () => {
  it("does not consume streamed events before the sessions cache exists", () => {
    const result = mergeSessionEventIntoSessions(undefined, "ses_1", {
      id: "evt_wait",
      type: "session.status",
      sessionId: "ses_1",
      timestamp: "2026-06-20T00:00:01.000Z",
      status: "waiting_for_human",
      phase: "feedback",
      pendingDecision: "feedback",
    }, applySessionEvent);

    assert.equal(result.sessions, undefined);
    assert.equal(result.consumed, false);
  });

  it("does not consume streamed events when the target session is absent", () => {
    const existing = [session({ id: "ses_other" })];
    const result = mergeSessionEventIntoSessions(existing, "ses_1", {
      id: "evt_wait",
      type: "session.status",
      sessionId: "ses_1",
      timestamp: "2026-06-20T00:00:01.000Z",
      status: "waiting_for_human",
      phase: "feedback",
      pendingDecision: "feedback",
    }, applySessionEvent);

    assert.equal(result.sessions, existing);
    assert.equal(result.consumed, false);
  });

  it("consumes duplicate streamed events without replacing the sessions array", () => {
    const event = {
      id: "evt_wait",
      type: "session.status" as const,
      sessionId: "ses_1",
      timestamp: "2026-06-20T00:00:01.000Z",
      status: "waiting_for_human" as const,
      phase: "feedback",
      pendingDecision: "feedback" as const,
    };
    const existing = [session({ events: [event] })];
    const result = mergeSessionEventIntoSessions(existing, "ses_1", event, applySessionEvent);

    assert.equal(result.sessions, existing);
    assert.equal(result.consumed, true);
  });

  it("merges streamed events into the matching cached session", () => {
    const existing = [session()];
    const result = mergeSessionEventIntoSessions(existing, "ses_1", {
      id: "evt_wait",
      type: "session.status",
      sessionId: "ses_1",
      timestamp: "2026-06-20T00:00:01.000Z",
      status: "waiting_for_human",
      phase: "feedback",
      pendingDecision: "feedback",
    }, applySessionEvent);

    assert.notEqual(result.sessions, existing);
    assert.equal(result.consumed, true);
    assert.equal(result.sessions?.[0].status, "waiting_for_human");
    assert.equal(result.sessions?.[0].pendingDecision, "feedback");
  });
});
