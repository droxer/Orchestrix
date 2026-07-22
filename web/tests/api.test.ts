import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { apiJson, getTeamArtifacts, getWorkspaceBrief, listAgentWorkspaceFiles, listArtifacts, listEmployeeAgents, listTaskArtifacts, readAgentWorkspaceFile, RelayApiError, runLogicalAgents, updateOwnEmployeeAgent } from "../src/api.js";

const originalFetch = globalThis.fetch;

describe("apiJson", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reports an HTML fallback response instead of attempting to parse it as JSON", async () => {
    globalThis.fetch = (async () => new Response("<!DOCTYPE html><html><body>Relay</body></html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    })) as typeof fetch;

    await assert.rejects(
      () => apiJson("/agents/agent_1/workspace/files"),
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

  it("lists employee-owned logical agents", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ agents: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    assert.deepEqual(await listEmployeeAgents(), { agents: [] });
    assert.equal(requestedUrl, "/agents");
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

    assert.equal(requestUrl, "/agents/agent_research");
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
      assignments: [{ agentId: "agent_builder", mode: "action" }],
      sessionId: "ses_existing",
      userMessageId: "evt_user",
      decision: { kind: "handoff", targetAgent: "codex", note: "Continue here" },
    });

    assert.equal(requestUrl, "/agent-runs");
    assert.deepEqual(requestBody, {
      taskGoal: "Build it",
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

  it("fetches team-scoped artifacts and activity", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      const body = url.includes("/artifacts")
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
      "/teams/team%20delivery/artifacts",
      "/workspace/brief?teamId=team+delivery",
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
    assert.equal(requestedUrl, "/agents/agent_1/workspace/files?path=src%2Fui");
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
    assert.equal(requestedUrl, "/agents/agent_1/workspace/file?path=src%2Fapp.tsx");
  });
});
