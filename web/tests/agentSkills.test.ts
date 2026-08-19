import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("agent skills on the agent record", () => {
  it("ships the skills copy in every locale", async () => {
    for (const locale of ["en", "zh-CN", "zh-TW"]) {
      const raw = await readFile(resolve(`web/src/i18n/locales/${locale}/translation.json`), "utf8");
      const json = JSON.parse(raw);
      assert.equal(typeof json.agents_page.skills_title, "string", `${locale} missing agents_page.skills_title`);
      assert.equal(typeof json.agents_page.skills_empty, "string", `${locale} missing agents_page.skills_empty`);
    }
  });

  it("carries node-reported skills on the agent record type", async () => {
    const types = await readFile(resolve("web/src/types.ts"), "utf8");
    assert.match(types, /skills\?: DaemonAgentSkill\[\];/);
  });

  it("prints the skills section for every viewer of the detail record, not only editors", async () => {
    const panelSource = await readFile(resolve("web/src/components/AgentProfilePanel.tsx"), "utf8");
    const detailBranchStart = panelSource.indexOf("if (isDetail) {");
    const detailBranchEnd = panelSource.indexOf("\n  return (\n    <div className=\"workspace-profile-panel\">");
    assert.ok(detailBranchStart > -1 && detailBranchEnd > detailBranchStart, "could not isolate the detail branch");
    const detailBranch = panelSource.slice(detailBranchStart, detailBranchEnd);
    assert.match(detailBranch, /agents_page\.skills_title/);
    assert.match(detailBranch, /agents_page\.skills_empty/);
    assert.match(detailBranch, /agent-skill-list/);
    // The section must sit above the canEditProfile-gated management block,
    // so a read-only viewer still sees what the agent can do.
    assert.ok(
      detailBranch.indexOf("agents_page.skills_title") < detailBranch.indexOf("{canEditProfile ? ("),
      "skills section must render outside the management gate",
    );
  });

  it("styles the skill list from palette tokens only", async () => {
    const css = await readFile(resolve("web/src/styles/workspace.css"), "utf8");
    const block = css.slice(css.indexOf(".agent-skill-list"));
    assert.match(block, /\.agent-skill-name \{/);
    assert.match(block, /\.agent-skill-description \{/);
    assert.doesNotMatch(block.split(".agent-skill-description")[1] ?? "", /#[0-9a-fA-F]{3,8}/);
  });
});
