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

describe("composer agent selection", () => {
  it("names the same agents in `@` as in the footer picker", async () => {
    const app = await readFile(resolve("web/src/App.tsx"), "utf8");
    // Both surfaces read one list — the agents placed on the thread's
    // computer — so `@` can never offer an agent the thread cannot run.
    assert.match(app, /mentionCandidates\(selectableLogicalAgents\)/);
    assert.match(app, /logicalAgents,\s*selectedThreadNodeId/);
  });

  it("dispatches a new thread to the agents the draft addresses", async () => {
    const app = await readFile(resolve("web/src/App.tsx"), "utf8");
    assert.match(app, /newThreadAgentIds = messageAddress\.addressAgentIds/);
    assert.match(app, /assignments: newThreadAgentIds!\.map/);
  });

  it("addresses a continued thread to the footer's selected agent", async () => {
    const app = await readFile(resolve("web/src/App.tsx"), "utf8");
    assert.match(
      app,
      /resolveThreadMessageAddress\(\{[\s\S]*?defaultAgentId: pendingTeam \|\| activeSession\?\.teamId[\s\S]*?: activeLogicalAgentId/,
    );
    assert.match(app, /addressAgentIds: messageAddress\.addressAgentIds/);
  });

  it("includes the resolved responder in continued-thread retry identity", async () => {
    const app = await readFile(resolve("web/src/App.tsx"), "utf8");
    assert.match(
      app,
      /threadMessageOperationKey\(\{[\s\S]*?addressAgentIds: messageAddress\.addressAgentIds/,
    );
  });

  it("refuses a draft whose mention resolves to nobody, shortcut included", async () => {
    const composer = await readFile(
      resolve("web/src/components/composer/Composer.tsx"),
      "utf8",
    );
    // The disabled send button is not enough: Cmd+Enter calls triggerSend
    // directly, and a blocked draft sent that way addresses the whole room
    // instead of the agent the author named.
    assert.match(composer, /const triggerSend = \(\) => \{[\s\S]*?parsed\.blocked/);
  });

  it("shows the addressed agent in the footer while the draft names one", async () => {
    const composer = await readFile(
      resolve("web/src/components/composer/Composer.tsx"),
      "utf8",
    );
    assert.match(composer, /addressedLogicalAgentId \?\? activeLogicalAgentId/);
  });
});
