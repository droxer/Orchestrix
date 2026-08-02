import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RELAY_POLL_INTERVALS_MS } from "../src/lib/relayPolling.js";

describe("relay polling budget", () => {
  it("keeps freshness-critical reads fast without hot-polling stable resources", () => {
    assert.equal(RELAY_POLL_INTERVALS_MS.nodes, 3_000);
    assert.equal(RELAY_POLL_INTERVALS_MS.sessions, 3_000);
    assert.equal(RELAY_POLL_INTERVALS_MS.tasks, 3_000);
    assert.ok(RELAY_POLL_INTERVALS_MS.sandboxes >= 15_000);
  });
});
