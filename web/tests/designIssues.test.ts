import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolve } from "node:path";

import { activityChartMetrics } from "../src/lib/activityChart.js";

const readWeb = (path: string) => readFileSync(resolve("web", path), "utf8");

describe("reviewed design regressions", () => {
  it("keeps chart scale padding separate from the reported data peak", () => {
    assert.deepEqual(activityChartMetrics([]), { dataPeak: 0, scaleMax: 4 });
    assert.deepEqual(
      activityChartMetrics([{ date: "2026-08-29", count: 2, completed: 0, failed: 0 }]),
      { dataPeak: 2, scaleMax: 4 },
    );
    assert.deepEqual(
      activityChartMetrics([{ date: "2026-08-29", count: 7, completed: 0, failed: 0 }]),
      { dataPeak: 7, scaleMax: 7 },
    );
  });

  it("limits the mobile tab bar to primary destinations and puts secondary routes in More", () => {
    const nav = readWeb("src/components/SideNav.tsx");
    const responsive = readWeb("src/styles/responsive.css");

    assert.match(responsive, /\.sidenav-secondary-item\s*\{[^}]*display:\s*none\s*!important/s);
    for (const route of ["routine", "teams", "computer", "channels", "admin"]) {
      assert.match(nav, new RegExp(`sidenav-more-item[^>]*[\\s\\S]*?href=\\{hrefForRoute\\(\\"${route}\\"\\)\\}`));
    }
    assert.doesNotMatch(nav, /channelsHint|coming_soon_short/);
  });

  it("uses a one-pane list/detail flow for agents and teams on mobile", () => {
    const agents = readWeb("src/components/AgentsPage.tsx");
    const teams = readWeb("src/components/TeamsPage.tsx");
    const agentStyles = readWeb("src/styles/agents.css");
    const teamStyles = readWeb("src/styles/teams.css");

    assert.match(agents, /data-view=\{detailAgent \? "detail" : "list"\}/);
    assert.match(agents, /className="agents-mobile-back"/);
    assert.match(agentStyles, /\.agents-page\[data-view="list"\]\s+\.agents-detail\s*\{[^}]*display:\s*none/s);
    assert.match(agentStyles, /\.agents-page\[data-view="detail"\]\s+\.agents-roster\s*\{[^}]*display:\s*none/s);

    assert.match(teams, /data-view=\{selectedTeam \? "detail" : "list"\}/);
    assert.match(teams, /className="teams-mobile-back"/);
    assert.match(teamStyles, /\.teams-page\[data-view="list"\]\s+\.teams-detail\s*\{[^}]*display:\s*none/s);
    assert.match(teamStyles, /\.teams-page\[data-view="detail"\]\s+\.teams-roster\s*\{[^}]*display:\s*none/s);
  });

  it("makes decorative empty-state marginalia opt-in", () => {
    const emptyState = readWeb("src/components/RelayEmptyState.tsx");
    assert.match(emptyState, /\{marginalia \? \(/);
    assert.doesNotMatch(emptyState, /marginalia \?\? <RelayDoodleNotes/);
  });

  it("associates reviewed select triggers with their visible labels", () => {
    const taskDrawer = readWeb("src/components/task-board/TaskDrawer.tsx");
    const teamDrawer = readWeb("src/components/admin/TeamDrawer.tsx");
    const employeeDrawer = readWeb("src/components/admin/AddEmployeeDrawer.tsx");

    assert.match(taskDrawer, /labelId=\{priorityLabelId\}[\s\S]*?aria-labelledby=\{priorityLabelId\}/);
    assert.match(teamDrawer, /labelId=\{leadLabelId\}[\s\S]*?aria-labelledby=\{leadLabelId\}/);
    assert.match(employeeDrawer, /labelId=\{nodeLabelId\}[\s\S]*?aria-labelledby=\{nodeLabelId\}/);
  });

  it("reserves fallback space for markdown images", () => {
    const markdownStyles = readWeb("src/styles/markdown.css");
    assert.match(markdownStyles, /\.md-body img\s*\{[^}]*aspect-ratio:\s*auto 16 \/ 9/s);
  });
});
