import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalBrowserUrl,
  hrefForRoute,
  parseAppPath,
  pathForAppState,
  validatedReturnTo,
} from "../src/lib/appRoute.js";

describe("app pathname routes", () => {
  it("parses every canonical collection and detail path", () => {
    assert.deepEqual(parseAppPath("/threads"), { route: "main", mobileView: "threads", sessionId: null });
    assert.deepEqual(parseAppPath("/threads/new"), { route: "main", mobileView: "chat", sessionId: null, composingNew: true });
    assert.deepEqual(parseAppPath("/threads/ses%2F123"), { route: "main", mobileView: "chat", sessionId: "ses/123" });
    assert.deepEqual(parseAppPath("/agents/agent%201"), { route: "agents", mobileView: "chat", sessionId: null, agentWorkspaceId: "agent 1" });
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
    assert.equal(pathForAppState({ route: "agents", mobileView: "chat", sessionId: null, agentWorkspaceId: "agent 1" }), "/agents/agent%201");
    assert.equal(pathForAppState({ route: "teams", mobileView: "chat", sessionId: null, teamWorkspaceId: "team 1" }), "/teams/team%201");
    assert.equal(hrefForRoute("main", "ses_123"), "/threads/ses_123");
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
      "/agents/agent-1?tab=workspace&scope=shared&path=src&item=file%3Aa.ts",
    );
    assert.equal(
      canonicalBrowserUrl("/agents/agent-1", "?tab=profile&scope=shared&path=src&item=file%3Aa.ts"),
      "/agents/agent-1?tab=profile",
    );
    assert.equal(
      canonicalBrowserUrl("/teams/team-1", "?tab=profile&artifact=art-1&dialog=create"),
      "/teams/team-1?tab=profile",
    );
    assert.equal(
      canonicalBrowserUrl("/teams/team-1", "?tab=workspace&scope=shared&path=src&item=file%3Aa.ts"),
      "/teams/team-1?tab=workspace&path=src&item=file%3Aa.ts",
    );
    assert.equal(canonicalBrowserUrl("/agents/agent-1", "?tab=artifacts&item=artifact%3Aold"), "/agents/agent-1");
    assert.equal(canonicalBrowserUrl("/teams/team-1", "?tab=artifacts&artifact=old"), "/teams/team-1");
    assert.equal(canonicalBrowserUrl("/teams", "?dialog=create&tab=artifacts"), "/teams?dialog=create");
    assert.equal(canonicalBrowserUrl("/backlog", "?q=stale"), "/backlog");
  });
});
