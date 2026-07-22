import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("Next development API proxy", () => {
  it("proxies both team collection and member routes to the backend", async () => {
    const configSource = await readFile(resolve("web/next.config.ts"), "utf8");

    assert.match(configSource, /source: "\/teams", destination: `\$\{backendUrl\}\/teams`/);
    assert.match(configSource, /source: "\/teams\/:path\*", destination: `\$\{backendUrl\}\/teams\/:path\*`/);
  });
});
