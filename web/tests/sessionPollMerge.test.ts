import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mergeSessionSnapshotIntoSessions,
  mergeSessionSummaries,
} from "../src/lib/sessionPollMerge.js";
import type { RelaySession, SessionSummary } from "../src/types.js";

function session(partial: Partial<RelaySession> = {}): RelaySession {
  return {
    id: "ses_1",
    workspacePath: "/workspace",
    taskGoal: "stream smoothly",
    participants: ["human", "pi"],
    status: "running",
    phase: "pi:action",
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    agentRuns: [],
    artifacts: [],
    decisions: [],
    events: [],
    ...partial,
  } as RelaySession;
}

function summary(partial: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "ses_1",
    workspacePath: "/workspace",
    taskGoal: "stream smoothly",
    status: "running",
    phase: "pi:action",
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:02.000Z",
    eventCount: 2,
    runCount: 1,
    artifactCount: 0,
    ...partial,
  };
}

describe("session poll merging", () => {
  it("updates summary fields without replacing streamed event history", () => {
    const output = {
      id: "evt_output",
      type: "agent.output" as const,
      sessionId: "ses_1",
      timestamp: "2026-06-20T00:00:02.000Z",
      runId: "run_1",
      agent: "pi" as const,
      stream: "stdout" as const,
      text: "hello",
      sequence: 0,
    };
    const current = [session({ events: [output] })];

    const merged = mergeSessionSummaries(current, [summary({ title: "Renamed" })]);

    assert.equal(merged[0].title, "Renamed");
    assert.equal(merged[0].events, current[0].events);
  });

  it("inflates a newly discovered summary until its detail is fetched", () => {
    const merged = mergeSessionSummaries([], [summary()]);

    assert.equal(merged[0].id, "ses_1");
    assert.deepEqual(merged[0].events, []);
    assert.deepEqual(merged[0].agentRuns, []);
  });

  it("does not roll live state back when a summary response predates SSE", () => {
    const output = {
      id: "evt_output",
      type: "agent.output" as const,
      sessionId: "ses_1",
      timestamp: "2026-06-20T00:00:03.000Z",
      runId: "run_1",
      agent: "pi" as const,
      stream: "stdout" as const,
      text: "newer",
      sequence: 0,
    };
    const current = [session({ events: [output], phase: "pi:action" })];

    const merged = mergeSessionSummaries(current, [summary({
      eventCount: 0,
      phase: "created",
      updatedAt: "2026-06-20T00:00:01.000Z",
    })]);

    assert.equal(merged[0], current[0]);
    assert.equal(merged[0].phase, "pi:action");
  });

  it("keeps the workspace artifact count a summary reports", () => {
    // The board counts a task's produced files from this number; discarding it
    // left the backlog with no way to say what a run produced.
    const merged = mergeSessionSummaries([], [summary({ artifactCount: 3 })]);

    assert.equal(merged[0].workspaceArtifactCount, 3);
  });

  it("refreshes the artifact count on a session it already holds", () => {
    const current = [session({ workspaceArtifactCount: 1 })];

    const merged = mergeSessionSummaries(current, [summary({ artifactCount: 2, eventCount: 2 })]);

    assert.equal(merged[0].workspaceArtifactCount, 2);
  });

  it("does not roll the artifact count back when a summary predates SSE", () => {
    const output = {
      id: "evt_output",
      type: "agent.output" as const,
      sessionId: "ses_1",
      timestamp: "2026-06-20T00:00:03.000Z",
      runId: "run_1",
      agent: "pi" as const,
      stream: "stdout" as const,
      text: "newer",
      sequence: 0,
    };
    const current = [session({ events: [output], workspaceArtifactCount: 3 })];

    const merged = mergeSessionSummaries(current, [summary({ artifactCount: 0, eventCount: 0 })]);

    assert.equal(merged[0].workspaceArtifactCount, 3);
  });

  it("keeps SSE events that arrived after a detail request began", () => {
    const output = {
      id: "evt_output",
      type: "agent.output" as const,
      sessionId: "ses_1",
      timestamp: "2026-06-20T00:00:02.000Z",
      runId: "run_1",
      agent: "pi" as const,
      stream: "stdout" as const,
      text: "hello",
      sequence: 0,
    };
    const current = [session({ events: [output] })];
    const staleSnapshot = session({ updatedAt: "2026-06-20T00:00:01.000Z" });

    const merged = mergeSessionSnapshotIntoSessions(current, staleSnapshot);

    assert.deepEqual(merged[0].events.map((event) => event.id), ["evt_output"]);
  });
});
