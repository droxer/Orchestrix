import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TFunction } from "i18next";

import { phaseDividerLabel, projectMessages } from "../src/lib/projectMessages.js";
import type { RelaySession } from "../src/types.js";

const timestamp = "2026-06-19T12:00:00.000Z";

const t = ((key: string, options?: Record<string, unknown>) => {
  if (key === "message.artifact") return `Artifact - ${String(options?.kind)}`;
  if (key.startsWith("artifact.kind.")) return String(options?.defaultValue ?? key.split(".").at(-1));
  if (key === "transcript.phase_agent") return `${String(options?.agent)} · ${String(options?.mode)}`;
  if (key === "transcript.phase_handoff") return `Handoff · ${String(options?.agent)} · ${String(options?.mode)}`;
  if (key.startsWith("mode.")) return String(key.split(".").at(-1));
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
        mode: "action",
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
        id: "ev_deck",
        type: "artifact.created",
        sessionId: "ses_1",
        timestamp,
        artifact: {
          id: "art_deck",
          kind: "workspace_file",
          title: "Quarterly review.pptx",
          path: "/workspace/Quarterly review.pptx",
          createdAt: timestamp,
          agentRunId: "run_b",
          bytes: 4096,
          contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          workspaceRelativePath: "Quarterly review.pptx",
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
      ["art_review", "art_deck"],
    ]);
    // The agent-turn eyebrow renders `<agent> · <mode>`; the mode is carried
    // from agent.started so action and review turns read distinctly.
    assert.deepEqual(agentMessages.map((message) => message.mode), ["action", "review"]);
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
    // The row carries the artifact so the transcript can render its card.
    assert.equal(system.kind === "system" ? system.artifact?.id : undefined, "art_summary");
  });

  it("carries runless plan artifacts so the plan card can render", () => {
    // Assignment plans are created before any agent run exists (no
    // agentRunId); they must still reach the UI as artifacts, not just as a
    // label line, so PlanCard renders the step summary.
    const messages = projectMessages(session([
      {
        id: "ev_plan_runless",
        type: "artifact.created",
        sessionId: "ses_1",
        timestamp,
        artifact: {
          id: "art_plan_runless",
          kind: "plan",
          title: "Assignment plan",
          path: "/tmp/art_plan.json",
          createdAt: timestamp,
          bytes: 128,
        },
      },
    ]), t);

    const system = messages.find((message) => message.kind === "system");
    assert.ok(system && system.kind === "system");
    assert.equal(system.artifact?.kind, "plan");
    assert.equal(system.artifact?.id, "art_plan_runless");
  });

  it("renders a follow-up user.message as a user turn after the goal", () => {
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
        id: "ev_followup",
        type: "user.message",
        sessionId: "ses_1",
        timestamp,
        text: "Now add a dark mode toggle",
      },
    ]), t);

    const userMessages = messages.filter((message) => message.kind === "user");
    assert.equal(userMessages.length, 2);
    assert.equal(userMessages[0].text, "Build artifact display");
    assert.equal(userMessages[1].id, "ev_followup");
    assert.equal(userMessages[1].text, "Now add a dark mode toggle");
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

  it("uses the completed agent log when streamed output missed the final answer", () => {
    const finalFrame = `${JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "Final answer from Codex." },
    })}\n${JSON.stringify({ type: "turn.completed" })}\n`;
    const messages = projectMessages(session([
      {
        id: "ev_run",
        type: "agent.started",
        sessionId: "ses_1",
        timestamp,
        runId: "run_1",
        agent: "codex",
        role: "implementer",
        mode: "action",
      },
      {
        id: "ev_output",
        type: "agent.output",
        sessionId: "ses_1",
        timestamp,
        runId: "run_1",
        agent: "codex",
        stream: "stdout",
        text: `${JSON.stringify({
          type: "item.started",
          item: { type: "command_execution", command: "npm test" },
        })}\n`,
      },
      {
        id: "ev_completed",
        type: "agent.completed",
        sessionId: "ses_1",
        timestamp,
        runId: "run_1",
        agent: "codex",
        status: "completed",
        exitCode: 0,
        agentLog: `[Codex Action Exit 0]\nstderr:\nReading additional input from stdin...\n\nstdout:\n${finalFrame}`,
      },
    ]), t);

    const agent = messages.find((message) => message.kind === "agent");
    assert.ok(agent && agent.kind === "agent");
    assert.equal(agent.streaming, false);
    assert.match(agent.stdout, /npm test/);
    assert.match(agent.stdout, /Final answer from Codex/);
    assert.match(agent.stderr, /Reading additional input/);
  });

  it("does not duplicate completed log output that was already streamed", () => {
    const finalFrame = `${JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "Already streamed." },
    })}\n`;
    const messages = projectMessages(session([
      {
        id: "ev_run",
        type: "agent.started",
        sessionId: "ses_1",
        timestamp,
        runId: "run_1",
        agent: "codex",
        role: "implementer",
        mode: "action",
      },
      {
        id: "ev_output",
        type: "agent.output",
        sessionId: "ses_1",
        timestamp,
        runId: "run_1",
        agent: "codex",
        stream: "stdout",
        text: finalFrame,
      },
      {
        id: "ev_completed",
        type: "agent.completed",
        sessionId: "ses_1",
        timestamp,
        runId: "run_1",
        agent: "codex",
        status: "completed",
        exitCode: 0,
        agentLog: `[Codex Action Exit 0]\nstdout:\n${finalFrame}`,
      },
    ]), t);

    const agent = messages.find((message) => message.kind === "agent");
    assert.ok(agent && agent.kind === "agent");
    assert.equal(agent.stdout.match(/Already streamed/g)?.length, 1);
  });
});

describe("phaseDividerLabel", () => {
  it("labels the first agent chapter after a user turn", () => {
    const messages = projectMessages(session([
      {
        id: "ev_run",
        type: "agent.started",
        sessionId: "ses_1",
        timestamp,
        runId: "run_1",
        agent: "claude",
        role: "implementer",
        mode: "action",
      },
    ]), t);

    const agentIndex = messages.findIndex((message) => message.kind === "agent");
    assert.equal(phaseDividerLabel(messages, agentIndex, t), "claude · action");
  });

  it("labels agent handoffs across different agents", () => {
    const messages = projectMessages(session([
      {
        id: "ev_run_a",
        type: "agent.started",
        sessionId: "ses_1",
        timestamp,
        runId: "run_a",
        agent: "claude",
        role: "implementer",
        mode: "action",
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
    ]), t);

    const codexIndex = messages.findIndex(
      (message) => message.kind === "agent" && message.agent === "codex",
    );
    assert.equal(phaseDividerLabel(messages, codexIndex, t), "Handoff · codex · review");
  });
});
