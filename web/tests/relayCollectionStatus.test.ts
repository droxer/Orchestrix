import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { queryCollectionStatus } from "../src/lib/projectPage.js";

/* The projects rail and the project detail pane both branch on this status. */
describe("queryCollectionStatus", () => {
  const settled = { isError: false, isPending: false, isFetchedAfterMount: true, fetchStatus: "idle" } as const;

  it("reports a failed fetch", () => {
    assert.equal(queryCollectionStatus({ ...settled, isError: true }), "error");
  });

  it("reports a first load that has not landed", () => {
    assert.equal(
      queryCollectionStatus({ isError: false, isPending: true, isFetchedAfterMount: false, fetchStatus: "fetching" }),
      "loading",
    );
  });

  /* A query holding cached rows can still be mid-flight on its first real
     fetch (a token swap refetches everything); that is a load, not a refresh. */
  it("reports loading for an in-flight first fetch over cached rows", () => {
    assert.equal(
      queryCollectionStatus({ isError: false, isPending: false, isFetchedAfterMount: false, fetchStatus: "fetching" }),
      "loading",
    );
  });

  it("reports ready once a fetch has settled", () => {
    assert.equal(queryCollectionStatus(settled), "ready");
  });

  /* A poll refetch of settled data keeps the rail's rows on screen. */
  it("does not call a background refetch loading", () => {
    assert.equal(queryCollectionStatus({ ...settled, fetchStatus: "fetching" }), "ready");
  });
});

describe("logged-out cache reset", () => {
  /* THE REGRESSION: clearing the cache with setQueryData(key, []) stamps
     dataUpdatedAt after mount, so React Query then reports isPending false AND
     isFetchedAfterMount true for a request still in flight. Both guards above
     are defeated, the status reads "ready" for an unfinished fetch, and every
     loading branch built on it becomes dead code — the projects rail answered
     "No projects yet · Create project" for a fetch that had not come back.
     resetQueries returns the query to a genuinely unfetched state instead. */
  it("clears the relay cache without seeding rows into it", async () => {
    const source = await readFile(resolve("web/src/hooks/useRelayData.ts"), "utf8");
    const reset = source.slice(source.indexOf("if (!enabled) {"), source.indexOf("}, [enabled, queryClient]);"));
    assert.doesNotMatch(reset, /setQueryData/);
    assert.match(reset, /resetQueries/);
  });
});
