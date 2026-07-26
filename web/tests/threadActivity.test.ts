import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { threadActivity } from "../src/lib/threadActivity.js";
import type { SessionStatus } from "../src/types.js";

describe("threadActivity", () => {
  it("prioritizes a live run as the working pulse, whatever the status", () => {
    for (const status of ["running", "waiting_for_human", "completed", "failed", "cancelled"] as SessionStatus[]) {
      assert.deepEqual(threadActivity(status, "claude"), {
        kind: "working",
        labelKey: "thread.agent_working",
      });
    }
  });

  it("maps a waiting thread to the warn pip and the thread-scoped label", () => {
    assert.deepEqual(threadActivity("waiting_for_human", undefined), {
      kind: "warn",
      labelKey: "thread.statuses.waiting_for_human",
    });
  });

  it("maps failed / completed / cancelled to their status tones", () => {
    assert.deepEqual(threadActivity("failed", undefined), { kind: "bad", labelKey: "status.failed" });
    assert.deepEqual(threadActivity("completed", undefined), { kind: "good", labelKey: "status.completed" });
    assert.deepEqual(threadActivity("cancelled", undefined), { kind: "neutral", labelKey: "status.cancelled" });
  });

  // The live-run pulse used to be the only source of a "working" signal, so a
  // client that cannot see node activeRuns (no sandbox token) showed a running
  // thread with no status at all. The session status is the fallback.
  it("still reports working for a running thread when no live run is visible", () => {
    assert.deepEqual(threadActivity("running", undefined), {
      kind: "working",
      labelKey: "status.running",
    });
  });

  it("returns null for a status it does not recognize", () => {
    assert.equal(threadActivity("archived" as SessionStatus, undefined), null);
  });
});
