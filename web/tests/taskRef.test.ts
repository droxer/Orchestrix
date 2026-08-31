import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { taskRef } from "../src/lib/taskRef.js";

describe("taskRef", () => {
  it("prints the discriminating tail of a relay id", () => {
    assert.equal(taskRef("task_mfoo12_ab12cd"), "AB12CD");
  });

  it("is stable for one id and different for two", () => {
    assert.equal(taskRef("task_mfoo12_ab12cd"), taskRef("task_mfoo12_ab12cd"));
    assert.notEqual(taskRef("task_mfoo12_ab12cd"), taskRef("task_mfoo12_zz99yy"));
  });

  it("falls back to the tail of an id with no segments", () => {
    // Legacy and seeded records do not all carry the prefix_ts_rand shape.
    assert.equal(taskRef("legacy-task-000042"), "000042");
    assert.equal(taskRef("abc"), "ABC");
  });
});
