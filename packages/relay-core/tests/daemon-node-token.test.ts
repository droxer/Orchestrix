import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  daemonNodeTokenPath,
  ensureDaemonNodeToken,
  writeDaemonNodeToken,
} from "../src/daemon-node-token.js";

test("an explicit daemon token replaces a stale persisted token", (t) => {
  const workspacePath = mkdtempSync(join(tmpdir(), "relay-daemon-token-"));
  t.after(() => rmSync(workspacePath, { recursive: true, force: true }));

  writeDaemonNodeToken(workspacePath, "employee-1", "stale-token");

  const resolution = ensureDaemonNodeToken({
    workspacePath,
    employeeId: "employee-1",
    token: "current-token",
  });

  assert.equal(resolution.source, "explicit");
  assert.equal(
    readFileSync(daemonNodeTokenPath(workspacePath, "employee-1"), "utf8").trim(),
    "current-token",
  );
});
