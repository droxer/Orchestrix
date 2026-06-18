import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatCompactTokens, mergeTokenUsage, sessionTokenUsage } from "../src/lib/tokenUsage.js";
import type { RelaySession } from "../src/types.js";

describe("web token usage helpers", () => {
  it("merges reported token usage without estimating missing sessions", () => {
    const sessions = [
      { tokenUsage: { input: 10, output: 4, cache: 1, total: 15 } },
      {},
      { tokenUsage: { input: 2, output: 3, cache: 0, total: 5 } },
    ] as RelaySession[];

    assert.deepEqual(sessionTokenUsage(sessions), { input: 12, output: 7, cache: 1, total: 20 });
    assert.equal(mergeTokenUsage([undefined]), undefined);
  });

  it("formats compact token counts for conversation rows", () => {
    assert.equal(formatCompactTokens(999), "999");
    assert.equal(formatCompactTokens(1_250), "1.3k");
    assert.equal(formatCompactTokens(1_250_000), "1.3M");
  });
});
