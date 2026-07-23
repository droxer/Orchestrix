import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("Admin console refresh stability", () => {
  it("keeps background polling from changing the refresh control", async () => {
    const consoleSource = await readFile(resolve("web/src/components/AdminConsole.tsx"), "utf8");
    const fleetSource = await readFile(resolve("web/src/hooks/useAdminFleet.ts"), "utf8");
    const relayDataSource = await readFile(resolve("web/src/hooks/useRelayData.ts"), "utf8");

    assert.doesNotMatch(consoleSource, /\bisFetching\b/);
    assert.doesNotMatch(fleetSource, /\bisFetching\b/);
    assert.doesNotMatch(relayDataSource, /\bisFetching\b/);
    assert.match(consoleSource, /disabled=\{manualRefreshPending\}/);
    assert.match(consoleSource, /className=\{manualRefreshPending \? "spin" : undefined\}/);
    assert.match(relayDataSource, /const \[manualRefreshPending, setManualRefreshPending\] = useState\(false\)/);
  });
});
