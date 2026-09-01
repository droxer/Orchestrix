import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { taskResultLine } from "../src/lib/taskResult.js";
import type { RelaySession, RelayTaskListItem, TaskStatus } from "../src/types.js";

function task(status: TaskStatus = "done"): RelayTaskListItem {
  return { id: "task_1", title: "Migrate the auth store", status, priority: "normal" } as RelayTaskListItem;
}

function session(workspaceArtifactCount?: number): RelaySession {
  return { id: "ses_1", workspaceArtifactCount } as RelaySession;
}

describe("taskResultLine", () => {
  it("says nothing about a task that has never run", () => {
    // The board used to print "Linked" here whether or not anything happened;
    // a task with no session has no result to report.
    assert.equal(taskResultLine(task(), undefined), null);
  });

  it("reports the outcome and the last run's file count", () => {
    assert.deepEqual(taskResultLine(task("done"), session(3)), {
      status: "done",
      fileCount: 3,
      hasFiles: true,
    });
  });

  it("reports a run that produced nothing without a file count", () => {
    assert.deepEqual(taskResultLine(task("done"), session(0)), {
      status: "done",
      fileCount: 0,
      hasFiles: false,
    });
  });

  it("treats a session whose count has not loaded as no files, not as a gap", () => {
    // A session inflated from an older cache carries no count. Rendering
    // nothing is right; rendering "0 files" would assert something unknown.
    assert.deepEqual(taskResultLine(task("running"), session(undefined)), {
      status: "running",
      fileCount: 0,
      hasFiles: false,
    });
  });

  it("carries a blocked outcome so a failed run is legible on the board", () => {
    const line = taskResultLine(task("blocked"), session(1));
    assert.equal(line?.status, "blocked");
    assert.equal(line?.hasFiles, true);
  });
});
