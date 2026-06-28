import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  agentRoleMapsEqual,
  disabledSetsEqual,
  effectiveAgentRoleMap,
  newlyDisabledReadyAgents,
  normalizeAgentRoleMapPayload,
  normalizeDisabledAgentsPayload,
  shouldSnapshotDisabledAgents,
} from "../src/lib/manageAgents.js";
import type { AgentName, AgentRole } from "../src/types.js";

describe("shouldSnapshotDisabledAgents", () => {
  it("snapshots when the drawer first opens with a node", () => {
    assert.equal(shouldSnapshotDisabledAgents(true, null, "sbx_alice"), true);
  });

  it("does NOT re-snapshot while open with the same node (poll race guard)", () => {
    assert.equal(shouldSnapshotDisabledAgents(true, "sbx_alice", "sbx_alice"), false);
  });

  it("re-snapshots when the targeted node changes", () => {
    assert.equal(shouldSnapshotDisabledAgents(true, "sbx_alice", "sbx_bob"), true);
  });

  it("does not snapshot when closed", () => {
    assert.equal(shouldSnapshotDisabledAgents(false, null, "sbx_alice"), false);
  });

  it("does not snapshot when there is no current node", () => {
    assert.equal(shouldSnapshotDisabledAgents(true, null, null), false);
  });
});

describe("normalizeDisabledAgentsPayload", () => {
  it("sorts and dedupes", () => {
    const input: AgentName[] = ["codex", "pi", "codex", "claude"];
    assert.deepEqual(normalizeDisabledAgentsPayload(input), ["claude", "codex", "pi"]);
  });

  it("accepts a Set", () => {
    const input = new Set<AgentName>(["pi", "claude"]);
    assert.deepEqual(normalizeDisabledAgentsPayload(input), ["claude", "pi"]);
  });

  it("returns an empty array for an empty input", () => {
    assert.deepEqual(normalizeDisabledAgentsPayload([]), []);
  });
});

describe("normalizeAgentRoleMapPayload", () => {
  it("keeps known agents and roles in canonical agent order", () => {
    const input = {
      codex: "fixer",
      claude: "planner",
      bogus: "reviewer",
      pi: "builder",
    } as Partial<Record<AgentName | "bogus", AgentRole | "builder">>;

    assert.deepEqual(normalizeAgentRoleMapPayload(input as any), {
      claude: "planner",
      codex: "fixer",
    });
  });

  it("returns an empty object for empty input", () => {
    assert.deepEqual(normalizeAgentRoleMapPayload({}), {});
  });
});

describe("agentRoleMapsEqual", () => {
  it("returns true for equal role maps regardless of object order", () => {
    assert.equal(agentRoleMapsEqual({ codex: "fixer", claude: "planner" }, { claude: "planner", codex: "fixer" }), true);
  });

  it("returns false when role maps differ", () => {
    assert.equal(agentRoleMapsEqual({ codex: "fixer" }, { codex: "planner" }), false);
  });
});

describe("effectiveAgentRoleMap", () => {
  it("uses employee overrides before system defaults", () => {
    assert.deepEqual(effectiveAgentRoleMap({
      agentRoleDefaults: { claude: "planner", codex: "reviewer" },
      agentRoleOverrides: { codex: "implementer" },
    }), {
      claude: "planner",
      codex: "implementer",
    });
  });

  it("filters unknown agents and invalid roles", () => {
    const source = {
      agentRoleDefaults: { claude: "planner", bogus: "reviewer" },
      agentRoleOverrides: { claude: "builder", kimi: "fixer" },
    } as unknown as Parameters<typeof effectiveAgentRoleMap>[0];

    assert.deepEqual(effectiveAgentRoleMap(source), {
      claude: "planner",
      kimi: "fixer",
    });
  });
});

describe("newlyDisabledReadyAgents", () => {
  it("flags ready agents being disabled for the first time", () => {
    const initial = new Set<AgentName>([]);
    const next = new Set<AgentName>(["codex", "claude"]);
    const statuses = { codex: "ready", claude: "failed", pi: "ready" } as const;
    assert.deepEqual(newlyDisabledReadyAgents(initial, next, statuses), ["codex"]);
  });

  it("ignores agents that were already disabled", () => {
    const initial = new Set<AgentName>(["codex"]);
    const next = new Set<AgentName>(["codex", "pi"]);
    const statuses = { codex: "ready", pi: "ready" } as const;
    assert.deepEqual(newlyDisabledReadyAgents(initial, next, statuses), ["pi"]);
  });

  it("returns empty when no newly-disabled agent is ready", () => {
    const initial = new Set<AgentName>([]);
    const next = new Set<AgentName>(["codex"]);
    const statuses = { codex: "failed" } as const;
    assert.deepEqual(newlyDisabledReadyAgents(initial, next, statuses), []);
  });
});

describe("disabledSetsEqual", () => {
  it("returns true for equal sets regardless of insertion order", () => {
    const a = new Set<AgentName>(["claude", "codex"]);
    const b = new Set<AgentName>(["codex", "claude"]);
    assert.equal(disabledSetsEqual(a, b), true);
  });

  it("returns false when sizes differ", () => {
    assert.equal(disabledSetsEqual(new Set(["claude"]), new Set(["claude", "pi"])), false);
  });

  it("returns false when contents differ", () => {
    assert.equal(disabledSetsEqual(new Set(["claude"]), new Set(["pi"])), false);
  });
});
