import type { ControlPanelDaemonNodeRecord } from "relay-core";
import type { EmployeeRecord, ManagedNodeBackend, ManagedNodeRecord, ProvisionedDaemonNode, ProvisioningAttemptRecord, SupervisorBackend } from "./types.js";

export interface SupervisorBackendClientOptions {
  backendUrl: string;
  adminToken?: string;
  fetchFn?: typeof fetch;
}

export class SupervisorBackendClient implements SupervisorBackend, ManagedNodeBackend {
  private readonly backendUrl: string;
  private readonly adminToken?: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: SupervisorBackendClientOptions) {
    this.backendUrl = options.backendUrl.replace(/\/+$/, "");
    this.adminToken = options.adminToken;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async listEmployees(): Promise<EmployeeRecord[]> {
    return (await this.request<{ employees: EmployeeRecord[] }>("/cp/employees")).employees;
  }

  async listDaemonNodes(): Promise<ControlPanelDaemonNodeRecord[]> {
    return (await this.request<{ nodes: ControlPanelDaemonNodeRecord[] }>("/cp/daemon-nodes")).nodes;
  }

  async provisionDaemonNode(input: { employeeId: string; workspacePath?: string }): Promise<ProvisionedDaemonNode> {
    return await this.request<ProvisionedDaemonNode>("/cp/daemon-nodes", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async listManagedNodes(): Promise<ManagedNodeRecord[]> {
    return (await this.request<{ nodes: ManagedNodeRecord[] }>("/cp/managed-nodes")).nodes;
  }

  async createProvisioningAttempt(nodeId: string): Promise<{ attempt: ProvisioningAttemptRecord; enrollmentCredential: string }> {
    return await this.request(`/cp/managed-nodes/${encodeURIComponent(nodeId)}/attempts`, { method: "POST" });
  }

  async listProvisioningAttempts(nodeId: string): Promise<ProvisioningAttemptRecord[]> {
    return (await this.request<{ attempts: ProvisioningAttemptRecord[] }>(
      `/cp/managed-nodes/${encodeURIComponent(nodeId)}/attempts`,
    )).attempts;
  }

  async updateManagedNode(nodeId: string, patch: Record<string, unknown>): Promise<ManagedNodeRecord> {
    return (await this.request<{ node: ManagedNodeRecord }>(`/cp/managed-nodes/${encodeURIComponent(nodeId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    })).node;
  }

  async updateProvisioningAttempt(nodeId: string, attemptId: string, patch: Record<string, unknown>): Promise<ProvisioningAttemptRecord> {
    return (await this.request<{ attempt: ProvisioningAttemptRecord }>(
      `/cp/managed-nodes/${encodeURIComponent(nodeId)}/attempts/${encodeURIComponent(attemptId)}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    )).attempt;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    if (this.adminToken) headers.set("authorization", `Bearer ${this.adminToken}`);
    const response = await this.fetchFn(`${this.backendUrl}${path}`, {
      ...init,
      headers,
    });
    if (!response.ok) {
      throw new Error(`${init.method ?? "GET"} ${path} failed: ${response.status} ${await response.text()}`);
    }
    return await response.json() as T;
  }
}
