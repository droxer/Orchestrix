import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentRun, RelayArtifact } from "relay-core";
import { labelForAgentRun } from "../src/lib/agentDisplayNames.js";
import {
  buildSpaceItems,
  clampSpaceWidth,
  isThreadSpaceEmpty,
  resolveSelectedSpaceItem,
  SPACE_WIDTH_DEFAULT,
  SPACE_WIDTH_MAX,
  SPACE_WIDTH_MIN,
  threadHasMultipleProducers,
} from "../src/lib/threadSpace.js";

function artifact(input: Partial<RelayArtifact> & Pick<RelayArtifact, "id" | "createdAt">): RelayArtifact {
  return {
    kind: "workspace_file",
    title: input.id,
    path: `/tmp/${input.id}`,
    ...input,
  };
}

function run(input: Partial<AgentRun> & Pick<AgentRun, "id" | "agent">): AgentRun {
  return {
    mode: "action",
    status: "completed",
    startedAt: "2026-08-08T10:00:00.000Z",
    artifactIds: [],
    ...input,
  };
}

describe("buildSpaceItems", () => {
  it("sorts newest first", () => {
    const items = buildSpaceItems(
      [
        artifact({ id: "art_old", createdAt: "2026-08-08T10:01:00.000Z" }),
        artifact({ id: "art_new", createdAt: "2026-08-08T10:03:00.000Z" }),
        artifact({ id: "art_mid", createdAt: "2026-08-08T10:02:00.000Z" }),
      ],
      [],
    );

    assert.deepEqual(items.map((item) => item.artifact.id), ["art_new", "art_mid", "art_old"]);
  });

  it("resolves the producing agent through the run's logical agent id", () => {
    const items = buildSpaceItems(
      [artifact({ id: "art_1", createdAt: "2026-08-08T10:01:00.000Z", agentRunId: "run_1" })],
      [run({ id: "run_1", agent: "claude", logicalAgentId: "agent_ops" })],
      { agent_ops: "Ops Writer" },
      { claude: "Claude Fallback" },
    );

    assert.equal(items[0]?.producerLabel, "Ops Writer");
  });

  it("falls back to the executor display name for legacy runs without a logical agent id", () => {
    const items = buildSpaceItems(
      [artifact({ id: "art_1", createdAt: "2026-08-08T10:01:00.000Z", agentRunId: "run_1" })],
      [run({ id: "run_1", agent: "claude" })],
      { agent_ops: "Ops Writer" },
      { claude: "Claude Fallback" },
    );

    assert.equal(items[0]?.producerLabel, "Claude Fallback");
  });

  it("falls back to the executor display name when the logical agent no longer exists", () => {
    const items = buildSpaceItems(
      [artifact({ id: "art_1", createdAt: "2026-08-08T10:01:00.000Z", agentRunId: "run_1" })],
      [run({ id: "run_1", agent: "codex", logicalAgentId: "agent_gone" })],
      {},
      { codex: "Codex Reviewer" },
    );

    assert.equal(items[0]?.producerLabel, "Codex Reviewer");
  });

  it("leaves the producer empty when the artifact has no run attribution", () => {
    const items = buildSpaceItems(
      [artifact({ id: "art_1", createdAt: "2026-08-08T10:01:00.000Z" })],
      [run({ id: "run_1", agent: "claude", logicalAgentId: "agent_ops" })],
      { agent_ops: "Ops Writer" },
    );

    assert.equal(items[0]?.producerLabel, null);
  });

  it("matches labelForAgentRun for every attribution path", () => {
    const logicalAgentNames = { agent_ops: "Ops Writer", agent_research: "Researcher" };
    const agentDisplayNames = { claude: "Claude Executor" } as const;
    const runs = [
      run({ id: "run_named", agent: "claude", logicalAgentId: "agent_ops" }),
      run({ id: "run_legacy", agent: "claude" }),
      run({ id: "run_missing", agent: "claude", logicalAgentId: "agent_deleted" }),
      run({ id: "run_unmapped", agent: "kimi" }),
    ];
    const artifacts = runs.map((r) =>
      artifact({ id: `art_${r.id}`, createdAt: "2026-08-08T10:01:00.000Z", agentRunId: r.id })
    );

    const items = buildSpaceItems(artifacts, runs, logicalAgentNames, agentDisplayNames);
    for (const item of items) {
      const source = runs.find((r) => `art_${r.id}` === item.artifact.id)!;
      assert.equal(
        item.producerLabel,
        labelForAgentRun(
          { agent: source.agent, ...(source.logicalAgentId ? { agentId: source.logicalAgentId } : {}) },
          logicalAgentNames,
          agentDisplayNames,
        ),
        `attribution drifted for ${source.id}`,
      );
    }
  });
});

describe("threadHasMultipleProducers", () => {
  it("is false for a single-agent thread", () => {
    const runs = [
      run({ id: "run_1", agent: "claude", logicalAgentId: "agent_ops" }),
      run({ id: "run_2", agent: "claude", logicalAgentId: "agent_ops" }),
    ];

    assert.equal(threadHasMultipleProducers(runs), false);
  });

  it("is true when two logical agents share an executor kind", () => {
    const runs = [
      run({ id: "run_1", agent: "claude", logicalAgentId: "agent_ops" }),
      run({ id: "run_2", agent: "claude", logicalAgentId: "agent_research" }),
    ];

    assert.equal(threadHasMultipleProducers(runs), true);
  });

  it("counts legacy runs by executor kind", () => {
    const runs = [run({ id: "run_1", agent: "claude" }), run({ id: "run_2", agent: "codex" })];

    assert.equal(threadHasMultipleProducers(runs), true);
    assert.equal(threadHasMultipleProducers([run({ id: "run_3", agent: "pi" })]), false);
    assert.equal(threadHasMultipleProducers(undefined), false);
  });
});

describe("resolveSelectedSpaceItem", () => {
  const items = buildSpaceItems(
    [artifact({ id: "art_1", createdAt: "2026-08-08T10:01:00.000Z" })],
    [],
  );

  it("returns the selected item", () => {
    assert.equal(resolveSelectedSpaceItem(items, "art_1")?.artifact.id, "art_1");
  });

  it("degrades to the list level for a stale or missing selection", () => {
    assert.equal(resolveSelectedSpaceItem(items, "art_replaced"), null);
    assert.equal(resolveSelectedSpaceItem(items, null), null);
  });
});

describe("isThreadSpaceEmpty", () => {
  it("reflects whether the thread produced anything", () => {
    assert.equal(isThreadSpaceEmpty([]), true);
    assert.equal(
      isThreadSpaceEmpty(buildSpaceItems([artifact({ id: "art_1", createdAt: "2026-08-08T10:01:00.000Z" })], [])),
      false,
    );
  });
});

describe("clampSpaceWidth", () => {
  it("keeps the dragged width inside the panel bounds", () => {
    assert.equal(clampSpaceWidth(SPACE_WIDTH_DEFAULT), SPACE_WIDTH_DEFAULT);
    assert.equal(clampSpaceWidth(10), SPACE_WIDTH_MIN);
    assert.equal(clampSpaceWidth(10_000), SPACE_WIDTH_MAX);
    assert.equal(clampSpaceWidth(Number.NaN), SPACE_WIDTH_DEFAULT);
  });
});
