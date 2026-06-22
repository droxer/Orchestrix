import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { summarizeArtifact } from "../src/lib/artifactStats.js";

describe("summarizeArtifact", () => {
  it("returns null for empty bodies", () => {
    assert.equal(summarizeArtifact("diff", "   \n"), null);
  });

  it("returns null for kinds without a semantic stat", () => {
    assert.equal(summarizeArtifact("summary", "anything"), null);
    assert.equal(summarizeArtifact("agent_output", "anything"), null);
  });

  it("counts diff additions, deletions, and files", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,3 @@",
      " context",
      "-removed",
      "+added one",
      "+added two",
      "diff --git a/src/b.ts b/src/b.ts",
      "+++ b/src/b.ts",
      "+only add",
    ].join("\n");
    const stat = summarizeArtifact("diff", diff);
    assert.deepEqual(stat, {
      key: "diff",
      vars: { additions: 3, deletions: 1, files: 2 },
      tone: "neutral",
    });
  });

  it("reads an approved review verdict", () => {
    const stat = summarizeArtifact("review", "Looks good.\nRELAY_REVIEW_VERDICT: APPROVED");
    assert.equal(stat?.key, "review_approved");
    assert.equal(stat?.tone, "up");
  });

  it("reads a rejected review verdict", () => {
    const stat = summarizeArtifact("review", "RELAY_REVIEW_VERDICT: REJECTED.");
    assert.equal(stat?.key, "review_rejected");
    assert.equal(stat?.tone, "down");
  });

  it("falls back to pending when no verdict marker is present", () => {
    const stat = summarizeArtifact("review", "Some prose without a marker");
    assert.equal(stat?.key, "review_pending");
    assert.equal(stat?.tone, "neutral");
  });

  it("tallies passing and failing tests", () => {
    const stat = summarizeArtifact("test_output", "12 passed, 1 failed in 3.2s");
    assert.deepEqual(stat, { key: "test", vars: { passed: 12, failed: 1 }, tone: "down" });
  });

  it("marks all-passing test runs as up", () => {
    const stat = summarizeArtifact("test_output", "All good: 8 passing");
    assert.equal(stat?.tone, "up");
  });

  it("reads command exit codes", () => {
    assert.equal(summarizeArtifact("command_log", "process exited with code 0")?.tone, "up");
    assert.equal(summarizeArtifact("command_log", "exit code 1")?.tone, "down");
    assert.equal(summarizeArtifact("command_log", "no code here")?.key, "command_unknown");
  });
});
