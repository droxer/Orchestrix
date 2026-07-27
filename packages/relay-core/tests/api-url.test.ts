import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RELAY_API_PREFIX, RELAY_API_VERSION, relayApiPath, relayApiUrl } from "../src/api-url.js";

describe("Relay API URLs", () => {
  it("publishes one canonical version prefix", () => {
    assert.equal(RELAY_API_VERSION, "v1");
    assert.equal(RELAY_API_PREFIX, "/api/v1");
  });

  it("prefixes resource paths exactly once", () => {
    assert.equal(relayApiPath("threads"), "/api/v1/threads");
    assert.equal(relayApiPath("/threads/ses_1"), "/api/v1/threads/ses_1");
    assert.equal(relayApiPath("/api/v1/threads"), "/api/v1/threads");
    assert.equal(relayApiPath("/"), "/api/v1");
  });

  it("joins resource paths to normalized backend origins", () => {
    assert.equal(relayApiUrl("http://relay.local/", "/tasks"), "http://relay.local/api/v1/tasks");
    assert.equal(relayApiUrl("http://relay.local", "admin/users"), "http://relay.local/api/v1/admin/users");
  });
});
