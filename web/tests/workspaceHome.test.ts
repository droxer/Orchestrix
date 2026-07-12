import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RelayApiError } from "../src/api.js";
import { isWorkspaceRetryableError, workspaceFilesEmptyState, workspaceHomeStatus } from "../src/lib/workspaceHome.js";

describe("workspaceHomeStatus", () => {
  it("shows the live chip with the serving node when the listing is live", () => {
    assert.deepEqual(workspaceHomeStatus({ source: "live", nodeId: "sbx_alice" }, false), {
      kind: "live",
      nodeId: "sbx_alice",
    });
    // The node id is optional diagnostic metadata — live still renders without it.
    assert.deepEqual(workspaceHomeStatus({ source: "live" }, false), { kind: "live", nodeId: null });
  });

  it("shows the snapshot banner first, collapsing to the chip once dismissed", () => {
    assert.deepEqual(workspaceHomeStatus({ source: "snapshot" }, false), { kind: "snapshot-banner" });
    assert.deepEqual(workspaceHomeStatus({ source: "snapshot" }, true), { kind: "snapshot-chip" });
  });

  it("shows nothing while the listing has not loaded", () => {
    assert.deepEqual(workspaceHomeStatus(undefined, false), { kind: "none" });
    assert.deepEqual(workspaceHomeStatus(undefined, true), { kind: "none" });
  });

  it("keeps the banner dismissal from leaking into the live state", () => {
    assert.deepEqual(workspaceHomeStatus({ source: "live", nodeId: "sbx_alice" }, true), {
      kind: "live",
      nodeId: "sbx_alice",
    });
  });
});

describe("workspaceFilesEmptyState", () => {
  it("uses the not-produced-yet copy with the artifact hint for snapshot homes", () => {
    assert.deepEqual(workspaceFilesEmptyState("snapshot"), {
      titleKey: "workspace.no_files_yet",
      hintKey: "workspace.empty_files_snapshot_hint",
    });
  });

  it("uses the plain empty copy without a hint for live and unloaded homes", () => {
    assert.deepEqual(workspaceFilesEmptyState("live"), { titleKey: "workspace.no_files", hintKey: null });
    assert.deepEqual(workspaceFilesEmptyState(undefined), { titleKey: "workspace.no_files", hintKey: null });
  });
});

describe("isWorkspaceRetryableError", () => {
  it("offers retry only for the placement-unavailable 503", () => {
    assert.equal(isWorkspaceRetryableError(new RelayApiError("placement-unavailable", 503)), true);
    assert.equal(isWorkspaceRetryableError(new RelayApiError("not found", 404)), false);
    assert.equal(isWorkspaceRetryableError(new Error("network down")), false);
    assert.equal(isWorkspaceRetryableError(undefined), false);
  });
});
