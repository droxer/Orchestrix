import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("agent workspace routing", () => {
  it("resolves the detail page from the route instead of the thread-scoped chat agent", async () => {
    const source = await readFile(resolve("web/src/App.tsx"), "utf8");

    // A thread can be pinned to the cloud computer while the user inspects an
    // agent on their local computer. The page identity must therefore come
    // from /agents/:agentId, not activeLogicalAgent (the chat selection).
    assert.match(
      source,
      /const workspaceAgent = useMemo\(\s*\(\) => logicalAgents\.find\(\(agent\) => agent\.id === agentWorkspaceId\) \?\? null,/s,
    );
    assert.match(source, /workspaceAgent=\{workspaceAgent\}/);
    assert.doesNotMatch(source, /workspaceAgent=\{activeLogicalAgent\?\.id === agentWorkspaceId/);
  });
});
