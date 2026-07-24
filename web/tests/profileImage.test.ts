import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

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
    assert.match(agentProfileSource, /<ProfileImagePicker/);
    assert.match(agentProfileSource, /fallback=\{<AgentMark/);
    assert.match(teamProfileSource, /<ProfileImagePicker/);
    assert.match(teamProfileSource, /fallback=\{<TeamMark/);
  });
});
