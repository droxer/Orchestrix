import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { routeComposerMessage } from "../src/lib/messageRouting.js";
import type { MentionableAgent } from "../src/lib/agentDisplayNames.js";

const agents: MentionableAgent[] = [
  { id: "researcher", displayName: "Researcher", executorKind: "claude", ready: true },
  { id: "reviewer", displayName: "Reviewer", executorKind: "pi", ready: true },
  { id: "builder", displayName: "Builder", executorKind: "codex", ready: true },
  { id: "planner", displayName: "Project Planner", executorKind: "kimi", ready: true },
];

describe("composer message routing", () => {
  it("routes an explicit Pi mention away from the active agent", () => {
    const routed = routeComposerMessage("@pi check this", agents[0], agents);

    assert.deepEqual(routed, { agentId: "reviewer", agent: "pi", goal: "check this" });
  });

  it("matches agent mentions case-insensitively", () => {
    const routed = routeComposerMessage("@Pi check this", agents[0], agents);

    assert.deepEqual(routed, { agentId: "reviewer", agent: "pi", goal: "check this" });
  });

  it("keeps unknown leading mentions in the task text", () => {
    const routed = routeComposerMessage("@unknown check this", agents[0], agents);

    assert.deepEqual(routed, { agentId: "researcher", agent: "claude", goal: "@unknown check this" });
  });

  it("reports an empty goal for a bare agent mention", () => {
    const routed = routeComposerMessage("@pi", agents[0], agents);

    assert.deepEqual(routed, { agentId: "reviewer", agent: "pi", goal: "" });
  });

  it("routes a picked logical agent by id and removes its display name from user text", () => {
    const routed = routeComposerMessage("@Builder fix auth", agents[0], agents, "builder");

    assert.deepEqual(routed, { agentId: "builder", agent: "codex", goal: "fix auth" });
  });

  it("supports display names containing spaces", () => {
    const routed = routeComposerMessage("@Project Planner draft a plan", agents[0], agents, "planner");

    assert.deepEqual(routed, { agentId: "planner", agent: "kimi", goal: "draft a plan" });
  });

  it("removes a picker-inserted mention away from the beginning", () => {
    const routed = routeComposerMessage("Please @Builder fix auth", agents[0], agents, "builder");

    assert.deepEqual(routed, { agentId: "builder", agent: "codex", goal: "Please fix auth" });
  });

  it("uses the picked id when logical agents share a display name", () => {
    const duplicate = { id: "builder-2", displayName: "Builder", executorKind: "claude" as const, ready: true };
    const routed = routeComposerMessage("@Builder fix auth", agents[0], [...agents, duplicate], duplicate.id);

    assert.deepEqual(routed, { agentId: "builder-2", agent: "claude", goal: "fix auth" });
  });

  it("keeps a picked agent parseable if it becomes unavailable before send", () => {
    const unavailable = agents.map((agent) => agent.id === "builder" ? { ...agent, ready: false } : agent);
    const routed = routeComposerMessage("@Builder fix auth", agents[0], unavailable, "builder");

    assert.deepEqual(routed, { agentId: "builder", agent: "codex", goal: "fix auth" });
  });
});
