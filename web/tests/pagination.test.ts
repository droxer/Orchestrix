import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_PAGE_SIZE,
  paginate,
  pageNumbers,
  parsePageParam,
  serializePageParam,
} from "../src/lib/pagination.js";

const items = Array.from({ length: 23 }, (_, index) => index + 1);

describe("paginate", () => {
  it("returns the requested slice with a 1-based, human-readable range", () => {
    const page = paginate(items, 2, 10);
    assert.deepEqual(page.items, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    assert.deepEqual(
      { page: page.page, pageCount: page.pageCount, total: page.total, from: page.from, to: page.to },
      { page: 2, pageCount: 3, total: 23, from: 11, to: 20 },
    );
  });

  it("gives the last page only what is left", () => {
    const page = paginate(items, 3, 10);
    assert.deepEqual(page.items, [21, 22, 23]);
    assert.deepEqual({ from: page.from, to: page.to }, { from: 21, to: 23 });
  });

  it("clamps a page past the end instead of rendering an empty list", () => {
    // The reader is on page 3 and then narrows a filter to 4 results. Trusting
    // the stored page would show them nothing and read as "no results".
    const page = paginate(items.slice(0, 4), 3, 10);
    assert.equal(page.page, 1);
    assert.deepEqual(page.items, [1, 2, 3, 4]);
  });

  it("clamps a page below the start", () => {
    assert.equal(paginate(items, 0, 10).page, 1);
    assert.equal(paginate(items, -5, 10).page, 1);
  });

  it("reports a single empty page for an empty collection", () => {
    const page = paginate([], 1, 10);
    assert.deepEqual(
      { items: page.items, page: page.page, pageCount: page.pageCount, total: page.total, from: page.from, to: page.to },
      { items: [], page: 1, pageCount: 1, total: 0, from: 0, to: 0 },
    );
  });

  it("does not paginate a collection that fits on one page", () => {
    const page = paginate(items.slice(0, 10), 1, 10);
    assert.equal(page.pageCount, 1);
    assert.equal(page.needed, false);
    assert.equal(paginate(items, 1, 10).needed, true);
  });

  it("defaults to a shared page size so surfaces do not each invent one", () => {
    assert.equal(paginate(items, 1).items.length, Math.min(DEFAULT_PAGE_SIZE, items.length));
  });
});

describe("pageNumbers", () => {
  it("lists every page when they all fit", () => {
    assert.deepEqual(pageNumbers(2, 5), [1, 2, 3, 4, 5]);
  });

  it("elides the middle around the current page, always keeping the ends", () => {
    // First and last are the anchors a reader navigates by; "gap" is the
    // rendered ellipsis, not a page.
    assert.deepEqual(pageNumbers(1, 12), [1, 2, 3, "gap", 12]);
    assert.deepEqual(pageNumbers(6, 12), [1, "gap", 5, 6, 7, "gap", 12]);
    assert.deepEqual(pageNumbers(12, 12), [1, "gap", 10, 11, 12]);
  });

  it("never emits a gap standing in for a single page", () => {
    // A "…" between 3 and 5 is wider than the 4 it hides.
    for (let current = 1; current <= 9; current += 1) {
      const numbers = pageNumbers(current, 9);
      for (let i = 0; i < numbers.length - 1; i += 1) {
        if (numbers[i] !== "gap") continue;
        const before = numbers[i - 1] as number;
        const after = numbers[i + 1] as number;
        assert.ok(after - before > 2, `gap hid a single page between ${before} and ${after}`);
      }
    }
  });

  it("returns nothing to render for a single page", () => {
    assert.deepEqual(pageNumbers(1, 1), []);
    assert.deepEqual(pageNumbers(1, 0), []);
  });
});

describe("page url param", () => {
  it("omits the param on page 1 so a default view has a clean url", () => {
    assert.equal(serializePageParam(1), null);
    assert.equal(serializePageParam(4), "4");
  });

  it("reads a 1-based page and rejects anything that is not one", () => {
    assert.equal(parsePageParam("4"), 4);
    assert.equal(parsePageParam(null), 1);
    assert.equal(parsePageParam(""), 1);
    assert.equal(parsePageParam("0"), 1);
    assert.equal(parsePageParam("-2"), 1);
    assert.equal(parsePageParam("1.5"), 1);
    assert.equal(parsePageParam("nope"), 1);
    assert.equal(parsePageParam("1e9"), 1);
  });
});

/* ── Per-lane paging, for the board ─────────────────────────────────── */

import { LANE_PAGE_SIZE, parseLanePages, serializeLanePages } from "../src/lib/pagination.js";

const LANES = ["backlog", "running", "done"] as const;

describe("lane pages", () => {
  it("pages a lane more tightly than a full-width list", () => {
    // A lane is one narrow column, not the whole viewport.
    assert.ok(LANE_PAGE_SIZE < DEFAULT_PAGE_SIZE);
  });

  it("round-trips only the lanes that are off page 1", () => {
    // The board has seven lanes; naming all seven in the URL when six of them
    // are on page 1 makes the common case unreadable.
    assert.equal(serializeLanePages({ running: 2, done: 3 }, LANES), "running:2,done:3");
    assert.equal(serializeLanePages({ backlog: 1, running: 2 }, LANES), "running:2");
    assert.deepEqual(parseLanePages("running:2,done:3", LANES), { running: 2, done: 3 });
  });

  it("drops the param entirely when every lane is on page 1", () => {
    assert.equal(serializeLanePages({}, LANES), null);
    assert.equal(serializeLanePages({ backlog: 1, running: 1 }, LANES), null);
  });

  it("keeps lanes in board order, not in the order they were clicked", () => {
    // Otherwise the URL churns as the reader pages around the board.
    assert.equal(serializeLanePages({ done: 2, backlog: 4 }, LANES), "backlog:4,done:2");
  });

  it("ignores lanes the board does not have and pages that are not pages", () => {
    // A stale link naming a retired status must not wedge the board.
    assert.deepEqual(parseLanePages("nope:2,running:3", LANES), { running: 3 });
    assert.deepEqual(parseLanePages("running:0,done:-1,backlog:x", LANES), {});
    assert.deepEqual(parseLanePages("garbage", LANES), {});
    assert.deepEqual(parseLanePages(null, LANES), {});
    assert.deepEqual(parseLanePages("running:1", LANES), {});
  });

  it("survives its own output for every lane combination", () => {
    const pages = { backlog: 2, running: 7, done: 3 };
    assert.deepEqual(parseLanePages(serializeLanePages(pages, LANES), LANES), pages);
  });
});
