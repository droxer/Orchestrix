import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

async function source(path: string): Promise<string> {
  return readFile(resolve(path), "utf8");
}

describe("node card profile layout", () => {
  it("keeps local and cloud card slots aligned without runtime details", async () => {
    const [card, row, actions, badges, styles] = await Promise.all([
      source("web/src/components/admin/NodeCard.tsx"),
      source("web/src/components/admin/NodeRow.tsx"),
      source("web/src/components/admin/NodeActions.tsx"),
      source("web/src/components/admin/NodeProfileBadges.tsx"),
      source("web/src/styles/admin-v2-views.css"),
    ]);

    assert.match(card, /<NodeProfileBadges[\s\S]*?\bcard\b[\s\S]*?\/>/);
    assert.match(row, /<NodeProfileBadges[\s\S]*?\bhideSandbox\b[\s\S]*?\/>/);
    assert.match(badges, /aria-label=\{!showSandbox\s*\?\s*ownershipLabel/);
    assert.match(badges, /\{showSandbox\s*\?\s*\([\s\S]*?adm-node-profile-sandbox/);
    assert.match(card, /adm-node-card-handle mono\$\{showHandle \? "" : " is-placeholder"\}/);
    assert.match(card, /adm-node-action--copy/);
    assert.match(actions, /adm-node-action--credentials/);
    assert.match(actions, /adm-node-action--agents/);
    assert.match(actions, /adm-node-action--delete/);
    assert.match(styles, /\.adm-node-card-actions\s*\{[^}]*grid-template-columns:\s*repeat\(4, 28px\);/s);
  });
});
