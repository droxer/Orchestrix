import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("Next development API proxy", () => {
  it("proxies the versioned API and persisted profile media", async () => {
    const configSource = await readFile(resolve("web/next.config.ts"), "utf8");

    assert.match(configSource, /source: "\/api\/:path\*", destination: `\$\{backendUrl\}\/api\/:path\*`/);
    assert.match(configSource, /source: "\/profile-images\/:path\*", destination: `\$\{backendUrl\}\/profile-images\/:path\*`/);
    assert.doesNotMatch(configSource, /backendUrl\}\/sessions/);
    assert.doesNotMatch(configSource, /backendUrl\}\/cp/);
  });

  it("serves only recognized clean browser routes through the SPA", async () => {
    const configSource = await readFile(resolve("web/next.config.ts"), "utf8");

    // Every WORK_PATHS entry in web/src/lib/appRoute.ts needs a fallback here
    // or a direct load / refresh of that URL 404s in dev — which is how
    // /computer shipped: client-side nav worked, F5 did not.
    for (const route of ["login", "threads", "backlog", "computer", "routines", "agents", "teams", "channels", "admin"]) {
      assert.match(configSource, new RegExp(`source: "\\/${route}`));
    }
  });
});
