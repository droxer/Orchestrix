import type {
  ManagedNodeBackend,
  ManagedNodeProvider,
  ManagedNodeRecord,
  ProviderInstance,
  SupervisorLogger,
} from "./types.js";

export interface ManagedNodeReconcilerOptions {
  backend: ManagedNodeBackend;
  providers: ManagedNodeProvider[];
  backendUrl: string;
  workspacePathForNode: (node: ManagedNodeRecord) => string;
  logger?: SupervisorLogger;
}

export interface ManagedReconcileResult {
  nodes: number;
  started: number;
  skipped: number;
  failed: number;
}

export function workspaceIdForManagedNode(node: ManagedNodeRecord): string {
  const configured = node.workspacePolicy.workspaceId;
  if (typeof configured === "string" && configured.trim()) return configured.trim();
  if (node.workspacePolicy.kind === "employee-home" && node.employeeId) {
    return `employee:${node.employeeId}:home`;
  }
  return `managed-node:${node.id}`;
}

export class ManagedNodeReconciler {
  private readonly backend: ManagedNodeBackend;
  private readonly providers: Map<string, ManagedNodeProvider>;
  private readonly backendUrl: string;
  private readonly workspacePathForNode: (node: ManagedNodeRecord) => string;
  private readonly logger?: SupervisorLogger;
  private readonly instances = new Map<string, { provider: ManagedNodeProvider; instance: ProviderInstance }>();

  constructor(options: ManagedNodeReconcilerOptions) {
    this.backend = options.backend;
    this.providers = new Map(options.providers.map((provider) => [provider.name, provider]));
    this.backendUrl = options.backendUrl;
    this.workspacePathForNode = options.workspacePathForNode;
    this.logger = options.logger;
  }

  async reconcileOnce(): Promise<ManagedReconcileResult> {
    const nodes = await this.backend.listManagedNodes();
    let started = 0;
    let skipped = 0;
    let failed = 0;
    for (const node of nodes) {
      const provider = this.providers.get(node.provider);
      if (!provider) {
        this.logger?.error("managed node provider unavailable", { nodeId: node.id, provider: node.provider });
        failed += 1;
        continue;
      }
      if (node.desiredState !== "running") {
        const attempts = await this.backend.listProvisioningAttempts(node.id);
        const instanceId = [...attempts].reverse().find((attempt) => attempt.providerInstanceId)?.providerInstanceId;
        if (instanceId) {
          if (node.desiredState === "deleted") await provider.delete(instanceId);
          else await provider.stop(instanceId);
        }
        this.instances.delete(node.id);
        await this.backend.updateManagedNode(node.id, { phase: node.desiredState === "deleted" ? "deleting" : "stopped" });
        skipped += 1;
        continue;
      }
      if (node.phase === "ready") {
        skipped += 1;
        continue;
      }
      const tracked = this.instances.get(node.id);
      if (tracked) {
        if (await tracked.provider.inspect(tracked.instance.id) === "running") {
          skipped += 1;
          continue;
        }
        this.instances.delete(node.id);
      }
      if (node.activeAttemptId) {
        const attempts = await this.backend.listProvisioningAttempts(node.id);
        const active = attempts.find((attempt) => attempt.id === node.activeAttemptId);
        if (active?.providerInstanceId && await provider.inspect(active.providerInstanceId) === "running") {
          skipped += 1;
          continue;
        }
        if (active) {
          await this.backend.updateProvisioningAttempt(node.id, active.id, {
            status: "failed",
            errorCode: "controller_recovered_unknown_instance",
            errorMessage: "The controller could not recover the provider instance; a new attempt will be created.",
          });
        }
      }
      let created: Awaited<ReturnType<ManagedNodeBackend["createProvisioningAttempt"]>> | undefined;
      try {
        created = await this.backend.createProvisioningAttempt(node.id);
        await this.backend.updateProvisioningAttempt(node.id, created.attempt.id, { status: "allocating" });
        const instance = await provider.ensure({
          node,
          attempt: created.attempt,
          backendUrl: this.backendUrl,
          enrollmentCredential: created.enrollmentCredential,
          workspacePath: this.workspacePathForNode(node),
          workspaceId: workspaceIdForManagedNode(node),
        });
        this.instances.set(node.id, { provider, instance });
        await this.backend.updateProvisioningAttempt(node.id, created.attempt.id, {
          status: "registering",
          providerInstanceId: instance.id,
        });
        started += 1;
      } catch (error) {
        failed += 1;
        if (created) {
          await this.backend.updateProvisioningAttempt(node.id, created.attempt.id, {
            status: "failed",
            errorCode: "provider_ensure_failed",
            errorMessage: error instanceof Error ? error.message : String(error),
          }).catch(() => undefined);
        }
        this.logger?.error("managed node reconcile failed", {
          nodeId: node.id,
          provider: node.provider,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { nodes: nodes.length, started, skipped, failed };
  }

  async stop(): Promise<void> {
    const instances = [...this.instances.values()];
    this.instances.clear();
    await Promise.allSettled(instances.map(({ provider, instance }) => provider.stop(instance.id)));
  }
}
