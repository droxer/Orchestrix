import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { apiOrigin, backendPublicOrigin, relayApiEndpoint, relayBackendPath } from "../src/lib/apiOrigin.js";

const ORIGIN_KEYS = ["NEXT_PUBLIC_RELAY_API_ORIGIN", "NEXT_PUBLIC_RELAY_BACKEND_ORIGIN"] as const;

function clearOriginEnv(): void {
  for (const key of ORIGIN_KEYS) delete process.env[key];
}

afterEach(clearOriginEnv);

describe("web api origin", () => {
  it("stays same-origin when no api origin is configured", () => {
    clearOriginEnv();
    assert.equal(apiOrigin(), "");
    assert.equal(relayApiEndpoint("/threads"), "/api/v1/threads");
    assert.equal(relayBackendPath("/profile-images/agents/a1"), "/profile-images/agents/a1");
  });

  it("prefixes an absolute backend origin when configured", () => {
    process.env.NEXT_PUBLIC_RELAY_API_ORIGIN = "https://api.example.com/";
    assert.equal(apiOrigin(), "https://api.example.com");
    assert.equal(relayApiEndpoint("/threads"), "https://api.example.com/api/v1/threads");
    assert.equal(
      relayBackendPath("/profile-images/agents/a1"),
      "https://api.example.com/profile-images/agents/a1",
    );
  });

  it("does not double the api prefix on already-versioned paths", () => {
    process.env.NEXT_PUBLIC_RELAY_API_ORIGIN = "https://api.example.com";
    assert.equal(relayApiEndpoint("/api/v1/threads"), "https://api.example.com/api/v1/threads");
  });

  it("resolves copy-out values to the backend, not the page origin", () => {
    // Proxied mode: the browser talks to the web host, but a daemon start
    // command and a chat webhook URL must still name the backend.
    process.env.NEXT_PUBLIC_RELAY_BACKEND_ORIGIN = "https://api.example.com/";
    assert.equal(backendPublicOrigin(), "https://api.example.com");

    // Direct mode reuses the API origin rather than needing a second setting.
    clearOriginEnv();
    process.env.NEXT_PUBLIC_RELAY_API_ORIGIN = "https://api.example.com";
    assert.equal(backendPublicOrigin(), "https://api.example.com");
  });

  it("falls back to the local backend when nothing is configured off-browser", () => {
    clearOriginEnv();
    assert.equal(backendPublicOrigin(), "http://127.0.0.1:8790");
    assert.equal(backendPublicOrigin(""), "");
  });
});
