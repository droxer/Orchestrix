import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { identityHue, identityMonogram } from "../src/lib/identity.js";

describe("Profile images", () => {
  it("supports agent and team image upload, removal, and fallback marks", async () => {
    const apiSource = await readFile(resolve("web/src/api.ts"), "utf8");
    const pickerSource = await readFile(resolve("web/src/components/ProfileImagePicker.tsx"), "utf8");
    const agentProfileSource = await readFile(resolve("web/src/components/AgentProfilePanel.tsx"), "utf8");
    const teamProfileSource = await readFile(resolve("web/src/components/TeamWorkspacePage.tsx"), "utf8");

    assert.match(apiSource, /updateAgentProfileImage/);
    assert.match(apiSource, /deleteAgentProfileImage/);
    assert.match(apiSource, /updateTeamProfileImage/);
    assert.match(apiSource, /deleteTeamProfileImage/);
    assert.match(pickerSource, /image\/png,image\/jpeg,image\/webp/);
    assert.match(pickerSource, /MAX_PROFILE_IMAGE_BYTES/);
    // The default profile image is the name monogram on its identity hue —
    // for agents and teams alike. The vendor/team glyphs are no longer the
    // no-image fallback; they survive only where an executor kind, not a
    // logical identity, is what the UI is naming.
    assert.match(agentProfileSource, /<ProfileImagePicker/);
    assert.match(agentProfileSource, /fallback=\{<IdentityMonogram name=\{agent\.displayName\}/);
    assert.match(teamProfileSource, /<ProfileImagePicker/);
    assert.match(teamProfileSource, /fallback=\{<IdentityMonogram name=\{team\.name\}/);
  });

  it("derives a stable monogram and hue from the display name", () => {
    // Multi-word names abbreviate to initials; a single word takes its first
    // two characters so `claude` and `codex` stay distinguishable.
    assert.equal(identityMonogram("Growth Team"), "GT");
    assert.equal(identityMonogram("growth.lead"), "GL");
    assert.equal(identityMonogram("claude-main"), "CM");
    assert.equal(identityMonogram("claude"), "CL");
    assert.equal(identityMonogram("研究组"), "研究");
    assert.equal(identityMonogram("   "), "?");

    // Same name → same hue on every surface and across reloads.
    assert.equal(identityHue("Growth Team"), identityHue("Growth Team"));
    assert.notEqual(identityHue("Growth Team"), identityHue("Support Team"));
    for (const name of ["Growth Team", "claude-main", "研究组", ""]) {
      const hue = identityHue(name);
      assert.ok(Number.isInteger(hue) && hue >= 0 && hue < 360, `hue out of range for ${name}`);
    }
  });

  it("gives every chat-panel agent surface the same profile image", async () => {
    const messageBlock = await readFile(resolve("web/src/components/MessageBlock.tsx"), "utf8");
    const agentSelect = await readFile(resolve("web/src/components/composer/AgentSelect.tsx"), "utf8");
    const transcriptEmpty = await readFile(resolve("web/src/components/TranscriptEmpty.tsx"), "utf8");
    const chatCss = await readFile(resolve("web/src/styles/chat.css"), "utf8");

    // A turn's face is resolved by the logical agent id that ran it — keyed
    // exactly like its label — so two agents sharing an executor kind never
    // wear each other's image.
    assert.match(messageBlock, /imageForAgentRun\(message, logicalAgentImages\)/);
    assert.match(messageBlock, /fallback=\{<IdentityMonogram name=\{agentName\}/);
    assert.doesNotMatch(messageBlock, /rail-node-agent[\s\S]{0,120}<AgentMark/);

    // The composer picker names one logical agent, so it reads profileImageUrl
    // straight off it. The new-thread landing speaks for Relay itself, not
    // whichever agent the picker happens to point at — the product mark, no
    // agent face, no executor tint.
    assert.match(agentSelect, /src=\{activeLogicalAgent\.profileImageUrl\}/);
    assert.match(agentSelect, /src=\{logicalAgent\.profileImageUrl\}/);
    assert.doesNotMatch(agentSelect, /AgentMark/);
    assert.match(transcriptEmpty, /RelayMark/);
    assert.doesNotMatch(transcriptEmpty, /ProfileImage|AgentMark|agent-avatar/);

    // The image must fill the 20px speaker node, and a grouped continuation
    // has to dim it the same way it dimmed the old glyph.
    assert.match(chatCss, /\.rail-node-agent > \.profile-image \{[^}]*width: 100%/);
    assert.match(chatCss, /\.msg-agent\.grouped \.rail-node-agent > \.profile-image/);
  });

  it("keeps the monogram legible as a themed identity mark", async () => {
    const css = await readFile(resolve("web/src/styles/profile-image.css"), "utf8");
    const rule = css.match(/\.identity-monogram\s*\{([^}]*)\}/)?.[1] ?? "";

    // Tinted against surface tokens rather than a fixed lightness, so the
    // mark adapts to both themes; --ink-1 keeps the letters readable.
    assert.match(rule, /background:\s*color-mix\(in srgb, hsl\(var\(--avatar-hue/);
    assert.match(rule, /color:\s*var\(--ink-1\)/);
    assert.match(rule, /font-size:\s*var\(--monogram-size/);
  });
});
