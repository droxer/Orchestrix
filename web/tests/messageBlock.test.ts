import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TFunction } from "i18next";

import { projectMessages } from "../src/lib/projectMessages.js";
import type { RelaySession } from "../src/types.js";

const timestamp = "2026-06-19T12:00:00.000Z";

const t = ((key: string, options?: Record<string, unknown>) => {
  if (key === "message.artifact") return `Artifact - ${String(options?.kind)}`;
  if (key.startsWith("artifact.kind.")) return String(options?.defaultValue ?? key.split(".").at(-1));
  return key;
}) as unknown as TFunction;

function session(events: RelaySession["events"]): RelaySession {
  return {
    id: "ses_1",
    workspacePath: "/workspace",
    ownerEmployeeId: "alice",
    taskGoal: "Build artifact display",
    participants: ["human", "claude"],
    status: "running",
    phase: "running",
    createdAt: timestamp,
    updatedAt: timestamp,
    currentAgent: "codex",
    agentRuns: [],
    artifacts: [],
    decisions: [],
    events,
  };
}

describe("projectMessages artifact projection", () => {
  it("attaches visible artifacts to the matching agent run and hides command logs", () => {
    const messages = projectMessages(session([
      {
        id: "ev_created",
        type: "session.created",
        sessionId: "ses_1",
        timestamp,
        workspacePath: "/workspace",
        taskGoal: "Build artifact display",
        participants: ["human", "claude"],
      },
      {
        id: "ev_run_a",
        type: "agent.started",
        sessionId: "ses_1",
        timestamp,
        runId: "run_a",
        agent: "claude",
        role: "implementer",
        mode: "implement",
      },
      {
        id: "ev_plan",
        type: "artifact.created",
        sessionId: "ses_1",
        timestamp,
        artifact: {
          id: "art_plan",
          kind: "plan",
          title: "Assignment plan",
          path: "/tmp/art_plan.json",
          createdAt: timestamp,
          agentRunId: "run_a",
          bytes: 128,
        },
      },
      {
        id: "ev_run_b",
        type: "agent.started",
        sessionId: "ses_1",
        timestamp,
        runId: "run_b",
        agent: "codex",
        role: "reviewer",
        mode: "review",
      },
      {
        id: "ev_review",
        type: "artifact.created",
        sessionId: "ses_1",
        timestamp,
        artifact: {
          id: "art_review",
          kind: "review",
          title: "Codex review",
          path: "/tmp/art_review.txt",
          createdAt: timestamp,
          agentRunId: "run_b",
          bytes: 256,
        },
      },
      {
        id: "ev_command_log",
        type: "artifact.created",
        sessionId: "ses_1",
        timestamp,
        artifact: {
          id: "art_log",
          kind: "command_log",
          title: "Codex raw output",
          path: "/tmp/art_log.txt",
          createdAt: timestamp,
          agentRunId: "run_b",
          bytes: 512,
        },
      },
    ]), t);

    const agentMessages = messages.filter((message) => message.kind === "agent");
    assert.equal(agentMessages.length, 2);
    assert.deepEqual(agentMessages.map((message) => message.attachments.map((artifact) => artifact.id)), [
      ["art_plan"],
      ["art_review"],
    ]);
  });

  it("renders runless artifacts as standalone system rows", () => {
    const messages = projectMessages(session([
      {
        id: "ev_summary",
        type: "artifact.created",
        sessionId: "ses_1",
        timestamp,
        artifact: {
          id: "art_summary",
          kind: "summary",
          title: "Session summary",
          path: "/tmp/art_summary.md",
          createdAt: timestamp,
          bytes: 64,
        },
      },
    ]), t);

    const system = messages.find((message) => message.kind === "system");
    assert.ok(system);
    assert.equal(system.id, "ev_summary");
    assert.equal(system.detail, "Session summary");
  });

  it("does not fabricate an agent message for an unknown artifact run", () => {
    const messages = projectMessages(session([
      {
        id: "ev_unknown",
        type: "artifact.created",
        sessionId: "ses_1",
        timestamp,
        artifact: {
          id: "art_diff",
          kind: "diff",
          title: "Detached diff",
          path: "/tmp/art_diff.patch",
          createdAt: timestamp,
          agentRunId: "missing_run",
          bytes: 96,
        },
      },
    ]), t);

    assert.equal(messages.filter((message) => message.kind === "agent").length, 0);
    assert.equal(messages.filter((message) => message.kind === "system").length, 1);
  });
});
