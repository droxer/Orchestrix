import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { conversationDaemonStatus } from "../packages/relay-web/src/lib/conversationStatus.js";
import {
  mergeVisibleDaemonNodes,
  shouldClaimLocalDaemonNode,
} from "../packages/relay-web/src/lib/daemonNodes.js";
import type {
  ControlPanelDaemonNodeRecord,
  DaemonNodeMonitorRecord,
} from "../packages/relay-web/src/types.js";

function daemonNode(input: Partial<DaemonNodeMonitorRecord> & { id: string; employeeId: string }): DaemonNodeMonitorRecord {
  return {
    status: "ready",
    agents: { claude: "ready", pi: "ready", codex: "ready" },
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
  input: Partial<ControlPanelDaemonNodeRecord> & { id: string; employeeId: string },
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
        agents: { claude: "ready", pi: "ready", codex: "ready" },
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
        agents: { claude: "ready", pi: "ready", codex: "ready" },
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
});
