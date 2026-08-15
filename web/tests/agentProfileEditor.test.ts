import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("agent profile editor", () => {
  it("adds unified profile-action copy to every locale and drops the old personality-only keys", async () => {
    const locales = ["en", "zh-CN", "zh-TW"];
    for (const locale of locales) {
      const raw = await readFile(resolve(`web/src/i18n/locales/${locale}/translation.json`), "utf8");
      const json = JSON.parse(raw);
      assert.equal(typeof json.agents_page.edit_profile, "string", `${locale} missing agents_page.edit_profile`);
      assert.equal(typeof json.agents_page.write_profile, "string", `${locale} missing agents_page.write_profile`);
      assert.equal(typeof json.agents_page.save_profile, "string", `${locale} missing agents_page.save_profile`);
      assert.equal(json.agents_page.write_personality, undefined, `${locale} still has stale write_personality`);
      assert.equal(json.agents_page.edit_personality, undefined, `${locale} still has stale edit_personality`);
      assert.equal(json.agents_page.save_personality, undefined, `${locale} still has stale save_personality`);
    }
  });

  it("edits name and personality together as one form", async () => {
    const editorSource = await readFile(resolve("web/src/components/AgentProfileEditor.tsx"), "utf8");
    assert.match(editorSource, /export function AgentProfileEditor/);
    assert.match(editorSource, /nameDraft: string;/);
    assert.match(editorSource, /onNameDraftChange: \(value: string\) => void;/);
    assert.match(editorSource, /agents_page\.save_profile/);
    assert.match(editorSource, /agents_page\.edit_profile/);
    assert.match(editorSource, /agents_page\.write_profile/);
    assert.doesNotMatch(editorSource, /save_personality|edit_personality|write_personality/);
  });

  it("unifies name and personality editing in the agent detail record", async () => {
    const panelSource = await readFile(resolve("web/src/components/AgentProfilePanel.tsx"), "utf8");
    assert.match(panelSource, /import \{ AgentProfileEditor \} from "\.\/AgentProfileEditor";/);
    assert.doesNotMatch(panelSource, /AgentPersonalityEditor/);
    assert.match(panelSource, /const \[editingProfile, setEditingProfile\] = useState\(false\);/);
    assert.match(panelSource, /function startEditProfile\(\)/);
    assert.match(panelSource, /async function handleProfileSave\(\)/);
    assert.match(panelSource, /<AgentProfileEditor/);
    assert.doesNotMatch(panelSource, /workspace-dossier-rename/);
    assert.doesNotMatch(panelSource, /workspace-dossier-name-row/);
  });

  it("lets the agent owner delete their own agent, not just admins", async () => {
    const panelSource = await readFile(resolve("web/src/components/AgentProfilePanel.tsx"), "utf8");
    const detailBranchStart = panelSource.indexOf("if (isDetail) {");
    const detailBranchEnd = panelSource.indexOf("\n  return (\n    <div className=\"workspace-profile-panel\">");
    const detailBranch = panelSource.slice(detailBranchStart, detailBranchEnd);
    assert.ok(detailBranchStart > -1 && detailBranchEnd > detailBranchStart, "could not isolate the detail branch");
    assert.match(detailBranch, /\{canEditProfile \? \(\s*<div className="workspace-dossier-admin">/);
    assert.match(detailBranch, /\{canManage \? \(/);
    assert.doesNotMatch(detailBranch, /\{canManage \? \(\s*<div className="workspace-dossier-admin">/);
  });
});
