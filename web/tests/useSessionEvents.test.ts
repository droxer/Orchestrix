import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mergeSessionEventIntoSessions,
  mergeSessionEventsIntoSessions,
  SessionEventIdIndex,
} from "../src/lib/sessionEventMerge.js";
import { applySessionEvent, applySessionEventsUnchecked } from "../src/lib/sessionEvents.js";
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

  it("merges an SSE batch with one sessions-array replacement", () => {
    const existing = [session()];
    const result = mergeSessionEventsIntoSessions(existing, "ses_1", [
      {
        id: "evt_started",
        type: "agent.started",
        sessionId: "ses_1",
        timestamp: "2026-06-20T00:00:01.000Z",
        runId: "run_1",
        agent: "pi",
        mode: "action",
      },
      {
        id: "evt_output_1",
        type: "agent.output",
        sessionId: "ses_1",
        timestamp: "2026-06-20T00:00:02.000Z",
        runId: "run_1",
        agent: "pi",
        stream: "stdout",
        text: "one",
        sequence: 0,
      },
      {
        id: "evt_output_2",
        type: "agent.output",
        sessionId: "ses_1",
        timestamp: "2026-06-20T00:00:03.000Z",
        runId: "run_1",
        agent: "pi",
        stream: "stdout",
        text: "two",
        sequence: 1,
      },
    ], applySessionEvent, applySessionEventsUnchecked);

    assert.notEqual(result.sessions, existing);
    assert.equal(result.consumed, 3);
    assert.deepEqual(result.sessions?.[0].events.map((event) => event.id), [
      "evt_started",
      "evt_output_1",
      "evt_output_2",
    ]);
  });

  it("deduplicates events within one streamed batch", () => {
    const event = {
      id: "evt_output",
      type: "agent.output" as const,
      sessionId: "ses_1",
      timestamp: "2026-06-20T00:00:02.000Z",
      runId: "run_1",
      agent: "pi" as const,
      stream: "stdout" as const,
      text: "one",
      sequence: 0,
    };

    const result = mergeSessionEventsIntoSessions(
      [session()],
      "ses_1",
      [event, event],
      applySessionEvent,
    );

    assert.equal(result.consumed, 1);
    assert.equal(result.sessions?.[0].events.length, 1);
  });

  it("indexes only the appended cache suffix after a poll race", () => {
    const first = {
      id: "evt_first",
      type: "session.created" as const,
      sessionId: "ses_1",
      timestamp: "2026-06-20T00:00:01.000Z",
      workspacePath: "/workspace",
      taskGoal: "Test task",
      participants: ["human"],
    };
    const polled = {
      id: "evt_polled",
      type: "session.status" as const,
      sessionId: "ses_1",
      timestamp: "2026-06-20T00:00:02.000Z",
      status: "running" as const,
      phase: "running",
    };
    const streamed = {
      id: "evt_streamed",
      type: "session.status" as const,
      sessionId: "ses_1",
      timestamp: "2026-06-20T00:00:03.000Z",
      status: "waiting_for_human" as const,
      phase: "feedback",
    };
    const index = new SessionEventIdIndex([first]);
    let fullMapScans = 0;
    const trackedEvents = new Proxy([first, polled], {
      get(target, property, receiver) {
        if (property === "map") fullMapScans += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    const result = mergeSessionEventsIntoSessions(
      [session({ events: trackedEvents })],
      "ses_1",
      [polled, streamed],
      applySessionEvent,
      applySessionEventsUnchecked,
      index,
    );

    assert.equal(result.consumed, 1);
    assert.deepEqual(result.sessions?.[0].events.map((event) => event.id), [
      "evt_first",
      "evt_polled",
      "evt_streamed",
    ]);
    assert.equal(fullMapScans, 0);
  });
});
