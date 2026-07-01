import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { conversationActivity } from "../src/lib/conversationActivity.js";
import type { SessionStatus } from "../src/types.js";

describe("conversationActivity", () => {
  it("prioritizes a live run as the working pulse, whatever the status", () => {
    for (const status of ["running", "waiting_for_human", "completed", "failed", "cancelled"] as SessionStatus[]) {
      assert.deepEqual(conversationActivity(status, "claude"), {
        kind: "working",
        labelKey: "conversation.agent_working",
      });
    }
  });

  it("maps a waiting thread to the warn pip and the thread-scoped label", () => {
    assert.deepEqual(conversationActivity("waiting_for_human", undefined), {
      kind: "warn",
      labelKey: "thread.statuses.waiting_for_human",
    });
  });

  it("maps failed / completed / cancelled to their status tones", () => {
    assert.deepEqual(conversationActivity("failed", undefined), { kind: "bad", labelKey: "status.failed" });
    assert.deepEqual(conversationActivity("completed", undefined), { kind: "good", labelKey: "status.completed" });
    assert.deepEqual(conversationActivity("cancelled", undefined), { kind: "neutral", labelKey: "status.cancelled" });
  });

  it("returns null for a plain running thread with no agent, so the row stays single-line", () => {
    assert.equal(conversationActivity("running", undefined), null);
  });
});
