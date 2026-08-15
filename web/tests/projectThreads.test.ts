import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { projectThreadBuckets, type ThreadItem } from "../src/lib/threads.js";
import type { ProjectRecord, RelaySession } from "../src/types.js";

function project(id: string, name: string, archivedAt?: string): ProjectRecord {
  return {
    id,
    name,
    ownerEmployeeId: "employee-1",
    computerId: "device:employee-1:main",
    workspaceLayout: "project",
    workspaceSubpath: `projects/${id}`,
    leadAgentId: "agent-1",
    members: [],
    enabled: true,
    version: 1,
    createdAt: "2026-08-15T00:00:00Z",
    updatedAt: "2026-08-15T00:00:00Z",
    ...(archivedAt ? { archivedAt } : {}),
  };
}

function thread(id: string, projectId?: string): ThreadItem {
  return {
    session: {
      id,
      projectId,
      workspacePath: "/workspace",
      taskGoal: id,
      participants: [],
      status: "completed",
      phase: "completed",
      createdAt: "2026-08-15T00:00:00Z",
      updatedAt: "2026-08-15T00:00:00Z",
      agentRuns: [],
      artifacts: [],
      decisions: [],
      collaborationRounds: [],
      events: [],
    } satisfies RelaySession,
  };
}

describe("project thread buckets", () => {
  it("keeps empty and archived projects and sends legacy or unknown project threads to Unclassified", () => {
    const result = projectThreadBuckets(
      [thread("alpha-thread", "alpha"), thread("old-thread", "old"), thread("legacy"), thread("orphan", "deleted")],
      [project("zeta", "Zeta"), project("alpha", "Alpha"), project("old", "Old", "2026-08-15T01:00:00Z")],
    );

    assert.deepEqual(result.projects.map(({ project, threads }) => [project.id, threads.map((item) => item.session.id)]), [
      ["alpha", ["alpha-thread"]],
      ["zeta", []],
      ["old", ["old-thread"]],
    ]);
    assert.deepEqual(result.unclassified.map((item) => item.session.id), ["legacy", "orphan"]);
  });
});
