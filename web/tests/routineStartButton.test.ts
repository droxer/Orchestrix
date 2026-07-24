import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("routine start button", () => {
  it("uses the shared compact icon treatment in both routine views", async () => {
    const source = await readFile(resolve("web/src/components/RoutinePage.tsx"), "utf8");
    const styles = await readFile(resolve("web/src/styles/backlog.css"), "utf8");
    const usages = source.match(/<RoutineStartButton\b/g) ?? [];

    assert.equal(usages.length, 2);
    assert.match(source, /variant="ghost"/);
    assert.match(source, /className="icon-button icon-button--sm icon-button--tinted backlog-action-icon"/);
    assert.doesNotMatch(source, /className="backlog-action-primary backlog-action-icon"/);
    assert.match(styles, /\.backlog-task-actions button:not\(\.icon-button\)/);
    assert.match(styles, /\.backlog-row-actions button:not\(\.icon-button\)/);
  });
});
