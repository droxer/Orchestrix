import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { apiJson, RelayApiError } from "../src/api.js";

const originalFetch = globalThis.fetch;

describe("apiJson", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("surfaces JSON detail errors as RelayApiError", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ detail: "Invalid token." }), {
      status: 401,
      statusText: "Unauthorized",
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

    await assert.rejects(
      () => apiJson("/sandboxes"),
      (error) => error instanceof RelayApiError
        && error.status === 401
        && error.message === "Invalid token.",
    );
  });

  it("surfaces plain-text errors as RelayApiError instead of JSON parse failures", async () => {
    globalThis.fetch = (async () => new Response("upstream gateway failed", {
      status: 502,
      statusText: "Bad Gateway",
      headers: { "Content-Type": "text/plain" },
    })) as typeof fetch;

    await assert.rejects(
      () => apiJson("/sessions"),
      (error) => error instanceof RelayApiError
        && error.status === 502
        && error.message === "upstream gateway failed",
    );
  });
});
