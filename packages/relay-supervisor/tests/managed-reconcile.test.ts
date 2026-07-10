import test from "node:test";
import assert from "node:assert/strict";
import { ManagedNodeReconciler, workspaceIdForManagedNode } from "../src/managed-reconcile.js";
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
  constructor(readonly nodes: ManagedNodeRecord[]) {}
  async listManagedNodes(): Promise<ManagedNodeRecord[]> { return this.nodes; }
  async listProvisioningAttempts(): Promise<ProvisioningAttemptRecord[]> { return []; }
  async updateManagedNode(nodeId: string, patch: Record<string, unknown>): Promise<ManagedNodeRecord> {
    const current = this.nodes.find((node) => node.id === nodeId);
    if (!current) throw new Error("missing node");
    Object.assign(current, patch);
    return current;
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
  status: "running" | "stopped" | "unknown" = "running";
  async ensure(input: EnsureManagedNodeInput): Promise<ProviderInstance> {
    this.calls.push(input);
    return { id: `${input.node.id}:${input.node.generation}` };
  }
  async inspect(): Promise<"running" | "stopped" | "unknown"> { return this.status; }
  async stop(): Promise<void> {}
  async delete(): Promise<void> {}
}

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
  const ready = { ...managedNode(), phase: "ready" as const };
  const stopped = { ...managedNode(), id: "mnode_stopped", desiredState: "stopped" as const, phase: "stopped" as const };
  const backend = new FakeManagedBackend([ready, stopped]);
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
