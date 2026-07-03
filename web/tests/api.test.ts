import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { apiJson, getWorkspaceBrief, listArtifacts, listTaskArtifacts, listWorkspaceFiles, readWorkspaceFile, RelayApiError } from "../src/api.js";

const originalFetch = globalThis.fetch;

describe("apiJson", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("surfaces JSON detail errors as RelayApiError", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ detail: "Invalid token." }), {
      status: 401,
      statusText: "Unauthorized",
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

    await assert.rejects(
      () => apiJson("/sandboxes"),
      (error) => error instanceof RelayApiError
        && error.status === 401
        && error.message === "Invalid token.",
    );
  });

  it("surfaces plain-text errors as RelayApiError instead of JSON parse failures", async () => {
    globalThis.fetch = (async () => new Response("upstream gateway failed", {
      status: 502,
      statusText: "Bad Gateway",
      headers: { "Content-Type": "text/plain" },
    })) as typeof fetch;

    await assert.rejects(
      () => apiJson("/sessions"),
      (error) => error instanceof RelayApiError
        && error.status === 502
        && error.message === "upstream gateway failed",
    );
  });

  it("lists artifacts with optional employee and workspace filters", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ artifacts: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await listArtifacts({ employeeId: "alice", workspacePath: "/workspace/alice repo" });

    assert.deepEqual(result, { artifacts: [] });
    assert.equal(requestedUrl, "/artifacts?employeeId=alice&workspacePath=%2Fworkspace%2Falice+repo");
  });

  it("lists a task's generated artifacts", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        taskId: "task 1",
        artifacts: [{
          id: "art_deck",
          kind: "workspace_file",
          title: "deck.pptx",
          path: "/workspace/deck.pptx",
          createdAt: "2026-07-01T00:00:00Z",
          sessionId: "ses_1",
          taskId: "task 1",
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await listTaskArtifacts("task 1");

    assert.equal(requestedUrl, "/tasks/task%201/artifacts");
    assert.equal(result.taskId, "task 1");
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0].title, "deck.pptx");
    assert.equal(result.artifacts[0].sessionId, "ses_1");
  });

  it("fetches a workspace brief for a specific employee", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        employeeId: "alice",
        workspacePath: "/workspace/alice",
        primaryNode: null,
        nodes: [],
        activeRuns: [],
        sessions: [],
        tasks: [],
        artifacts: [],
        metrics: {
          nodeCount: 0,
          activeRunCount: 0,
          sessionCount: 0,
          activeSessionCount: 0,
          taskCount: 0,
          activeTaskCount: 0,
          artifactCount: 0,
        },
        generatedAt: "2026-06-27T00:00:00Z",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await getWorkspaceBrief({ employeeId: "alice" });

    assert.equal(result.employeeId, "alice");
    assert.equal(requestedUrl, "/workspace/brief?employeeId=alice");
  });

  it("lists workspace files with optional employee and path filters", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        employeeId: "alice",
        workspacePath: "/workspace/alice",
        path: "src/ui",
        exists: true,
        entries: [],
        limit: 200,
        generatedAt: "2026-06-27T00:00:00Z",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await listWorkspaceFiles({ employeeId: "alice", path: "src/ui" });

    assert.equal(result.employeeId, "alice");
    assert.equal(requestedUrl, "/workspace/files?employeeId=alice&path=src%2Fui");
  });

  it("reads a workspace file's content for the preview pane", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        employeeId: "alice",
        workspacePath: "/workspace/alice",
        path: "src/app.tsx",
        exists: true,
        isBinary: false,
        bytes: 12,
        content: "hello world\n",
        truncated: false,
        limitBytes: 262144,
        generatedAt: "2026-06-27T00:00:00Z",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await readWorkspaceFile({ employeeId: "alice", path: "src/app.tsx" });

    assert.equal(result.content, "hello world\n");
    assert.equal(result.isBinary, false);
    assert.equal(requestedUrl, "/workspace/file?employeeId=alice&path=src%2Fapp.tsx");
  });
});
