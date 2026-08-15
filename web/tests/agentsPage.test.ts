import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("agent roster", () => {
  it("shows the runtime and every active computer", async () => {
    const source = await readFile(resolve("web/src/components/AgentsPage.tsx"), "utf8");

    assert.match(source, /agentLabel\(agent\.executorKind\)/);
    assert.match(source, /placementDescriptions\.map\(/);
    assert.doesNotMatch(source, /const computer = placementDescriptions\[0\]/);
  });
});
