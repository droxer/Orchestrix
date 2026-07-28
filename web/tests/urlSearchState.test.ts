import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { resolveUrlSearchValue } from "../src/lib/urlSearchState.js";

describe("URL search state history", () => {
  it("resolves functional updates exactly once", () => {
    let calls = 0;
    const next = resolveUrlSearchValue("activities", (current) => {
      calls += 1;
      return current === "activities" ? "artifacts" : "activities";
    });

    assert.equal(next, "artifacts");
    assert.equal(calls, 1);
  });

  it("keeps History API effects outside React state updaters and subscribes to back/forward", async () => {
    const source = await readFile(resolve("web/src/hooks/useUrlSearchState.ts"), "utf8");

    assert.doesNotMatch(source, /setValue\(\(current\)/);
    assert.match(source, /window\.addEventListener\("popstate", sync\)/);
    assert.match(source, /window\.history\[historyMode === "push"/);
    assert.match(source, /window\.dispatchEvent\(new Event\(APP_NAVIGATION_EVENT\)\)/);
  });
});
