import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const read = (path: string) => readFile(resolve(path), "utf8");

describe("My Computer route shell", () => {
  it("owns a scroll body, because the app shell clips its children", async () => {
    // Regression: the route shipped with no stylesheet. `.messenger-shell` is
    // `overflow: hidden`, so a roster taller than the viewport was clipped and
    // its last card could not be reached by any scroll gesture.
    const [page, styles] = await Promise.all([
      read("web/src/components/ComputerPage.tsx"),
      read("web/src/styles/computer.css"),
    ]);
    assert.match(page, /className="computer-page-body"/);
    assert.match(styles, /\.computer-page-body\s*\{[^}]*overflow-y:\s*auto;/s);
    assert.match(styles, /\.computer-page\s*\{[^}]*overflow:\s*hidden;/s);
    assert.match(styles, /\.computer-page\s*\{[^}]*min-height:\s*0;/s);
  });

  it("insets the roster to the page header's own gutter", async () => {
    // The cards sat flush against the sidenav hairline, outdented from the
    // title above them, because .adm-fleet-grid carries no padding and nothing
    // else supplied one. PageHeader's inline padding is `px-xl` (--sp-7).
    const styles = await read("web/src/styles/computer.css");
    assert.match(styles, /\.computer-page-body\s*\{[^}]*padding:[^;]*var\(--sp-7\)/s);
  });

  it("is registered in the shared mobile row map", async () => {
    // Every work route needs `grid-row: 2` under the mobile topbar; this one
    // was missing from the list.
    const responsive = await read("web/src/styles/responsive.css");
    const block = responsive.match(/([^}]*)\{\s*grid-row: 2;/)?.[1] ?? "";
    assert.match(block, /\.computer-page/);
  });

  it("has a dev rewrite so a direct load does not 404", async () => {
    const config = await read("web/next.config.ts");
    assert.match(config, /source: "\/computer"/);
  });

  it("keeps the connect action reachable on mobile", async () => {
    // Regression: the route hid its whole .page-header under 820px to kill an
    // empty grey strip, which took "Connect this computer" with it. The empty
    // state has its own button, so the loss only appeared once you owned a
    // computer — exactly when you were adding a second one.
    const styles = await read("web/src/styles/computer.css");
    const mobile = styles.slice(styles.indexOf("@media (max-width: 820px)"));
    assert.doesNotMatch(
      mobile,
      /\.computer-page \.page-header\s*\{[^}]*display:\s*none/s,
      "hiding the header removes the only Connect button on mobile",
    );
  });
});

describe("My Computer record card", () => {
  it("uses its own record card, not the admin fleet tile", async () => {
    // NodeCard is a survey tile meant to be scanned 40-at-a-time; reusing it
    // here reduced the reader's own machine to a name, a truncated id, and
    // four unlabelled vendor glyphs.
    const page = await read("web/src/components/ComputerPage.tsx");
    assert.match(page, /<ComputerCard/);
    assert.doesNotMatch(page, /<NodeCard/);
    assert.doesNotMatch(page, /adm-fleet-grid/);
  });

  it("names every runtime and states its version and health", async () => {
    const card = await read("web/src/components/computer/ComputerCard.tsx");
    assert.match(card, /computer-runtime-name/);
    assert.match(card, /computer-runtime-state/);
    assert.match(card, /computer-runtime-version/);
    assert.match(card, /labelForExecutor\(agent\)/);
  });

  it("labels its actions instead of relying on bare icons", async () => {
    const card = await read("web/src/components/computer/ComputerCard.tsx");
    assert.match(card, /\{t\("thread\.rename"\)\}/);
    assert.match(card, /\{t\("admin\.v2\.manage_executors"\)\}/);
  });

  it("offers the counterpart to self-service enrollment", async () => {
    // Connecting a computer is self-service, so removing one must be too —
    // otherwise a mistyped workspace leaves a row only an admin can clear.
    const [card, page] = await Promise.all([
      read("web/src/components/computer/ComputerCard.tsx"),
      read("web/src/components/ComputerPage.tsx"),
    ]);
    assert.match(card, /\{t\("computer\.disconnect"\)\}/);
    assert.match(page, /disconnectComputer\(node\.id\)/);
    assert.match(page, /tone: "danger"/, "removal is confirmed destructively");
  });

  it("keeps poll-derived liveness out of optimistic overrides", async () => {
    // `online`, `stale`, `activeRuns`, and `queuedCommandCount` are derived per
    // read and never bump `updatedAt`, so a wholesale override pinned a
    // renamed computer to the liveness it had when the rename landed.
    const page = await read("web/src/components/ComputerPage.tsx");
    const overlay = page.match(/if \(!override \|\| override\.updatedAt < node\.updatedAt\) return node;([\s\S]*?)\n {6}\},/)?.[1] ?? "";
    assert.notEqual(overlay.trim(), "", "the override regex stopped matching — refresh it");
    for (const derived of ["online", "stale", "activeRuns", "queuedCommandCount"]) {
      assert.doesNotMatch(
        overlay,
        new RegExp(`override\\.${derived}`),
        `${derived} comes from the poll, never from the override`,
      );
    }
  });

  it("spends the --live accent only on work that is running right now", async () => {
    // Phosphor's single chromatic role means "an agent is working". An idle
    // computer must carry none of it, so the idle branch may not reach for a
    // live mark or the elapsed counter.
    const [card, styles] = await Promise.all([
      read("web/src/components/computer/ComputerCard.tsx"),
      read("web/src/styles/computer.css"),
    ]);
    const liveRules = [...styles.matchAll(/([.\w-]+)\s*\{[^}]*var\(--live\)[^}]*\}/g)].map((m) => m[1]);
    assert.deepEqual(
      liveRules.sort(),
      [".computer-run-elapsed", ".computer-run-mark"],
      "--live belongs to the running-run mark and its elapsed timer, nothing else",
    );
    const idleBranch = (card.match(/activeRuns\.length === 0 \?([\s\S]*?)\) : \(/)?.[1] ?? "")
      // Drop comments, or prose *about* the rule reads as a violation of it.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.notEqual(idleBranch.trim(), "", "the idle branch regex stopped matching — refresh it");
    assert.doesNotMatch(idleBranch, /live/i, "the idle state must not carry the accent");
  });
});
