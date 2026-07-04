import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterArtifacts } from "../src/lib/artifactFilters.js";
import type { RelayArtifact } from "relay-core";

function artifact(overrides: Partial<RelayArtifact> & { id: string }): RelayArtifact {
  return {
    id: overrides.id,
    kind: overrides.kind ?? "diff",
    title: overrides.title ?? "Untitled",
    path: overrides.path ?? "/workspace/out.txt",
    createdAt: "2026-07-04T00:00:00.000Z",
    bytes: overrides.bytes ?? 100,
    workspaceRelativePath: overrides.workspaceRelativePath,
    contentType: overrides.contentType,
  } as RelayArtifact;
}

const artifacts = [
  artifact({ id: "a1", kind: "diff", title: "Auth refactor" }),
  artifact({ id: "a2", kind: "review", title: "Security review" }),
  artifact({ id: "a3", kind: "diff", title: "Remove legacy code" }),
  artifact({ id: "a4", kind: "summary", title: "Sprint summary" }),
];

describe("filterArtifacts", () => {
  it("returns all artifacts when query is empty and kind is all", () => {
    assert.equal(filterArtifacts(artifacts, "", "all").length, 4);
  });

  it("filters by kind", () => {
    const result = filterArtifacts(artifacts, "", "diff");
    assert.equal(result.length, 2);
    assert.ok(result.every((a) => a.kind === "diff"));
  });

  it("filters by title query (case-insensitive)", () => {
    const result = filterArtifacts(artifacts, "auth", "all");
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "a1");
  });

  it("filters by path query", () => {
    const a = [artifact({ id: "p1", title: "X", path: "/workspace/auth/service.ts" })];
    const result = filterArtifacts(a, "auth", "all");
    assert.equal(result.length, 1);
  });

  it("combines kind and query filters", () => {
    const result = filterArtifacts(artifacts, "legacy", "diff");
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "a3");
  });

  it("returns empty array when nothing matches", () => {
    assert.equal(filterArtifacts(artifacts, "xyzzy", "all").length, 0);
  });

  it("trims whitespace from query", () => {
    assert.equal(filterArtifacts(artifacts, "  auth  ", "all").length, 1);
  });
});
