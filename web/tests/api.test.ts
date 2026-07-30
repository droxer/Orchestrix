import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  apiJson,
  archiveSession,
  assignControlPanelDaemonNode,
  assignTask,
  cancelRun,
  deleteTask,
  getTeamArtifacts,
  getWorkspaceBrief,
  listAgentWorkspaceFiles,
  listArtifacts,
  listEmployeeAgents,
  listTaskArtifacts,
  readAgentWorkspaceFile,
  RelayApiError,
  renameSession,
  runLogicalAgents,
  startTask,
  updateAgentProfileImage,
  updateComputerDisplayName,
  updateOwnEmployeeAgent,
  updateUserPreferences,
} from "../src/api.js";

const originalFetch = globalThis.fetch;

describe("apiJson", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renames a computer through the owner-facing daemon-node resource", async () => {
    let requestPath = "";
    let requestInit: RequestInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestPath = String(input);
      requestInit = init;
      return new Response(JSON.stringify({
        node: {
          id: "sbx_alice",
          displayName: "Office Mac",
          status: "ready",
          agents: {},
          createdAt: "2026-07-26T00:00:00Z",
          updatedAt: "2026-07-26T00:00:00Z",
          queuedCommandCount: 0,
          activeRuns: [],
          online: true,
          stale: false,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const result = await updateComputerDisplayName("sbx_alice", "Office Mac");

    assert.equal(requestPath, "/api/v1/daemon-nodes/sbx_alice");
    assert.equal(requestInit?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(requestInit?.body)), { displayName: "Office Mac" });
    assert.equal(result.node.displayName, "Office Mac");
  });

  it("persists a changed user preference without resending the other setting", async () => {
    let requestPath = "";
    let requestInit: RequestInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestPath = String(input);
      requestInit = init;
      return new Response(JSON.stringify({
        user: {
          id: "usr_alice",
          username: "alice",
          role: "user",
          theme: "dark",
          language: "en",
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const result = await updateUserPreferences({ theme: "dark" });

    assert.equal(requestPath, "/api/v1/auth/preferences");
    assert.equal(requestInit?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(requestInit?.body)), { theme: "dark" });
    assert.equal(result.user.theme, "dark");
  });

  it("uses canonical methods and subresources for normalized mutations", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({
        path: String(input),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    await renameSession("thread 1", "Roadmap");
    await archiveSession("thread 1");
    await cancelRun("thread 1");
    await assignTask("task 1", "agent 1");
    await startTask("task 1");
    await assignControlPanelDaemonNode({ nodeId: "node 1", employeeId: "alice" });

    assert.deepEqual(requests, [
      { path: "/api/v1/threads/thread%201", method: "PATCH", body: { title: "Roadmap" } },
      { path: "/api/v1/threads/thread%201", method: "PATCH", body: { archived: true } },
      { path: "/api/v1/threads/thread%201/cancellations", method: "POST", body: { reason: "Cancelled from Relay Web UI." } },
      { path: "/api/v1/tasks/task%201/assignment", method: "PUT", body: { agentId: "agent 1" } },
      { path: "/api/v1/tasks/task%201/runs", method: "POST", body: {} },
      { path: "/api/v1/admin/daemon-nodes/node%201/assignment", method: "PUT", body: { employeeId: "alice" } },
    ]);
  });

  it("keeps persisted profile media outside the versioned JSON namespace", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ agent: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await updateAgentProfileImage("agent 1", "data:image/png;base64,AA==");

    assert.equal(requestedUrl, "/profile-images/agents/agent%201");
  });

  it("reports an HTML fallback response instead of attempting to parse it as JSON", async () => {
    globalThis.fetch = (async () => new Response("<!DOCTYPE html><html><body>Relay</body></html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    })) as typeof fetch;

    await assert.rejects(
      () => apiJson("/api/v1/agents/agent_1/workspace/files"),
      (error: unknown) => error instanceof RelayApiError
        && error.status === 200
        && error.message.includes("HTML response"),
    );
  });

  it("surfaces JSON detail errors as RelayApiError", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ detail: "Invalid token." }), {
      status: 401,
      statusText: "Unauthorized",
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

    await assert.rejects(
      () => apiJson("/api/v1/sandboxes"),
      (error) => error instanceof RelayApiError
        && error.status === 401
        && error.code === "Invalid token."
        && error.message === "Invalid token.",
    );
  });

  it("preserves a stable task deletion error code", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      detail: "task_execution_active",
    }), {
      status: 409,
      statusText: "Conflict",
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

    await assert.rejects(
      () => deleteTask("task 1"),
      (error) => error instanceof RelayApiError
        && error.status === 409
        && error.code === "task_execution_active",
    );
  });

  it("surfaces structured JSON detail messages without stringifying the payload", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      detail: {
        code: "workspace_unavailable",
        message: "Agent Hawkeye has no eligible runtime placement (workspace_unavailable).",
      },
    }), {
      status: 409,
      statusText: "Conflict",
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

    await assert.rejects(
      () => apiJson("/api/v1/agent-runs"),
      (error) => error instanceof RelayApiError
        && error.status === 409
        && error.message === "Agent Hawkeye has no eligible runtime placement (workspace_unavailable).",
    );
  });

  it("surfaces plain-text errors as RelayApiError instead of JSON parse failures", async () => {
    globalThis.fetch = (async () => new Response("upstream gateway failed", {
      status: 502,
      statusText: "Bad Gateway",
      headers: { "Content-Type": "text/plain" },
    })) as typeof fetch;

    await assert.rejects(
      () => apiJson("/api/v1/threads"),
      (error) => error instanceof RelayApiError
        && error.status === 502
        && error.message === "upstream gateway failed",
    );
  });

  it("lists employee-owned logical agents", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ agents: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    assert.deepEqual(await listEmployeeAgents(), { agents: [] });
    assert.equal(requestedUrl, "/api/v1/agents");
  });

  it("updates employee-owned logical agent metadata", async () => {
    let requestUrl = "";
    let requestBody: unknown;
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        agent: {
          id: "agent_research",
          displayName: "Analyst",
          instructions: "Cite sources.",
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const result = await updateOwnEmployeeAgent("agent_research", {
      displayName: "Analyst",
      instructions: "Cite sources.",
    });

    assert.equal(requestUrl, "/api/v1/agents/agent_research");
    assert.deepEqual(requestBody, { displayName: "Analyst", instructions: "Cite sources." });
    assert.equal(result.agent.displayName, "Analyst");
  });

  it("dispatches work by logical agent id without a sandbox id", async () => {
    let requestUrl = "";
    let requestBody: unknown;
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "ses_1", agentRuns: [] }), { status: 202, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    await runLogicalAgents({
      taskGoal: "Build it",
      daemonNodeId: "node_selected",
      assignments: [{ agentId: "agent_builder", mode: "action" }],
      sessionId: "ses_existing",
      userMessageId: "evt_user",
      decision: { kind: "handoff", targetAgent: "codex", note: "Continue here" },
    });

    assert.equal(requestUrl, "/api/v1/agent-runs");
    assert.deepEqual(requestBody, {
      taskGoal: "Build it",
      daemonNodeId: "node_selected",
      assignments: [{ agentId: "agent_builder", mode: "action" }],
      sessionId: "ses_existing",
      userMessageId: "evt_user",
      decision: { kind: "handoff", targetAgent: "codex", note: "Continue here" },
    });
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
    assert.equal(requestedUrl, "/api/v1/artifacts?employeeId=alice&workspacePath=%2Fworkspace%2Falice+repo");
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

    assert.equal(requestedUrl, "/api/v1/tasks/task%201/artifacts");
    assert.equal(result.taskId, "task 1");
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0].title, "deck.pptx");
    assert.equal(result.artifacts[0].sessionId, "ses_1");
  });

  it("deletes a task through the task resource", async () => {
    let requestedUrl = "";
    let requestedMethod = "";
    globalThis.fetch = (async (input, init) => {
      requestedUrl = String(input);
      requestedMethod = init?.method ?? "GET";
      return new Response(JSON.stringify({
        outcome: "deleted",
        task: {
          id: "task 1",
          title: "Retire old task",
          deletedAt: "2026-07-24T00:00:00Z",
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await deleteTask("task 1");

    assert.equal(requestedUrl, "/api/v1/tasks/task%201");
    assert.equal(requestedMethod, "DELETE");
    assert.equal(result.outcome, "deleted");
    assert.equal(result.task.deletedAt, "2026-07-24T00:00:00Z");
  });

  it("fetches a workspace brief for a specific employee", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        employeeId: "alice",
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
    assert.equal(requestedUrl, "/api/v1/workspace/brief?employeeId=alice");
  });

  it("fetches team-scoped artifacts and activity", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      const body = url.includes("/api/v1/teams/")
        ? { teamId: "team delivery", artifacts: [] }
        : {
            employeeId: "alice",
            teamId: "team delivery",
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
            generatedAt: "2026-07-23T00:00:00Z",
          };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    assert.deepEqual(await getTeamArtifacts("team delivery"), { teamId: "team delivery", artifacts: [] });
    assert.equal((await getWorkspaceBrief({ teamId: "team delivery" })).teamId, "team delivery");
    assert.deepEqual(requestedUrls, [
      "/api/v1/teams/team%20delivery/artifacts",
      "/api/v1/workspace/brief?teamId=team+delivery",
    ]);
  });

  it("lists agent workspace files", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        agentId: "agent_1",
        source: "live",
        path: "src/ui",
        exists: true,
        entries: [],
        generatedAt: "2026-06-27T00:00:00Z",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await listAgentWorkspaceFiles({ agentId: "agent_1", path: "src/ui" });

    assert.equal(result.agentId, "agent_1");
    assert.equal(requestedUrl, "/api/v1/agents/agent_1/workspace/files?path=src%2Fui");
  });

  it("reads a workspace file's content for the preview pane", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        agentId: "agent_1",
        source: "live",
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

    const result = await readAgentWorkspaceFile({ agentId: "agent_1", path: "src/app.tsx" });

    assert.equal(result.content, "hello world\n");
    assert.equal(result.isBinary, false);
    assert.equal(requestedUrl, "/api/v1/agents/agent_1/workspace/file?path=src%2Fapp.tsx");
  });
});
