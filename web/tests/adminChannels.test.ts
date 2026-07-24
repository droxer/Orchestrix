import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("Admin channel setup navigation", () => {
  it("renders Channels setup only on the top-level route, not in the admin console", async () => {
    // Channels lives at #/channels (sidebar Manage group); the admin console
    // must NOT embed a duplicate integrations view or toggle segment.
    const storeSource = await readFile(resolve("web/src/lib/store.ts"), "utf8");
    const consoleSource = await readFile(resolve("web/src/components/AdminConsole.tsx"), "utf8");
    const toggleSource = await readFile(resolve("web/src/components/admin/AdminViewToggle.tsx"), "utf8");
    assert.doesNotMatch(storeSource, /"integrations"/);
    assert.doesNotMatch(consoleSource, /ChatIntegrationsView/);
    assert.doesNotMatch(toggleSource, /nav_integrations/);
    const setupSource = await readFile(resolve("web/src/components/admin/ChatIntegrationsView.tsx"), "utf8");
    const channelsPage = await readFile(resolve("web/src/components/ChannelsPage.tsx"), "utf8");
    const englishCopy = await readFile(resolve("web/src/i18n/locales/en/translation.json"), "utf8");
    assert.match(setupSource, /\$\{idPrefix\}-public-base-url/);
    assert.match(setupSource, /chat-edit-public-base-url/);
    assert.match(setupSource, /updateChatIntegration/);
    assert.match(setupSource, /adm-chat-provider-static/);
    assert.match(setupSource, /adm-chat-stage/);
    assert.match(setupSource, /adm-chat-section/);
    assert.match(setupSource, /Drawer/);
    assert.match(setupSource, /chat_field_bot_token/);
    assert.match(setupSource, /idPrefix = "chat"/);
    assert.match(channelsPage, /ChatIntegrationsView/);
    assert.match(channelsPage, /showToolbarCreate=\{false\}/);
    assert.doesNotMatch(setupSource, /value="lark"/);
    assert.match(englishCopy, /"sub_integrations": "Telegram channels\."/);
    assert.match(englishCopy, /"chat_stage_title"/);
    assert.match(englishCopy, /"chat_live_title"/);
    assert.doesNotMatch(englishCopy, /Lark/);
  });
});
