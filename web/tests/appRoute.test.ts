import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  browserUrlForAppState,
  canonicalBrowserUrl,
  hrefForRoute,
  parseAppPath,
  pathForAppState,
  pathKeepsThreadSpaceParams,
  validatedReturnTo,
} from "../src/lib/appRoute.js";

describe("app pathname routes", () => {
  it("parses every canonical collection and detail path", () => {
    assert.deepEqual(parseAppPath("/threads"), { route: "main", mobileView: "threads", sessionId: null });
    assert.deepEqual(parseAppPath("/threads/new"), { route: "main", mobileView: "chat", sessionId: null, composingNew: true });
    assert.deepEqual(parseAppPath("/threads/ses%2F123"), { route: "main", mobileView: "chat", sessionId: "ses/123" });
    assert.deepEqual(parseAppPath("/projects"), { route: "projects", mobileView: "threads", sessionId: null });
    assert.deepEqual(parseAppPath("/projects/prj%2F123"), { route: "projects", mobileView: "chat", sessionId: null, projectId: "prj/123" });
    assert.deepEqual(parseAppPath("/projects/prj%2F123/new"), { route: "projects", mobileView: "chat", sessionId: null, projectId: "prj/123", composingNew: true });
    assert.deepEqual(parseAppPath("/projects/prj%2F123/threads/ses%2F123"), { route: "projects", mobileView: "chat", sessionId: "ses/123", projectId: "prj/123" });
    assert.deepEqual(parseAppPath("/agents/agent%201"), { route: "agents", mobileView: "chat", sessionId: null, agentId: "agent 1" });
    assert.deepEqual(parseAppPath("/teams/team%201"), { route: "teams", mobileView: "chat", sessionId: null, teamWorkspaceId: "team 1" });

    const routes = {
      "/backlog": "backlog",
      "/routines": "routine",
      "/agents": "agents",
      "/teams": "teams",
      "/channels": "channels",
      "/admin": "admin",
      "/computer": "computer",
    } as const;
    for (const [path, route] of Object.entries(routes)) {
      assert.equal(parseAppPath(path).route, route);
    }
  });

  it("formats clean paths with encoded entity ids", () => {
    assert.equal(pathForAppState({ route: "main", mobileView: "chat", sessionId: "ses/123" }), "/threads/ses%2F123");
    assert.equal(pathForAppState({ route: "main", mobileView: "chat", sessionId: null, composingNew: true }), "/threads/new");
    assert.equal(pathForAppState({ route: "projects", mobileView: "threads", sessionId: null, projectId: "prj/123" }), "/projects/prj%2F123");
    assert.equal(pathForAppState({ route: "projects", mobileView: "chat", sessionId: null, projectId: "prj/123", composingNew: true }), "/projects/prj%2F123/new");
    assert.equal(pathForAppState({ route: "projects", mobileView: "chat", sessionId: "ses/123", projectId: "prj/123" }), "/projects/prj%2F123/threads/ses%2F123");
    assert.equal(pathForAppState({ route: "agents", mobileView: "chat", sessionId: null, agentId: "agent 1" }), "/agents/agent%201");
    assert.equal(pathForAppState({ route: "teams", mobileView: "chat", sessionId: null, teamWorkspaceId: "team 1" }), "/teams/team%201");
    assert.equal(hrefForRoute("main", "ses_123"), "/threads/ses_123");
    assert.equal(hrefForRoute("projects"), "/projects");
    assert.equal(hrefForRoute("backlog"), "/backlog");
    assert.equal(hrefForRoute("routine"), "/routines");
    assert.equal(hrefForRoute("computer"), "/computer");
  });

  it("marks unknown paths as not found instead of opening chat", () => {
    assert.equal(parseAppPath("/missing").notFound, true);
    assert.equal(parseAppPath("/threads/a/b").notFound, true);
  });

  it("accepts only recognized same-origin authentication return paths", () => {
    assert.equal(validatedReturnTo("/threads/ses_1?tab=activity"), "/threads/ses_1");
    assert.equal(validatedReturnTo("https://evil.example/threads"), "/threads");
    assert.equal(validatedReturnTo("//evil.example/threads"), "/threads");
    assert.equal(validatedReturnTo("/missing"), "/threads");
    assert.equal(validatedReturnTo("/login"), "/threads");
  });

  it("keeps only query parameters owned by the route and selected tab", () => {
    assert.equal(
      canonicalBrowserUrl("/agents", "?q=ops&availability=ready&tab=workspace"),
      "/agents?q=ops&availability=ready",
    );
    assert.equal(
      canonicalBrowserUrl("/agents/agent-1", "?q=ops&tab=workspace&scope=shared&path=src&item=file%3Aa.ts"),
      "/agents/agent-1",
    );
    assert.equal(
      canonicalBrowserUrl("/agents/agent-1", "?tab=profile&scope=shared&path=src&item=file%3Aa.ts"),
      "/agents/agent-1",
    );
    assert.equal(
      canonicalBrowserUrl("/teams/team-1", "?tab=profile&artifact=art-1&dialog=create"),
      "/teams/team-1",
    );
    assert.equal(
      canonicalBrowserUrl("/teams/team-1", "?tab=workspace&scope=shared&path=src&item=file%3Aa.ts"),
      "/teams/team-1",
    );
    assert.equal(
      canonicalBrowserUrl("/projects/project-1", "?tab=workspace&scope=shared&path=src&item=file%3Aa.ts"),
      "/projects/project-1?tab=workspace&path=src&item=file%3Aa.ts",
    );
    assert.equal(
      canonicalBrowserUrl("/projects/project-1", "?tab=activities&path=stale&item=file%3Aa.ts"),
      "/projects/project-1?tab=activities",
    );
    assert.equal(canonicalBrowserUrl("/agents/agent-1", "?tab=artifacts&item=artifact%3Aold"), "/agents/agent-1");
    assert.equal(canonicalBrowserUrl("/agents/agent-1", "?tab=activities"), "/agents/agent-1?tab=activities");
    assert.equal(canonicalBrowserUrl("/teams/team-1", "?tab=artifacts&artifact=old"), "/teams/team-1");
    assert.equal(canonicalBrowserUrl("/teams", "?dialog=create&tab=artifacts"), "/teams?dialog=create");
    assert.equal(canonicalBrowserUrl("/backlog", "?q=stale"), "/backlog");
  });

  it("round-trips the thread space panel params on thread paths", () => {
    // ?space=1&artifact=<id> survive reload and sharing on an open thread.
    assert.equal(
      canonicalBrowserUrl("/threads/ses-1", "?space=1&artifact=art-9"),
      "/threads/ses-1?space=1&artifact=art-9",
    );
    assert.equal(canonicalBrowserUrl("/threads/ses-1", "?space=1"), "/threads/ses-1?space=1");
    // A selection without an open panel is meaningless; so is space=0.
    assert.equal(canonicalBrowserUrl("/threads/ses-1", "?artifact=art-9"), "/threads/ses-1");
    assert.equal(canonicalBrowserUrl("/threads/ses-1", "?space=0"), "/threads/ses-1");
    // Composing a new thread has no output, and the collection has no panel.
    assert.equal(canonicalBrowserUrl("/threads/new", "?space=1"), "/threads/new");
    assert.equal(
      canonicalBrowserUrl("/projects/prj-1/threads/ses-1", "?space=1&artifact=art-9"),
      "/projects/prj-1/threads/ses-1?space=1&artifact=art-9",
    );
    // The bare list path still shows a thread on desktop, so it owns the
    // panel params too — otherwise the toggle writes them and the canonical
    // URL drops them again, and the button does nothing.
    assert.equal(
      canonicalBrowserUrl("/threads", "?space=1&artifact=art-9"),
      "/threads?space=1&artifact=art-9",
    );
  });

  it("reports which paths keep the thread space params", () => {
    // A surface that writes ?space=1 on a path that does not own it gets the
    // param canonicalized straight back out, so the toggle does nothing at
    // all — so every path that can show the toggle has to keep them.
    assert.equal(pathKeepsThreadSpaceParams("/threads/ses-1"), true);
    assert.equal(pathKeepsThreadSpaceParams("/threads"), true);
    assert.equal(pathKeepsThreadSpaceParams("/threads/new"), false);
    assert.equal(pathKeepsThreadSpaceParams("/projects/prj-1/threads/ses-1"), true);
    assert.equal(pathKeepsThreadSpaceParams("/backlog"), false);
  });

  it("keeps the open space panel when a state change stays on the same thread", () => {
    const onThread = {
      route: "main" as const,
      mobileView: "chat" as const,
      sessionId: "ses-1",
      composingNew: false,
    };
    // Sending another turn in the thread re-syncs the same path — the panel
    // must survive it. This is the team-room case: the room accumulates
    // artifacts, and every follow-up message re-syncs the thread URL.
    assert.equal(
      browserUrlForAppState(onThread, "/threads/ses-1", "?space=1&artifact=art-9"),
      "/threads/ses-1?space=1&artifact=art-9",
    );
    // Switching to a different thread drops the previous thread's selection.
    assert.equal(
      browserUrlForAppState(onThread, "/threads/ses-2", "?space=1&artifact=art-9"),
      "/threads/ses-1",
    );
    // Staging a new thread has no artifacts to describe.
    assert.equal(
      browserUrlForAppState(
        { route: "main", mobileView: "chat", sessionId: null, composingNew: true },
        "/threads/ses-1",
        "?space=1",
      ),
      "/threads/new",
    );
    // Params the path does not own are still canonicalized away.
    assert.equal(
      browserUrlForAppState(onThread, "/threads/ses-1", "?artifact=art-9"),
      "/threads/ses-1",
    );
  });
});
