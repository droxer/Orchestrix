import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { taskAssigneeDisplayName, teamLeadReady } from "../src/lib/taskAssignment.js";
import { teamMutationInput } from "../src/lib/teamForm.js";
import { selectedTeamForWorkspace } from "../src/lib/teamWorkspace.js";

describe("Agent team management", () => {
  it("keeps teams in employee agent management instead of standalone admin navigation", async () => {
    const consoleSource = await readFile(resolve("web/src/components/AdminConsole.tsx"), "utf8");
    const appSource = await readFile(resolve("web/src/App.tsx"), "utf8");
    const agentsSource = await readFile(resolve("web/src/components/AgentsPage.tsx"), "utf8");
    const teamsSource = await readFile(resolve("web/src/components/TeamsPage.tsx"), "utf8");
    const teamWorkspaceSource = await readFile(resolve("web/src/components/TeamWorkspacePage.tsx"), "utf8");
    const sideNavSource = await readFile(resolve("web/src/components/SideNav.tsx"), "utf8");
    const drawerSource = await readFile(resolve("web/src/components/admin/TeamDrawer.tsx"), "utf8");
    const pickerSource = await readFile(resolve("web/src/components/task-board/TaskDrawer.tsx"), "utf8");

    assert.doesNotMatch(consoleSource, /adminTeam|adminAddTeam|<TeamsView/);
    assert.doesNotMatch(agentsSource, /agentsView|managementView|<TeamDrawer|useTeams/);
    assert.match(appSource, /route === "teams" \? \(\s*<TeamsPage/s);
    assert.match(teamsSource, /className="teams-list"/);
    assert.match(teamsSource, /<TeamWorkspacePage/);
    assert.match(teamWorkspaceSource, /"profile", "artifacts", "activities"/);
    assert.match(teamWorkspaceSource, /getTeamArtifacts/);
    assert.match(teamWorkspaceSource, /getWorkspaceBrief\(\{ teamId: team\.id \}/);
    assert.match(teamsSource, /open=\{addTeam\}/);
    assert.doesNotMatch(teamsSource, /editTeam/);
    assert.doesNotMatch(teamsSource, /onEdit=/);
    assert.match(teamWorkspaceSource, /className="team-profile-inline-form"/);
    assert.match(teamWorkspaceSource, /updateTeamMutation\.mutateAsync/);
    assert.match(teamWorkspaceSource, /deleteTeamMutation\.mutateAsync/);
    assert.match(sideNavSource, /data-nav="teams"/);
    assert.match(sideNavSource, /handleRouteClick\(event, "teams"\)/);
    assert.match(drawerSource, /memberAgentIds/);
    assert.match(drawerSource, /leadAgentId/);
    assert.match(drawerSource, /useEmployeeAgents\(open \? employeeId : undefined\)/);
    assert.match(teamsSource, /employeeId=\{currentUser\.employeeId\}/);
    assert.match(pickerSource, /team:\$\{team\.id\}/);
    assert.match(pickerSource, /backlog\.teams_section/);
  });

  it("builds an agent-team payload without exposing employee ownership fields", () => {
    assert.deepEqual(teamMutationInput({
      name: " Delivery ",
      leadAgentId: "agent_lead",
      memberAgentIds: ["agent_lead"],
      enabled: true,
    }), {
      name: "Delivery",
      leadAgentId: "agent_lead",
      memberAgentIds: ["agent_lead"],
      enabled: true,
    });
  });

  it("keeps the employee as assignee when a team executes the task", () => {
    const user = {
      id: "user-1",
      employeeId: "employee-1",
      username: "jordan",
      displayName: "Jordan Lee",
      role: "user" as const,
    };
    assert.equal(taskAssigneeDisplayName({
      assigneeEmployeeId: "employee-1",
      assignedTeamId: "team-1",
    }, user), "Jordan Lee");
    assert.equal(taskAssigneeDisplayName({
      assigneeEmployeeId: "employee-2",
      assignedTeamId: "team-1",
    }, user), "employee-2");
  });

  it("reports Team readiness from the lead rather than a ready supporter", () => {
    assert.equal(teamLeadReady({
      enabled: true,
      lead: {
        id: "lead",
        displayName: "Lead",
        executorKind: "codex",
        enabled: false,
        availability: "offline",
      },
    }), false);
    assert.equal(teamLeadReady({
      enabled: true,
      lead: {
        id: "lead",
        displayName: "Lead",
        executorKind: "codex",
        enabled: true,
        availability: "ready",
      },
    }), true);
  });

  it("shows the first team workspace when the Teams route has no explicit selection", () => {
    const teams = [{ id: "team-delivery", name: "Delivery" }, { id: "team-research", name: "Research" }];

    assert.equal(selectedTeamForWorkspace(teams, null)?.id, "team-delivery");
    assert.equal(selectedTeamForWorkspace(teams, "team-research")?.id, "team-research");
  });
});
