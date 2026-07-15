import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("Admin channel setup navigation", () => {
  it("exposes and renders the Channels setup view", async () => {
    const storeSource = await readFile(resolve("web/src/lib/store.ts"), "utf8");
    const consoleSource = await readFile(resolve("web/src/components/AdminConsole.tsx"), "utf8");
    const toggleSource = await readFile(resolve("web/src/components/admin/AdminViewToggle.tsx"), "utf8");
    assert.match(storeSource, /AdminConsoleView[^\n]+"integrations"/);
    assert.match(consoleSource, /ChatIntegrationsView/);
    assert.match(toggleSource, /nav_integrations/);
    const setupSource = await readFile(resolve("web/src/components/admin/ChatIntegrationsView.tsx"), "utf8");
    assert.match(setupSource, /chat-public-base-url/);
    assert.match(setupSource, /chat-edit-public-base-url/);
    assert.match(setupSource, /updateChatIntegration/);
  });
});
