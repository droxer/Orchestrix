import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hashForAppState, hrefForRoute, parseAppHash } from "../src/lib/appRoute.js";

describe("app hash routes", () => {
  it("parses work routes from hash URLs", () => {
    assert.deepEqual(parseAppHash("#/backlog"), {
      route: "backlog",
      mobileView: "chat",
      sessionId: null,
    });
    assert.deepEqual(parseAppHash("#/routine"), {
      route: "routine",
      mobileView: "chat",
      sessionId: null,
    });
    assert.deepEqual(parseAppHash("#/agents"), {
      route: "agents",
      mobileView: "chat",
      sessionId: null,
    });
    assert.deepEqual(parseAppHash("#/teams"), {
      route: "teams",
      mobileView: "chat",
      sessionId: null,
    });
    assert.deepEqual(parseAppHash("#/agents/agent_123/workspace"), {
      route: "agents",
      mobileView: "chat",
      sessionId: null,
      agentWorkspaceId: "agent_123",
    });
  });

  it("parses chat session and thread-list links", () => {
    assert.deepEqual(parseAppHash("#/chat/ses_123"), {
      route: "main",
      mobileView: "chat",
      sessionId: "ses_123",
    });
    assert.deepEqual(parseAppHash("#/threads"), {
      route: "main",
      mobileView: "threads",
      sessionId: null,
    });
  });

  it("formats app state and route hrefs", () => {
    assert.equal(hashForAppState({ route: "main", mobileView: "chat", sessionId: "ses_123" }), "#/chat/ses_123");
    assert.equal(hashForAppState({ route: "main", mobileView: "threads", sessionId: "ses_123" }), "#/threads");
    assert.equal(hashForAppState({ route: "agents", mobileView: "chat", sessionId: "ses_123", agentWorkspaceId: "agent_123" }), "#/agents/agent_123/workspace");
    assert.equal(hashForAppState({ route: "agents", mobileView: "chat", sessionId: null }), "#/agents");
    assert.equal(hashForAppState({ route: "teams", mobileView: "chat", sessionId: null }), "#/teams");
    assert.equal(hrefForRoute("main", "ses_123"), "#/chat/ses_123");
    assert.equal(hrefForRoute("backlog", "ses_123"), "#/backlog");
    assert.equal(hrefForRoute("teams", "ses_123"), "#/teams");
  });

  it("falls back to chat for unknown hashes", () => {
    assert.deepEqual(parseAppHash("#/missing"), {
      route: "main",
      mobileView: "chat",
      sessionId: null,
    });
  });
});
