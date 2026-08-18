import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RelayApiError } from "../src/api.js";
import { isWorkspaceRetryableError, workspaceHomeStatus } from "../src/lib/workspaceHome.js";

describe("workspaceHomeStatus", () => {
  it("shows the live chip with the serving node when the listing is live", () => {
    assert.deepEqual(workspaceHomeStatus({ source: "live", nodeId: "sbx_alice" }), {
      kind: "live",
      nodeId: "sbx_alice",
    });
  });

  it("shows nothing while the listing has not loaded", () => {
    assert.deepEqual(workspaceHomeStatus(undefined), { kind: "none" });
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
