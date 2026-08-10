import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { isTeamRoutable } from "../src/lib/taskAssignment.js";

const member = (availability: string, enabled = true) => ({
  id: `agt_${availability}`,
  displayName: availability,
  executorKind: "claude" as const,
  enabled,
  availability: availability as "ready" | "busy" | "pending" | "offline",
});

describe("composer team targeting", () => {
  it("routes a team only when every member can take work", () => {
    assert.equal(isTeamRoutable({ enabled: true, members: [member("ready"), member("busy")] }), true);
    assert.equal(isTeamRoutable({ enabled: true, members: [member("ready"), member("pending")] }), false);
    assert.equal(isTeamRoutable({ enabled: true, members: [member("ready"), member("offline")] }), false);
    assert.equal(isTeamRoutable({ enabled: false, members: [member("ready")] }), false);
    assert.equal(isTeamRoutable({ enabled: true, deletedAt: "2026-01-01", members: [member("ready")] }), false);
    assert.equal(isTeamRoutable({ enabled: true, members: [] }), false);
  });

  it("offers teams in the composer picker and keeps a started team thread locked", async () => {
    const select = await readFile(resolve("web/src/components/composer/AgentSelect.tsx"), "utf8");
    const app = await readFile(resolve("web/src/App.tsx"), "utf8");

    assert.match(select, /teamSelectValue/);
    assert.match(select, /composer\.teams_group/);
    assert.match(select, /onTeamPicked/);
    // A team thread keeps its roster for life, so the picker locks onto it.
    assert.match(app, /teamLocked=\{Boolean\(activeSession\?\.teamId\)\}/);
    // Team dispatch goes through teamId — the backend expands the roster.
    assert.match(app, /teamId: pendingTeam\.id/);
  });
});
