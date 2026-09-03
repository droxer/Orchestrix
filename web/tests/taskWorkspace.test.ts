import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { taskWorkspaceState } from "../src/components/task-board/taskWorkspaceState.js";

describe("task workspace section state", () => {
  it("reports loading before the first response", () => {
    assert.equal(taskWorkspaceState({ isLoading: true, error: null, data: undefined }), "loading");
  });

  it("reports unavailable when the computer is offline", () => {
    const error = { status: 503, body: { reason: "placement-unavailable" } };
    assert.equal(taskWorkspaceState({ isLoading: false, error, data: undefined }), "unavailable");
  });

  it("reports empty when the workspace exists but holds nothing", () => {
    const data = { exists: true, entries: [] };
    assert.equal(taskWorkspaceState({ isLoading: false, error: null, data }), "empty");
  });

  it("keeps the browser ready inside an empty directory so the user can navigate up", () => {
    const data = { exists: true, entries: [] };
    const nestedQuery = { isLoading: false, error: null, data, path: "reports" };
    assert.equal(taskWorkspaceState(nestedQuery), "ready");
  });

  it("reports ready when there are entries", () => {
    const data = { exists: true, entries: [{ name: "report.md", path: "report.md", kind: "file", bytes: 12, updatedAt: "" }] };
    assert.equal(taskWorkspaceState({ isLoading: false, error: null, data }), "ready");
  });

  it("reports failed for any other error", () => {
    assert.equal(taskWorkspaceState({ isLoading: false, error: { status: 500 }, data: undefined }), "failed");
  });
});
