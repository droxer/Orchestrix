import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs } from "../src/cli.js";

test("relay-daemon CLI parses admin-created credential flags", () => {
  const args = parseArgs([
    "node",
    "relay-daemon",
    "--backend-url",
    "http://127.0.0.1:8790",
    "--sandbox-id",
    "sbx_alice_123",
    "--employee-id",
    "alice",
    "--token",
    "tok_node",
    "--sandbox",
    "none",
  ]);

  assert.deepEqual(args, {
    backendUrl: "http://127.0.0.1:8790",
    sandboxId: "sbx_alice_123",
    employeeId: "alice",
    token: "tok_node",
    sandbox: "none",
    help: false,
    version: false,
  });
});

test("relay-daemon CLI still allows env-only runtime options", () => {
  const args = parseArgs(["node", "relay-daemon"]);

  assert.deepEqual(args, {
    backendUrl: undefined,
    sandboxId: undefined,
    employeeId: undefined,
    token: undefined,
    sandbox: undefined,
    help: false,
    version: false,
  });
});
