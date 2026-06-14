import type { TFunction } from "i18next";
import type { ControlPanelDaemonNodeRecord, EmployeeRecord, Tone } from "../types.js";

export const STALE_AFTER_MS = 15_000;
export const QUIET_AFTER_MS = 10_000;
export const adminNodeTokenStorageKey = "relay-web.adminNodeTokens";

export interface StoredNodeToken {
  employeeId?: string;
  sandboxToken?: string;
  nodeToken?: string;
  daemonCommand?: string;
  savedAt: string;
}

export type StoredNodeTokenMap = Record<string, StoredNodeToken>;

export function isStale(node: ControlPanelDaemonNodeRecord): boolean {
  if (typeof node.stale === "boolean") return node.stale;
  if (!node.online) return true;
  if (!node.lastSeenAt) return true;
  return Date.now() - new Date(node.lastSeenAt).getTime() > STALE_AFTER_MS;
}

export function visualStatus(node: ControlPanelDaemonNodeRecord): string {
  return isStale(node) ? "stale" : node.status;
}

export function statusTone(status: string): Tone {
  if (status === "ready") return "good";
  if (status === "running" || status === "provisioning") return "info";
  if (status === "failed" || status === "stale") return "bad";
  if (status === "stopped") return "warn";
  return "neutral";
}

export function agentStatusTone(agentStatus: string): "good" | "bad" | "neutral" {
  if (agentStatus === "ready") return "good";
  if (agentStatus === "failed") return "bad";
  return "neutral";
}

export function formatRelativeTime(value: string | undefined, t: TFunction): string {
  if (!value) return t("admin.time.never");
  const deltaMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(deltaMs)) return t("admin.time.unknown");
  if (deltaMs < 1_000) return t("admin.time.now");

  const seconds = Math.floor(deltaMs / 1_000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const locale = typeof document !== "undefined" ? document.documentElement.lang || undefined : undefined;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (seconds < 60) return rtf.format(-seconds, "second");
  if (minutes < 60) return rtf.format(-minutes, "minute");
  return rtf.format(-hours, "hour");
}

export interface AttentionItem {
  nodeId: string;
  employeeId?: string;
  kind: "error" | "stale-run" | "quiet";
  body: string;
}

export interface EmployeeNodeSummary {
  id: string;
  displayName: string;
  email?: string;
  departmentId?: string;
  departmentName?: string;
  nodeCount: number;
  readyCount: number;
  runningCount: number;
  nodes: ControlPanelDaemonNodeRecord[];
}

export function buildAttentionItems(nodes: ControlPanelDaemonNodeRecord[], t: TFunction): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const node of nodes) {
    if (node.lastError) {
      items.push({ nodeId: node.id, employeeId: node.employeeId, kind: "error", body: node.lastError });
    }
    if (isStale(node) && node.activeRuns.length > 0) {
      const count = node.activeRuns.length;
      items.push({
        nodeId: node.id,
        employeeId: node.employeeId,
        kind: "stale-run",
        body: t("admin.stale_run_body", { count }),
      });
    }
    const ageMs = node.lastSeenAgeMs ?? (node.lastSeenAt
      ? Date.now() - new Date(node.lastSeenAt).getTime()
      : Infinity);
    if (!node.lastError && !isStale(node) && ageMs > QUIET_AFTER_MS) {
      items.push({
        nodeId: node.id,
        employeeId: node.employeeId,
        kind: "quiet",
        body: t("admin.quiet_body", { time: formatRelativeTime(node.lastSeenAt, t) }),
      });
    }
  }
  return items;
}

export function buildEmployeeSummaries(
  employees: EmployeeRecord[],
  nodes: ControlPanelDaemonNodeRecord[],
): EmployeeNodeSummary[] {
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const nodesByEmployee = new Map<string, ControlPanelDaemonNodeRecord[]>();

  for (const node of nodes) {
    if (!node.employeeId) continue;
    const current = nodesByEmployee.get(node.employeeId) ?? [];
    nodesByEmployee.set(node.employeeId, [...current, node]);
  }

  const ids = new Set<string>([
    ...employees.map((employee) => employee.id),
    ...nodes.map((node) => node.employeeId).filter((id): id is string => Boolean(id)),
  ]);
  return [...ids].sort().map((id) => {
    const employee = employeeById.get(id);
    const employeeNodes = nodesByEmployee.get(id) ?? [];
    const readyCount = employeeNodes.filter((node) => visualStatus(node) === "ready").length;
    const runningCount = employeeNodes.filter((node) => !isStale(node) && node.status === "running").length;
    return {
      id,
      displayName: employee?.displayName || id,
      email: employee?.email,
      departmentId: employee?.departmentId,
      departmentName: employee?.departmentName,
      nodeCount: employeeNodes.length,
      readyCount,
      runningCount,
      nodes: employeeNodes,
    };
  });
}

export function readStoredNodeTokens(): StoredNodeTokenMap {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(adminNodeTokenStorageKey) ?? "null") as StoredNodeTokenMap | null;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

export function writeStoredNodeToken(nodeId: string, token: StoredNodeToken): void {
  if (typeof window === "undefined") return;
  try {
    const map = readStoredNodeTokens();
    const next = { ...map, [nodeId]: token };
    window.localStorage.setItem(adminNodeTokenStorageKey, JSON.stringify(next));
  } catch {
    /* ignore quota errors */
  }
}

export async function copyText(value: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function truncateId(id: string, head = 4, tail = 4): string {
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}
