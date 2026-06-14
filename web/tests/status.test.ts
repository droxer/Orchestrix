import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assignControlPanelDaemonNode, createControlPanelEmployee } from "../src/api.js";
import { conversationDaemonStatus } from "../src/lib/conversationStatus.js";
import {
  mergeVisibleDaemonNodes,
  shouldClaimLocalDaemonNode,
} from "../src/lib/daemonNodes.js";
import type {
  ControlPanelDaemonNodeRecord,
  DaemonNodeMonitorRecord,
} from "../src/types.js";

function daemonNode(input: Partial<DaemonNodeMonitorRecord> & { id: string; employeeId?: string }): DaemonNodeMonitorRecord {
  return {
    status: "ready",
    agents: { claude: "ready", pi: "ready", codex: "ready", kimi: "unknown" },
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
    queuedCommandCount: 0,
    activeRuns: [],
    online: true,
    stale: false,
    ...input,
  };
}

function controlPanelNode(
  input: Partial<ControlPanelDaemonNodeRecord> & { id: string; employeeId?: string },
): ControlPanelDaemonNodeRecord {
  return {
    ...daemonNode(input),
    nodeToken: "node_token",
    ...input,
  };
}

describe("Relay web conversation status", () => {
  it("shows an active daemon run as running even when the heartbeat is stale", () => {
    const activeRun = {
      commandId: "cmd_1",
      sessionId: "ses_1",
      runId: "run_1",
      agent: "codex",
      mode: "review",
      taskGoal: "review daemon status",
      startedAt: "2026-06-12T00:00:00.000Z",
    } as const;

    assert.equal(conversationDaemonStatus({
      node: {
        id: "sbx_alice",
        employeeId: "alice",
        status: "ready",
        agents: { claude: "ready", pi: "ready", codex: "ready", kimi: "unknown" },
        createdAt: "2026-06-12T00:00:00.000Z",
        updatedAt: "2026-06-12T00:00:00.000Z",
        queuedCommandCount: 0,
        activeRuns: [activeRun],
        online: false,
        stale: true,
      },
      sandbox: { status: "provisioning" },
    }), "running");
  });

  it("falls back to stale only when no daemon run is active", () => {
    assert.equal(conversationDaemonStatus({
      node: {
        id: "sbx_alice",
        employeeId: "alice",
        status: "ready",
        agents: { claude: "ready", pi: "ready", codex: "ready", kimi: "unknown" },
        createdAt: "2026-06-12T00:00:00.000Z",
        updatedAt: "2026-06-12T00:00:00.000Z",
        queuedCommandCount: 0,
        activeRuns: [],
        online: false,
        stale: true,
      },
      sandbox: { status: "ready" },
    }), "stale");
  });

  it("prefers a live local control-panel node over a stale authenticated node", () => {
    const staleAuthenticatedNode = daemonNode({
      id: "sbx_alice_old",
      employeeId: "alice",
      online: false,
      stale: true,
      lastSeenAt: "2026-06-12T00:00:00.000Z",
    });
    const liveControlPanelNode = controlPanelNode({
      id: "sbx_alice_live",
      employeeId: "alice",
      online: true,
      stale: false,
      lastSeenAt: "2026-06-12T00:00:03.000Z",
    });

    const [visibleNode] = mergeVisibleDaemonNodes([staleAuthenticatedNode], [liveControlPanelNode]);

    assert.equal(visibleNode.id, "sbx_alice_live");
    assert.equal(visibleNode.online, true);
    assert.equal(conversationDaemonStatus({ node: visibleNode }), "ready");
    assert.equal("nodeToken" in visibleNode, false);
  });

  it("claims an online local node when the saved token only exposes stale nodes", () => {
    const staleAuthenticatedNode = daemonNode({
      id: "sbx_alice_old",
      employeeId: "alice",
      online: false,
      stale: true,
    });
    const liveControlPanelNode = controlPanelNode({
      id: "sbx_alice_live",
      employeeId: "alice",
      online: true,
      stale: false,
    });

    assert.equal(shouldClaimLocalDaemonNode(liveControlPanelNode, [staleAuthenticatedNode]), true);
    assert.equal(shouldClaimLocalDaemonNode(liveControlPanelNode, [daemonNode({
      id: "sbx_alice_live",
      employeeId: "alice",
      online: true,
      stale: false,
    })]), false);
  });

  it("keeps unassigned control-panel nodes out of the chat roster", () => {
    const assignedNode = controlPanelNode({
      id: "sbx_alice",
      employeeId: "alice",
      online: true,
      stale: false,
    });
    const unassignedNode = controlPanelNode({
      id: "sbx_unassigned",
      online: true,
      stale: false,
    });

    const visibleNodes = mergeVisibleDaemonNodes([], [assignedNode, unassignedNode]);

    assert.deepEqual(visibleNodes.map((node) => node.id), ["sbx_alice"]);
    assert.equal(shouldClaimLocalDaemonNode(unassignedNode, []), false);
  });

  it("posts employee creation with the selected unassigned node", async () => {
    const originalFetch = globalThis.fetch;
    let requestPath = "";
    let requestInit: RequestInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestPath = String(input);
      requestInit = init;
      return new Response(JSON.stringify({
        employee: {
          id: "alice",
          displayName: "Alice",
          email: "alice@example.com",
        },
        user: {
          id: "usr_alice",
          username: "alice",
          role: "user",
          employeeId: "alice",
        },
        node: controlPanelNode({
          id: "sbx_unassigned",
          employeeId: "alice",
        }),
      }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const result = await createControlPanelEmployee({
        employeeId: "alice",
        username: "alice",
        password: "userpass",
        nodeId: "sbx_unassigned",
        email: "alice@example.com",
        displayName: "Alice",
      });

      assert.equal(requestPath, "/cp/employees");
      assert.equal(requestInit?.method, "POST");
      assert.deepEqual(JSON.parse(String(requestInit?.body)), {
        employeeId: "alice",
        username: "alice",
        password: "userpass",
        nodeId: "sbx_unassigned",
        email: "alice@example.com",
        displayName: "Alice",
      });
      assert.equal(result.node.employeeId, "alice");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("posts direct node assignment for an existing employee", async () => {
    const originalFetch = globalThis.fetch;
    let requestPath = "";
    let requestInit: RequestInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestPath = String(input);
      requestInit = init;
      return new Response(JSON.stringify({
        employee: {
          id: "alice",
          displayName: "Alice",
        },
        node: controlPanelNode({
          id: "node_unassigned",
          employeeId: "alice",
        }),
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const result = await assignControlPanelDaemonNode({
        employeeId: "alice",
        nodeId: "node_unassigned",
      });

      assert.equal(requestPath, "/cp/daemon-nodes/node_unassigned/assign");
      assert.equal(requestInit?.method, "POST");
      assert.deepEqual(JSON.parse(String(requestInit?.body)), {
        employeeId: "alice",
      });
      assert.equal(result.node.employeeId, "alice");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
