import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("Task assignment discoverability", () => {
  it("offers agent and team management actions inside the assignment picker", async () => {
    const drawerSource = await readFile(resolve("web/src/components/task-board/TaskDrawer.tsx"), "utf8");

    assert.match(drawerSource, /__nav_agents__/);
    assert.match(drawerSource, /__nav_teams__/);
    assert.match(drawerSource, /navigateToAppPath\("\/agents"\)/);
    assert.match(drawerSource, /navigateToAppPath\("\/teams\?dialog=create"\)/);
    // Both groups render even when the roster is empty, with explicit
    // empty-state copy instead of a silently missing section.
    assert.match(drawerSource, /backlog\.no_agents_available/);
    assert.match(drawerSource, /backlog\.no_teams_available/);
    assert.match(drawerSource, /backlog\.manage_agents/);
    assert.match(drawerSource, /backlog\.create_team/);
    assert.doesNotMatch(drawerSource, /teamOptions\.length > 0 \?/);
  });

  it("lets the drawer open focused on the assignment picker", async () => {
    const drawerSource = await readFile(resolve("web/src/components/task-board/TaskDrawer.tsx"), "utf8");

    assert.match(drawerSource, /initialFocus\?: "title" \| "assignment"/);
    assert.match(drawerSource, /data-modal-initial-focus=\{initialFocus === "title" \? "" : undefined\}/);
    assert.match(drawerSource, /data-modal-initial-focus=\{initialFocus === "assignment" \? "" : undefined\}/);
  });

  it("exposes a quick-assign action on backlog and routine cards and rows", async () => {
    const backlogSource = await readFile(resolve("web/src/components/BacklogPage.tsx"), "utf8");
    const routinesSource = await readFile(resolve("web/src/components/RoutinesPage.tsx"), "utf8");

    for (const source of [backlogSource, routinesSource]) {
      assert.match(source, /onAssign: \(\) => void/);
      assert.match(source, /onAssign: \(\) => assignTask\(task\)/);
      assert.match(source, /setAssignmentFocus\(true\)/);
      assert.match(source, /initialFocus=\{assignmentFocus \? "assignment" : "title"\}/);
      assert.match(source, /backlog\.assign_task/);
    }
    // Both backlog views (board card + list row) carry the button.
    assert.equal(backlogSource.match(/<NavAgents size=\{14\} \/>/g)?.length, 2);
    assert.match(routinesSource, /RoutineAssignButton/);
  });

  it("navigates in-app paths through the shared navigation event", async () => {
    const appRouteSource = await readFile(resolve("web/src/lib/appRoute.ts"), "utf8");
    const routerSource = await readFile(resolve("web/src/hooks/useAppRouter.ts"), "utf8");

    assert.match(appRouteSource, /export function navigateToAppPath\(path: string\)/);
    assert.match(routerSource, /window\.addEventListener\(APP_NAVIGATION_EVENT, applyCurrentLocation\)/);
  });
});
