import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  ManagedNodeReconciler,
  provisioningRetryDelayMs,
  workspaceIdForManagedNode,
} from "../src/managed-reconcile.js";
import { LocalProcessProvider, managedDaemonEnv } from "../src/providers.js";
import type { ControlPanelDaemonNodeRecord } from "relay-core";
import type {
  EnsureManagedNodeInput,
  ManagedNodeBackend,
  ManagedNodeProvider,
  ManagedNodeRecord,
  ProviderInstance,
  ProvisioningAttemptRecord,
} from "../src/types.js";

function managedNode(): ManagedNodeRecord {
  return {
    id: "mnode_alice",
    displayName: "Alice",
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
  };
}

class FakeManagedBackend implements ManagedNodeBackend {
  readonly updates: Array<Record<string, unknown>> = [];
  readonly managedUpdates: Array<Record<string, unknown>> = [];
  retiredRuntimes = 0;
  runtimeRetirementError?: Error & { status?: number };
  constructor(
    readonly nodes: ManagedNodeRecord[],
    readonly daemonNodes: ControlPanelDaemonNodeRecord[] = [],
    readonly attempts: ProvisioningAttemptRecord[] = [],
  ) {}
  async listManagedNodes(): Promise<ManagedNodeRecord[]> { return this.nodes; }
  async listDaemonNodes(): Promise<ControlPanelDaemonNodeRecord[]> { return this.daemonNodes; }
  async listProvisioningAttempts(): Promise<ProvisioningAttemptRecord[]> { return this.attempts; }
  async updateManagedNode(nodeId: string, patch: Record<string, unknown>): Promise<ManagedNodeRecord> {
    const current = this.nodes.find((node) => node.id === nodeId);
    if (!current) throw new Error("missing node");
    this.managedUpdates.push(patch);
    Object.assign(current, patch);
    return current;
  }
  async retireManagedNodeRuntime(): Promise<void> {
    this.retiredRuntimes += 1;
    if (this.runtimeRetirementError) throw this.runtimeRetirementError;
  }
  async createProvisioningAttempt(nodeId: string): Promise<{ attempt: ProvisioningAttemptRecord; enrollmentCredential: string }> {
    return {
      attempt: {
        id: "attempt_1",
        managedNodeId: nodeId,
        generation: 1,
        attemptNumber: 1,
        status: "pending",
        startedAt: "2026-07-10T00:00:00Z",
        updatedAt: "2026-07-10T00:00:00Z",
      },
      enrollmentCredential: "grant.secret",
    };
  }
  async updateProvisioningAttempt(_nodeId: string, _attemptId: string, patch: Record<string, unknown>): Promise<ProvisioningAttemptRecord> {
    this.updates.push(patch);
    return { ...(await this.createProvisioningAttempt("mnode_alice")).attempt, ...patch } as ProvisioningAttemptRecord;
  }
}

class FakeProvider implements ManagedNodeProvider {
  readonly name = "local-process";
  readonly calls: EnsureManagedNodeInput[] = [];
  stopCalls = 0;
  status: "running" | "stopped" | "unknown" = "running";
  ensureError?: Error;
  async ensure(input: EnsureManagedNodeInput): Promise<ProviderInstance> {
    this.calls.push(input);
    if (this.ensureError) throw this.ensureError;
    return { id: `${input.node.id}:${input.node.generation}` };
  }
  async inspect(): Promise<"running" | "stopped" | "unknown"> { return this.status; }
  async stop(): Promise<void> { this.stopCalls += 1; this.status = "stopped"; }
  async delete(): Promise<void> { this.status = "stopped"; }
}

test("supervisor shutdown detaches without stopping managed computers", async () => {
  const backend = new FakeManagedBackend([managedNode()]);
  const provider = new FakeProvider();
  const reconciler = new ManagedNodeReconciler({
    backend,
    providers: [provider],
    backendUrl: "http://backend.test",
    workspacePathForNode: () => "/workspaces/alice",
  });

  assert.equal((await reconciler.reconcileOnce()).started, 1);
  await reconciler.stop();

  assert.equal(provider.stopCalls, 0);
  assert.equal(provider.status, "running");
});

test("recent heartbeat loss does not replace a healthy provider instance", async () => {
  const node = { ...managedNode(), phase: "ready" as const, activeDaemonNodeId: "node_alice" };
  const daemon = {
    id: "node_alice",
    managedNodeId: node.id,
    status: "ready",
    agents: { claude: "ready", pi: "ready", codex: "ready", kimi: "ready" },
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    lastSeenAgeMs: 20_000,
    queuedCommandCount: 0,
    activeRuns: [],
    online: false,
    stale: true,
  } satisfies ControlPanelDaemonNodeRecord;
  const attempt = {
    id: "attempt_1",
    managedNodeId: node.id,
    generation: node.generation,
    attemptNumber: 1,
    status: "succeeded",
    providerInstanceId: "mnode_alice:1",
    startedAt: node.createdAt,
    updatedAt: node.updatedAt,
  } satisfies ProvisioningAttemptRecord;
  const backend = new FakeManagedBackend([node], [daemon], [attempt]);
  const provider = new FakeProvider();
  const reconciler = new ManagedNodeReconciler({
    backend,
    providers: [provider],
    backendUrl: "http://backend.test",
    workspacePathForNode: () => "/workspaces/alice",
  });

  assert.deepEqual(await reconciler.reconcileOnce(), {
    nodes: 1,
    started: 0,
    skipped: 1,
    failed: 0,
  });
  assert.equal(provider.stopCalls, 0);
  assert.equal(backend.retiredRuntimes, 0);
  assert.equal(provider.calls.length, 0);
});

test("managed reconciler records an unavailable provider as failed", async () => {
  const node = { ...managedNode(), provider: "missing-provider" };
  const backend = new FakeManagedBackend([node]);
  const reconciler = new ManagedNodeReconciler({
    backend,
    providers: [],
    backendUrl: "http://backend.test",
    workspacePathForNode: () => "/workspaces/alice",
  });

  assert.equal((await reconciler.reconcileOnce()).failed, 1);
  assert.equal((await reconciler.reconcileOnce()).failed, 1);
  assert.equal(node.phase, "failed");
  assert.match(String(node.conditions.at(-1)?.message), /missing-provider/);
  assert.equal(backend.managedUpdates.length, 1);
});

test("local process provider reports spawn failures without an unhandled error event", async () => {
  const provider = new LocalProcessProvider({
    command: "relay-daemon-command-that-does-not-exist",
  });
  const node = managedNode();
  const attempt = (await new FakeManagedBackend([]).createProvisioningAttempt(node.id)).attempt;

  await assert.rejects(provider.ensure({
    node,
    attempt,
    backendUrl: "http://backend.test",
    enrollmentCredential: "grant.secret",
    workspacePath: "/tmp/relay-supervisor-missing-command",
    workspaceId: "employee:alice:home",
  }), /ENOENT/);
});

test("local process provider is idempotent for a managed node generation", async () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), "relay-provider-state-"));
  const provider = new LocalProcessProvider({
    command: join(process.cwd(), "packages/relay-supervisor/tests/fixtures/long-running-daemon.sh"),
    async readProcessStart() { return "Tue Jul 21 12:00:00 2026"; },
    stateDirectory,
  });
  const node = managedNode();
  const attempt = (await new FakeManagedBackend([]).createProvisioningAttempt(node.id)).attempt;
  const input = {
    node,
    attempt,
    backendUrl: "http://backend.test",
    enrollmentCredential: "grant.secret",
    workspacePath: "/tmp",
    workspaceId: "employee:alice:home",
  };

  const first = await provider.ensure(input);
  const second = await provider.ensure(input);
  try {
    assert.equal(second.id, first.id);
    const restarted = new LocalProcessProvider({
      command: "must-not-spawn",
      stateDirectory,
      async readProcessCommand() { return "relay-daemon --workspace-id employee:alice:home"; },
      async readProcessStart() { return "Tue Jul 21 12:00:00 2026"; },
    });
    assert.equal((await restarted.ensure(input)).id, first.id);
  } finally {
    await Promise.allSettled([provider.stop(first.id), provider.stop(second.id)]);
  }
});

test("managed reconciler creates an attempt and starts the declared provider", async () => {
  const backend = new FakeManagedBackend([managedNode()]);
  const provider = new FakeProvider();
  const reconciler = new ManagedNodeReconciler({
    backend,
    providers: [provider],
    backendUrl: "http://backend.test",
    workspacePathForNode: () => "/workspaces/alice",
  });

  const result = await reconciler.reconcileOnce();

  assert.deepEqual(result, { nodes: 1, started: 1, skipped: 0, failed: 0 });
  assert.equal(provider.calls[0].enrollmentCredential, "grant.secret");
  assert.equal(provider.calls[0].workspaceId, "employee:alice:home");
  assert.deepEqual(backend.updates, [
    { status: "allocating" },
    { status: "registering", providerInstanceId: "mnode_alice:1" },
  ]);
});

test("managed workspace identity is explicit when configured and node-affine otherwise", () => {
  assert.equal(
    workspaceIdForManagedNode({ ...managedNode(), workspacePolicy: { kind: "shared-path", workspaceId: "repo:relay" } }),
    "repo:relay",
  );
  assert.equal(
    workspaceIdForManagedNode({ ...managedNode(), employeeId: undefined, workspacePolicy: { kind: "node-affine" } }),
    "managed-node:mnode_alice",
  );
});

test("managed reconciler does not provision ready or stopped nodes", async () => {
  const ready = { ...managedNode(), phase: "ready" as const, activeDaemonNodeId: "node_alice" };
  const stopped = { ...managedNode(), id: "mnode_stopped", desiredState: "stopped" as const, phase: "stopped" as const };
  const backend = new FakeManagedBackend([ready, stopped], [{
    id: "node_alice",
    managedNodeId: ready.id,
    status: "ready",
    agents: { claude: "unknown", pi: "unknown", codex: "ready", kimi: "unknown" },
    createdAt: ready.createdAt,
    updatedAt: ready.updatedAt,
    queuedCommandCount: 0,
    activeRuns: [],
    online: true,
    stale: false,
  }]);
  const provider = new FakeProvider();
  const reconciler = new ManagedNodeReconciler({
    backend,
    providers: [provider],
    backendUrl: "http://backend.test",
    workspacePathForNode: () => "/tmp",
  });

  assert.deepEqual(await reconciler.reconcileOnce(), { nodes: 2, started: 0, skipped: 2, failed: 0 });
  assert.equal(provider.calls.length, 0);
});

test("managed reconciler reprovisions a ready node whose daemon is offline", async () => {
  const ready = { ...managedNode(), phase: "ready" as const, activeDaemonNodeId: "node_alice" };
  const backend = new FakeManagedBackend([ready], [{
    id: "node_alice",
    managedNodeId: ready.id,
    status: "ready",
    agents: { claude: "unknown", pi: "unknown", codex: "ready", kimi: "unknown" },
    createdAt: ready.createdAt,
    updatedAt: ready.updatedAt,
    queuedCommandCount: 0,
    activeRuns: [],
    online: false,
    stale: true,
  }]);
  const provider = new FakeProvider();
  const reconciler = new ManagedNodeReconciler({
    backend,
    providers: [provider],
    backendUrl: "http://backend.test",
    workspacePathForNode: () => "/workspaces/alice",
  });

  assert.equal((await reconciler.reconcileOnce()).started, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(backend.retiredRuntimes, 1);
});

test("managed reconciler keeps an online busy daemon running", async () => {
  const ready = { ...managedNode(), phase: "ready" as const, activeDaemonNodeId: "node_alice" };
  const backend = new FakeManagedBackend([ready], [{
    id: "node_alice",
    managedNodeId: ready.id,
    status: "busy",
    agents: { claude: "unknown", pi: "unknown", codex: "ready", kimi: "unknown" },
    createdAt: ready.createdAt,
    updatedAt: ready.updatedAt,
    queuedCommandCount: 0,
    activeRuns: [],
    online: true,
    stale: false,
  }]);
  const provider = new FakeProvider();
  const reconciler = new ManagedNodeReconciler({
    backend,
    providers: [provider],
    backendUrl: "http://backend.test",
    workspacePathForNode: () => "/workspaces/alice",
  });

  assert.deepEqual(await reconciler.reconcileOnce(), { nodes: 1, started: 0, skipped: 1, failed: 0 });
  assert.equal(provider.calls.length, 0);
});

test("managed reconciler retries blocked runtime retirement without failing the cycle", async () => {
  const ready = { ...managedNode(), phase: "ready" as const, activeDaemonNodeId: "node_alice" };
  const attempt = {
    ...(await new FakeManagedBackend([]).createProvisioningAttempt(ready.id)).attempt,
    status: "succeeded" as const,
    providerInstanceId: "mnode_alice:1",
  };
  const backend = new FakeManagedBackend([ready], [{
    id: "node_alice",
    managedNodeId: ready.id,
    status: "busy",
    agents: { claude: "unknown", pi: "unknown", codex: "ready", kimi: "unknown" },
    createdAt: ready.createdAt,
    updatedAt: ready.updatedAt,
    queuedCommandCount: 0,
    activeRuns: [],
    online: false,
    stale: true,
  }], [attempt]);
  backend.runtimeRetirementError = Object.assign(
    new Error("Daemon node has active agent work."),
    { status: 409 },
  );
  const provider = new FakeProvider();
  const reconciler = new ManagedNodeReconciler({
    backend,
    providers: [provider],
    backendUrl: "http://backend.test",
    workspacePathForNode: () => "/workspaces/alice",
  });

  assert.deepEqual(await reconciler.reconcileOnce(), {
    nodes: 1,
    started: 0,
    skipped: 1,
    failed: 0,
  });
  assert.equal(ready.phase, "ready");
  assert.equal(backend.retiredRuntimes, 1);
  assert.equal(provider.stopCalls, 0);
  assert.equal(provider.status, "running");
});

test("stopping a managed computer waits for runtime drain before provider stop", async () => {
  const stopped = {
    ...managedNode(),
    desiredState: "stopped" as const,
    phase: "draining" as const,
    activeDaemonNodeId: "node_alice",
  };
  const attempt = {
    ...(await new FakeManagedBackend([]).createProvisioningAttempt(stopped.id)).attempt,
    status: "succeeded" as const,
    providerInstanceId: "mnode_alice:1",
  };
  const backend = new FakeManagedBackend([stopped], [], [attempt]);
  backend.runtimeRetirementError = Object.assign(
    new Error("Daemon node has active agent work."),
    { status: 409 },
  );
  const provider = new FakeProvider();
  const reconciler = new ManagedNodeReconciler({
    backend,
    providers: [provider],
    backendUrl: "http://backend.test",
    workspacePathForNode: () => "/workspaces/alice",
  });

  assert.deepEqual(await reconciler.reconcileOnce(), {
    nodes: 1,
    started: 0,
    skipped: 1,
    failed: 0,
  });
  assert.equal(provider.stopCalls, 0);
  assert.equal(provider.status, "running");
});

test("managed reconciler finalizes deleted provider cleanup once", async () => {
  const deleted = { ...managedNode(), desiredState: "deleted" as const, phase: "deleting" as const };
  const attempt = {
    ...(await new FakeManagedBackend([]).createProvisioningAttempt(deleted.id)).attempt,
    providerInstanceId: "local-process:4242:ZW1wbG95ZWU6YWxpY2U6aG9tZQ:U3VuIEp1bCAxOSAxMjowMDowMCAyMDI2",
  };
  const backend = new FakeManagedBackend([deleted], [], [attempt]);
  const provider = new FakeProvider();
  let deletes = 0;
  provider.delete = async () => {
    deletes += 1;
    provider.status = "stopped";
  };
  const reconciler = new ManagedNodeReconciler({
    backend,
    providers: [provider],
    backendUrl: "http://backend.test",
    workspacePathForNode: () => "/workspaces/alice",
  });

  await reconciler.reconcileOnce();
  await reconciler.reconcileOnce();

  assert.equal(deletes, 1);
  assert.equal(deleted.phase, "deleted");
});

test("managed reconciler keeps deletion non-terminal while the provider is still running", async () => {
  const deleted = { ...managedNode(), desiredState: "deleted" as const, phase: "deleting" as const };
  const attempt = {
    ...(await new FakeManagedBackend([]).createProvisioningAttempt(deleted.id)).attempt,
    providerInstanceId: "instance-running",
  };
  const backend = new FakeManagedBackend([deleted], [], [attempt]);
  const provider = new FakeProvider();
  provider.delete = async () => {};
  const reconciler = new ManagedNodeReconciler({
    backend,
    providers: [provider],
    backendUrl: "http://backend.test",
    workspacePathForNode: () => "/workspaces/alice",
  });

  await reconciler.reconcileOnce();

  assert.equal(deleted.phase, "deleting");
});

test("local process provider can inspect and stop a persisted pid after restart", async () => {
  const signals: Array<[number, NodeJS.Signals]> = [];
  let running = true;
  const provider = new LocalProcessProvider({
    async readProcessCommand() {
      return running
        ? "node relay-daemon --workspace-id employee:alice:home --sandbox boxlite"
        : undefined;
    },
    signalProcess(pid, signal) {
      signals.push([pid, signal]);
      running = false;
    },
    async readProcessStart() { return "Sun Jul 19 12:00:00 2026"; },
    stopTimeoutMs: 0,
  });

  const instanceId = "local-process:4242:ZW1wbG95ZWU6YWxpY2U6aG9tZQ:U3VuIEp1bCAxOSAxMjowMDowMCAyMDI2";
  assert.equal(await provider.inspect(instanceId), "running");
  await provider.stop(instanceId);
  assert.deepEqual(signals, [[4242, "SIGTERM"]]);
});

test("local process provider refuses to signal a reused pid", async () => {
  const signals: Array<[number, NodeJS.Signals]> = [];
  const provider = new LocalProcessProvider({
    async readProcessCommand() { return "/usr/bin/python unrelated.py"; },
    async readProcessStart() { return "Sun Jul 19 12:01:00 2026"; },
    signalProcess(pid, signal) { signals.push([pid, signal]); },
  });
  const instanceId = "local-process:4242:ZW1wbG95ZWU6YWxpY2U6aG9tZQ:U3VuIEp1bCAxOSAxMjowMDowMCAyMDI2";

  assert.equal(await provider.inspect(instanceId), "unknown");
  await provider.stop(instanceId);
  assert.deepEqual(signals, []);
});

test("local process provider refuses a matching workspace when the process start identity changed", async () => {
  const signals: Array<[number, NodeJS.Signals]> = [];
  const provider = new LocalProcessProvider({
    async readProcessCommand() {
      return "node relay-daemon --workspace-id employee:alice:home --sandbox boxlite";
    },
    async readProcessStart() { return "Sun Jul 19 12:01:00 2026"; },
    signalProcess(pid, signal) { signals.push([pid, signal]); },
  });
  const instanceId = "local-process:4242:ZW1wbG95ZWU6YWxpY2U6aG9tZQ:U3VuIEp1bCAxOSAxMjowMDowMCAyMDI2";

  assert.equal(await provider.inspect(instanceId), "unknown");
  await provider.stop(instanceId);
  assert.deepEqual(signals, []);
});

test("managed reconciler retries after a tracked provider process exits", async () => {
  const node = managedNode();
  const backend = new FakeManagedBackend([node]);
  const provider = new FakeProvider();
  const reconciler = new ManagedNodeReconciler({
    backend,
    providers: [provider],
    backendUrl: "http://backend.test",
    workspacePathForNode: () => "/workspaces/alice",
  });

  assert.equal((await reconciler.reconcileOnce()).started, 1);
  provider.status = "stopped";
  node.activeAttemptId = undefined;
  node.phase = "registering";

  assert.equal((await reconciler.reconcileOnce()).started, 1);
  assert.equal(provider.calls.length, 2);
});

test("managed daemon env drops ambient identity that would bypass enrollment", () => {
  const previous = {
    RELAY_SANDBOX_ID: process.env.RELAY_SANDBOX_ID,
    RELAY_DAEMON_TOKEN: process.env.RELAY_DAEMON_TOKEN,
    RELAY_EMPLOYEE_ID: process.env.RELAY_EMPLOYEE_ID,
  };
  process.env.RELAY_SANDBOX_ID = "sbx_stale";
  process.env.RELAY_DAEMON_TOKEN = "stale_token";
  process.env.RELAY_EMPLOYEE_ID = "stale_employee";
  try {
    const env = managedDaemonEnv({
      node: managedNode(),
      attempt: {
        id: "attempt_1",
        managedNodeId: "mnode_alice",
        generation: 1,
        attemptNumber: 1,
        status: "pending",
        startedAt: "2026-07-10T00:00:00Z",
        updatedAt: "2026-07-10T00:00:00Z",
      },
      backendUrl: "http://127.0.0.1:8790",
      enrollmentCredential: "grant.secret",
      workspacePath: "/tmp/ws",
      workspaceId: "employee:alice:home",
    });

    assert.equal(env.RELAY_SANDBOX_ID, undefined);
    assert.equal(env.RELAY_DAEMON_TOKEN, undefined);
    assert.equal(env.RELAY_DAEMON_NODE_TOKEN, undefined);
    assert.equal(env.RELAY_EMPLOYEE_ID, undefined);
    assert.equal(env.RELAY_ENROLLMENT_TOKEN, "grant.secret");
    assert.equal(env.RELAY_WORKSPACE_ID, "employee:alice:home");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("provisioning retry delay grows exponentially and is capped", () => {
  assert.equal(provisioningRetryDelayMs(1, 1_000, 60_000), 1_000);
  assert.equal(provisioningRetryDelayMs(2, 1_000, 60_000), 2_000);
  assert.equal(provisioningRetryDelayMs(4, 1_000, 60_000), 8_000);
  assert.equal(provisioningRetryDelayMs(50, 1_000, 60_000), 60_000);
});

test("a failed provider ensure backs off instead of retrying every pass", async () => {
  const node = managedNode();
  const backend = new FakeManagedBackend([node]);
  const provider = new FakeProvider();
  provider.ensureError = new Error("provider is down");
  let clock = Date.parse("2026-07-10T00:00:00Z");
  const reconciler = new ManagedNodeReconciler({
    backend,
    providers: [provider],
    backendUrl: "http://127.0.0.1:8790",
    workspacePathForNode: () => "/tmp/ws",
    retryBaseMs: 10_000,
    retryMaxMs: 60_000,
    now: () => clock,
  });

  const first = await reconciler.reconcileOnce();
  assert.equal(first.failed, 1);
  const failure = backend.updates.at(-1);
  assert.equal(failure?.status, "failed");
  assert.equal(failure?.retryAt, new Date(clock + 10_000).toISOString());

  backend.attempts.push({
    id: "attempt_1",
    managedNodeId: node.id,
    generation: 1,
    attemptNumber: 1,
    status: "failed",
    retryAt: String(failure?.retryAt),
    startedAt: "2026-07-10T00:00:00Z",
    updatedAt: "2026-07-10T00:00:00Z",
  });
  node.activeAttemptId = undefined;

  clock += 5_000;
  const backedOff = await reconciler.reconcileOnce();
  assert.equal(backedOff.failed, 0);
  assert.equal(backedOff.skipped, 1);
  assert.equal(provider.calls.length, 1);

  clock += 10_000;
  const resumed = await reconciler.reconcileOnce();
  assert.equal(resumed.failed, 1);
  assert.equal(provider.calls.length, 2);
});
