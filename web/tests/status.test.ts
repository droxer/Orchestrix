import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assignControlPanelDaemonNode, createControlPanelDaemonNode, createControlPanelEmployee, createManagedNode, deleteManagedNode, listManagedNodes, permanentlyDeleteManagedNode } from "../src/api.js";
import { threadDaemonStatus } from "../src/lib/threadStatus.js";
import {
  mergeVisibleDaemonNodes,
  mergeThreadRuntimeNodes,
  shouldClaimLocalDaemonNode,
} from "../src/lib/daemonNodes.js";
import {
  buildDaemonStartCommand,
  nodeOwnershipProfile,
  nodeSandboxProfile,
  nodeLocalityFlags,
  nodeLocalityKinds,
  resolveNodeCredentials,
  upsertStoredCredentialsFromNodes,
} from "../src/lib/adminHelpers.js";
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

describe("Relay web thread status", () => {
  it("shows a stale node as stale even when a daemon run is active", () => {
    const activeRun = {
      commandId: "cmd_1",
      sessionId: "ses_1",
      runId: "run_1",
      agent: "codex",
      mode: "review",
      taskGoal: "review daemon status",
      startedAt: "2026-06-12T00:00:00.000Z",
    } as const;

    assert.equal(threadDaemonStatus({
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
    }), "stale");
  });

  it("falls back to stale only when no daemon run is active", () => {
    assert.equal(threadDaemonStatus({
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
      agentDetails: { kimi: { detail: "Kimi is not logged in.", adapter: "cli" } },
    });

    const [visibleNode] = mergeVisibleDaemonNodes([staleAuthenticatedNode], [liveControlPanelNode]);

    assert.equal(visibleNode.id, "sbx_alice_live");
    assert.equal(visibleNode.online, true);
    assert.equal(visibleNode.agentDetails?.kimi?.detail, "Kimi is not logged in.");
    assert.equal(threadDaemonStatus({ node: visibleNode }), "ready");
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

  it("keeps distinct computers for one employee in the thread runtime picker", () => {
    const first = daemonNode({ id: "node_a", employeeId: "alice" });
    const second = controlPanelNode({ id: "node_b", employeeId: "alice" });

    const runtimeNodes = mergeThreadRuntimeNodes([first], [second]);

    assert.deepEqual(runtimeNodes.map((node) => node.id), ["node_a", "node_b"]);
    assert.equal(runtimeNodes.every((node) => !("nodeToken" in node)), true);
  });

  it("keeps the computer's display name when the authenticated record wins the merge", () => {
    const lastSeenAt = "2026-06-12T00:00:03.000Z";
    const authenticated = daemonNode({ id: "sbx_alice", employeeId: "alice", lastSeenAt });
    const controlPanel = controlPanelNode({
      id: "sbx_alice",
      employeeId: "alice",
      lastSeenAt,
      displayName: "Alice's MacBook",
    });

    const [tied] = mergeThreadRuntimeNodes([authenticated], [controlPanel]);
    assert.equal("displayName" in tied ? tied.displayName : undefined, "Alice's MacBook");

    const [fresherAuthenticated] = mergeThreadRuntimeNodes(
      [daemonNode({ id: "sbx_alice", employeeId: "alice", lastSeenAt: "2026-06-12T00:00:05.000Z" })],
      [controlPanel],
    );
    assert.equal("displayName" in fresherAuthenticated ? fresherAuthenticated.displayName : undefined, "Alice's MacBook");
    assert.equal(fresherAuthenticated.lastSeenAt, "2026-06-12T00:00:05.000Z");
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
      assert.equal(result.node?.employeeId, "alice");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("posts ownerless daemon node creation when no employee is supplied", async () => {
    const originalFetch = globalThis.fetch;
    let requestPath = "";
    let requestInit: RequestInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestPath = String(input);
      requestInit = init;
      return new Response(JSON.stringify({
        node: controlPanelNode({
          id: "sbx_node_1",
        }),
        nodeToken: "node_token",
        daemonEnv: {
          RELAY_SANDBOX_ID: "sbx_node_1",
        },
      }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const result = await createControlPanelDaemonNode({
        workspacePath: "/workspace/shared",
      });

      assert.equal(requestPath, "/cp/daemon-nodes");
      assert.equal(requestInit?.method, "POST");
      assert.deepEqual(JSON.parse(String(requestInit?.body)), {
        workspacePath: "/workspace/shared",
      });
      assert.equal(result.node.employeeId, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("posts managed-node intent without requesting daemon credentials", async () => {
    const originalFetch = globalThis.fetch;
    let requestPath = "";
    let requestInit: RequestInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestPath = String(input);
      requestInit = init;
      return new Response(JSON.stringify({
        node: {
          id: "mnode_alice",
          displayName: "Managed node for alice",
          employeeId: "alice",
          assignmentMode: "dedicated",
          provider: "local-process",
          profile: "standard",
          sandboxMode: "boxlite",
          workspacePolicy: { kind: "employee-home" },
          desiredState: "running",
          generation: 1,
          phase: "requested",
          conditions: [],
          createdAt: "2026-07-10T00:00:00Z",
          updatedAt: "2026-07-10T00:00:00Z",
        },
      }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const result = await createManagedNode({ employeeId: "alice", sandboxMode: "boxlite" });

      assert.equal(requestPath, "/cp/managed-nodes");
      assert.equal(requestInit?.method, "POST");
      assert.deepEqual(JSON.parse(String(requestInit?.body)), {
        employeeId: "alice",
        assignmentMode: "dedicated",
        provider: "local-process",
        profile: "standard",
        sandboxMode: "boxlite",
        workspacePolicy: { kind: "employee-home" },
        desiredState: "running",
      });
      assert.equal(result.node.phase, "requested");
      assert.equal("daemonCommand" in result, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("deletes managed desired state through the managed-node endpoint", async () => {
    const originalFetch = globalThis.fetch;
    let requestPath = "";
    let requestInit: RequestInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestPath = String(input);
      requestInit = init;
      return new Response(JSON.stringify({ node: { id: "mnode_alice", desiredState: "deleted" } }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      await deleteManagedNode("mnode_alice");
      assert.equal(requestPath, "/cp/managed-nodes/mnode_alice");
      assert.equal(requestInit?.method, "DELETE");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("lists managed-node history through the control-panel endpoint", async () => {
    const originalFetch = globalThis.fetch;
    let requestPath = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestPath = String(input);
      return new Response(JSON.stringify({ nodes: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const result = await listManagedNodes();
      assert.equal(requestPath, "/cp/managed-nodes");
      assert.deepEqual(result.nodes, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("permanently deletes a terminal managed-node record", async () => {
    const originalFetch = globalThis.fetch;
    let requestPath = "";
    let requestInit: RequestInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestPath = String(input);
      requestInit = init;
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    try {
      await permanentlyDeleteManagedNode("mnode_old");
      assert.equal(requestPath, "/cp/managed-nodes/mnode_old/permanent");
      assert.equal(requestInit?.method, "DELETE");
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

describe("Relay web admin node helpers", () => {
  it("builds a daemon start command from cached node metadata", () => {
    const command = buildDaemonStartCommand({
      id: "sbx_alice",
      employeeId: "alice",
      workspacePath: "/workspace/alice",
      sandboxMode: "boxlite",
    }, "tok_secret", "http://127.0.0.1:8790");

    assert.match(command, /--sandbox-id sbx_alice/);
    assert.doesNotMatch(command, /tok_secret|--token/);
    assert.match(command, /--sandbox boxlite/);
    assert.doesNotMatch(command, /--use-local-agent-home/);
    assert.match(command, /--employee-id alice/);
    assert.match(command, /--workspace /);
  });

  it("defaults missing sandbox mode to managed command reconstruction", () => {
    const command = buildDaemonStartCommand({
      id: "sbx_pending",
      employeeId: "alice",
      workspacePath: "/workspace/alice",
    }, "tok_secret", "http://127.0.0.1:8790");

    assert.match(command, /--sandbox boxlite/);
    assert.doesNotMatch(command, /--use-local-agent-home/);
  });

  it("adds local agent home only for local daemon commands", () => {
    const command = buildDaemonStartCommand({
      id: "sbx_local",
      employeeId: "alice",
      workspacePath: "/workspace/alice",
      sandboxMode: "none",
    }, "tok_secret", "http://127.0.0.1:8790");

    assert.match(command, /--sandbox none/);
    assert.match(command, /--use-local-agent-home/);
  });

  it("resolves credentials from browser cache when the server no longer reveals tokens", () => {
    const node = {
      ...controlPanelNode({
        id: "sbx_alice",
        employeeId: "alice",
        online: true,
        stale: false,
      }),
      nodeToken: undefined,
    };
    const resolved = resolveNodeCredentials(node, {
      nodeToken: "tok_cached",
      savedAt: "2026-06-12T00:00:00.000Z",
    }, "http://127.0.0.1:8790");

    assert.equal(resolved.source, "cache");
    assert.equal(resolved.nodeToken, "tok_cached");
    assert.doesNotMatch(resolved.daemonCommand ?? "", /tok_cached|--token/);
  });

  it("keeps device location separate from sandbox isolation", () => {
    const node = controlPanelNode({
      id: "sbx_alice",
      employeeId: "alice",
      online: true,
      stale: false,
      sandboxMode: "none",
      nodeLocation: "managed",
      managedNodeId: "mnode_alice",
    });
    const flags = nodeLocalityFlags(node, {
      colocated: true,
      storedTokens: {
        sbx_alice: { nodeToken: "tok_cached", savedAt: "2026-06-12T00:00:00.000Z" },
      },
    });

    assert.equal(flags.hasCachedCredentials, true);
    assert.equal(flags.isColocatedLive, false);
    assert.equal(nodeOwnershipProfile(node), "managed");
    assert.deepEqual(nodeLocalityKinds(node, {
      colocated: true,
      storedTokens: { sbx_alice: { nodeToken: "tok_cached", savedAt: "2026-06-12T00:00:00.000Z" } },
    }), ["saved_here"]);
    assert.equal(nodeOwnershipProfile({ nodeLocation: "employee-device", sandboxMode: "boxlite" }), "local");
    assert.equal(nodeOwnershipProfile({ nodeLocation: "managed", sandboxMode: "none" }), "managed");
    assert.equal(nodeOwnershipProfile({ sandboxMode: "none" }), "pending");
    assert.equal(nodeSandboxProfile({ sandboxMode: "boxlite" }), "boxlite");
    assert.equal(nodeSandboxProfile({ sandboxMode: "none" }), "host");
    assert.equal(nodeSandboxProfile({}), "pending");
  });

  it("persists ephemeral control-panel node tokens into the stored map", () => {
    const node = controlPanelNode({
      id: "sbx_alice",
      employeeId: "alice",
      nodeToken: "tok_live",
      workspacePath: "/workspace/alice",
    });
    const updated = upsertStoredCredentialsFromNodes({}, [node], "http://127.0.0.1:8790");

    assert.ok(updated);
    assert.equal(updated?.sbx_alice.nodeToken, "tok_live");
    assert.doesNotMatch(updated?.sbx_alice.daemonCommand ?? "", /tok_live|--token/);
    assert.match(updated?.sbx_alice.daemonCommand ?? "", /--sandbox boxlite/);
    assert.doesNotMatch(updated?.sbx_alice.daemonCommand ?? "", /--use-local-agent-home/);
  });
});
