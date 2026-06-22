import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aggregateMcpByAgent, aggregateSkillsByAgent, totalItemCount } from "../src/lib/agentInventory.js";
import type { DaemonNodeMonitorRecord } from "../src/types.js";

function node(id: string, inventory: DaemonNodeMonitorRecord["agentInventory"]): DaemonNodeMonitorRecord {
  return {
    id,
    status: "ready",
    agents: { claude: "ready", pi: "ready", codex: "ready", kimi: "ready" },
    agentInventory: inventory,
    queuedCommandCount: 0,
    activeRuns: [],
    online: true,
    stale: false,
    createdAt: "2026-06-22T00:00:00Z",
    updatedAt: "2026-06-22T00:00:00Z",
  } as DaemonNodeMonitorRecord;
}

describe("web agent inventory aggregation", () => {
  it("unions skills per agent across nodes and dedupes by namespace/name", () => {
    const nodes = [
      node("n1", {
        claude: {
          skills: [
            { name: "brainstorming", namespace: "superpowers" },
            { name: "frontend-design" },
          ],
          mcpServers: [],
        },
      }),
      node("n2", {
        claude: {
          skills: [{ name: "brainstorming", namespace: "superpowers" }],
          mcpServers: [],
        },
        codex: { skills: [{ name: "review" }], mcpServers: [] },
      }),
    ];

    const groups = aggregateSkillsByAgent(nodes);
    const claude = groups.find((g) => g.agent === "claude");
    assert.deepEqual(
      claude?.items.map((s) => s.name),
      ["brainstorming", "frontend-design"],
    );
    assert.equal(groups.find((g) => g.agent === "codex")?.items.length, 1);
    assert.equal(groups.find((g) => g.agent === "pi")?.items.length, 0);
    assert.equal(totalItemCount(groups), 3);
  });

  it("unions mcp servers per agent and dedupes by name", () => {
    const nodes = [
      node("n1", {
        claude: { skills: [], mcpServers: [{ name: "codegraph", transport: "stdio" }] },
      }),
      node("n2", {
        claude: {
          skills: [],
          mcpServers: [
            { name: "codegraph", transport: "stdio" },
            { name: "context7", transport: "http", command: "https://example.com" },
          ],
        },
      }),
    ];

    const claude = aggregateMcpByAgent(nodes).find((g) => g.agent === "claude");
    assert.deepEqual(
      claude?.items.map((s) => s.name),
      ["codegraph", "context7"],
    );
  });

  it("treats nodes without inventory as empty", () => {
    const groups = aggregateSkillsByAgent([node("n1", undefined)]);
    assert.equal(totalItemCount(groups), 0);
  });
});
