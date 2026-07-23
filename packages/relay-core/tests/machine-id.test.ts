import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMachineId, machineIdPath, readMachineId } from "../src/machine-id.js";

function withTempHome(fn: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), "relay-machine-"));
  try {
    fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe("ensureMachineId", () => {
  it("prefers an explicit value without persisting", () => {
    withTempHome((home) => {
      const resolution = ensureMachineId("mch_explicit", home);
      assert.equal(resolution.machineId, "mch_explicit");
      assert.equal(resolution.source, "explicit");
      assert.equal(readMachineId(home), undefined);
    });
  });

  it("generates and persists an id on first resolve", () => {
    withTempHome((home) => {
      const resolution = ensureMachineId(undefined, home);
      assert.equal(resolution.source, "generated");
      assert.match(resolution.machineId, /^mch_/);
      assert.equal(readFileSync(machineIdPath(home), "utf8").trim(), resolution.machineId);
    });
  });

  it("returns the same id across relaunches from the same host", () => {
    withTempHome((home) => {
      const first = ensureMachineId(undefined, home);
      const second = ensureMachineId(undefined, home);
      assert.equal(second.source, "file");
      assert.equal(second.machineId, first.machineId);
    });
  });

  it("treats blank explicit values as unset", () => {
    withTempHome((home) => {
      const resolution = ensureMachineId("   ", home);
      assert.equal(resolution.source, "generated");
      assert.match(resolution.machineId, /^mch_/);
    });
  });
});
