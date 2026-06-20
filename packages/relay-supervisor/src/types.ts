import type { ChildProcess } from "node:child_process";
import type { ControlPanelDaemonNodeRecord } from "relay-core";

export interface EmployeeRecord {
  id: string;
  displayName?: string;
  email?: string;
  departmentId?: string;
  departmentName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SupervisorBackend {
  listEmployees(): Promise<EmployeeRecord[]>;
  listDaemonNodes(): Promise<ControlPanelDaemonNodeRecord[]>;
  provisionDaemonNode(input: { employeeId: string; workspacePath?: string }): Promise<ProvisionedDaemonNode>;
}

export interface ProvisionedDaemonNode {
  node: ControlPanelDaemonNodeRecord;
  nodeToken?: string;
  daemonEnv: Record<string, string>;
}

export interface DaemonLaunchRequest {
  employee: EmployeeRecord;
  node: ControlPanelDaemonNodeRecord;
  env: Record<string, string>;
  workspacePath: string;
}

export interface ManagedDaemon {
  readonly key: string;
  readonly provider: string;
  readonly child?: ChildProcess;
  stop(): Promise<void>;
}

export interface DaemonLauncher {
  readonly name: string;
  start(request: DaemonLaunchRequest): Promise<ManagedDaemon>;
}

export interface SupervisorLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}
