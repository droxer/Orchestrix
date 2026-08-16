import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  orderedProjectMembers,
  parseProjectPageTab,
  projectActivitiesState,
  projectMemberState,
  projectPageActions,
  projectPageTabForKey,
  resolveProjectOverviewState,
  showThreadChrome,
} from "../src/lib/projectPage.js";
import type { EmployeeAgent, ProjectMember, ProjectRecord } from "../src/types.js";

const member = (agentId: string, enabled = true): ProjectMember => ({
  agentId,
  role: "implementer",
  functionTitle: `${agentId} function`,
  responsibilities: `${agentId} responsibilities`,
  enabled,
});

const project = (overrides: Partial<ProjectRecord> = {}): ProjectRecord => ({
  id: "project-1",
  ownerEmployeeId: "employee-1",
  name: "Project one",
  computerId: "device:employee-1:main",
  workspaceLayout: "project",
  workspaceSubpath: "projects/project-1",
  leadAgentId: "lead",
  members: [member("reviewer"), member("lead")],
  enabled: true,
  version: 1,
  createdAt: "2026-08-15T00:00:00Z",
  updatedAt: "2026-08-15T00:00:00Z",
  ...overrides,
});

const agent = (overrides: Partial<EmployeeAgent> = {}): EmployeeAgent => ({
  id: "lead",
  employeeId: "employee-1",
  displayName: "Lead",
  executorKind: "codex",
  skillPolicy: {},
  toolPolicy: {},
  modelPolicy: {},
  enabled: true,
  version: 1,
  availability: "ready",
  placements: [],
  createdAt: "2026-08-15T00:00:00Z",
  updatedAt: "2026-08-15T00:00:00Z",
  ...overrides,
});

describe("project page behavior", () => {
  it("canonicalizes tabs and implements roving keyboard navigation", () => {
    assert.equal(parseProjectPageTab(null), "profile");
    assert.equal(parseProjectPageTab("unknown"), "profile");
    assert.equal(parseProjectPageTab("workspace"), "workspace");
    assert.equal(projectPageTabForKey("profile", "ArrowLeft"), "activities");
    assert.equal(projectPageTabForKey("activities", "ArrowRight"), "profile");
    assert.equal(projectPageTabForKey("workspace", "Home"), "profile");
    assert.equal(projectPageTabForKey("workspace", "End"), "activities");
    assert.equal(projectPageTabForKey("workspace", "Enter"), null);
  });

  it("anchors the lead while preserving the remaining stored roster order", () => {
    assert.deepEqual(
      orderedProjectMembers(project()).map((entry) => entry.agentId),
      ["lead", "reviewer"],
    );
  });

  it("preserves missing and deleted roster identities as unavailable", () => {
    assert.deepEqual(projectMemberState(member("missing"), undefined), {
      available: false,
      enabled: false,
      availability: "offline",
    });
    assert.equal(
      projectMemberState(member("lead"), agent({ deletedAt: "2026-08-16T00:00:00Z" })).available,
      false,
    );
    assert.deepEqual(projectMemberState(member("lead"), agent()), {
      available: true,
      enabled: true,
      availability: "ready",
    });
  });

  it("keeps settings available while restricting new work for archived and disabled projects", () => {
    assert.deepEqual(projectPageActions(project()), { settings: true, newThread: true });
    assert.deepEqual(
      projectPageActions(project({ archivedAt: "2026-08-16T00:00:00Z" })),
      { settings: true, newThread: false },
    );
    assert.deepEqual(
      projectPageActions(project({ enabled: false })),
      { settings: true, newThread: false },
    );
  });

  it("keeps project deep links out of chat through loading, error, and missing states", () => {
    const input = { showProjectOverview: true, project: null } as const;
    assert.equal(resolveProjectOverviewState({ ...input, collectionStatus: "loading" }), "loading");
    assert.equal(resolveProjectOverviewState({ ...input, collectionStatus: "error" }), "error");
    assert.equal(resolveProjectOverviewState({ ...input, collectionStatus: "ready" }), "not-found");
    assert.equal(
      resolveProjectOverviewState({ ...input, project: project(), collectionStatus: "error" }),
      "ready",
    );
    assert.equal(
      resolveProjectOverviewState({ ...input, showProjectOverview: false, collectionStatus: "ready" }),
      "hidden",
    );
  });

  it("removes thread-only chrome from the project dossier", () => {
    assert.equal(showThreadChrome(true), false);
    assert.equal(showThreadChrome(false), true);
  });

  it("distinguishes activity loading, error, and ready states", () => {
    assert.equal(projectActivitiesState({ isLoading: true, hasData: false, hasError: false }), "loading");
    assert.equal(projectActivitiesState({ isLoading: false, hasData: false, hasError: false }), "error");
    assert.equal(projectActivitiesState({ isLoading: false, hasData: false, hasError: true }), "error");
    assert.equal(projectActivitiesState({ isLoading: false, hasData: true, hasError: false }), "ready");
  });
});
