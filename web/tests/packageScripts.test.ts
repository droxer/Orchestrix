import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(path.join(dir, "web", "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("unable to locate web/package.json");
    dir = parent;
  }
}

const manifest = JSON.parse(
  readFileSync(path.join(findRepoRoot(), "web", "package.json"), "utf8"),
) as { scripts?: Record<string, string> };

describe("web package lifecycle", () => {
  it("builds relay-core before Next resolves its exported modules", () => {
    assert.equal(manifest.scripts?.predev, "npm run build -w relay-core");
    assert.equal(manifest.scripts?.prebuild, "npm run build -w relay-core");
    assert.equal(manifest.scripts?.prepreview, "npm run build -w relay-core");
  });
});
