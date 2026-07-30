import type { TFunction } from "i18next";
import type { AgentName, ControlPanelDaemonNodeRecord, EmployeeAgent, EmployeeRecord, LogicalAgentAvailability, Tone } from "../types.js";

export const ADMIN_AGENTS_KEY = ["admin", "agents"] as const;

/** Stable display order for node surfaces; implemented independently of API order. */
export function stableNodeOrder(
  nodes: readonly ControlPanelDaemonNodeRecord[],
): ControlPanelDaemonNodeRecord[] {
  const label = (node: ControlPanelDaemonNodeRecord) => node.displayName?.trim() || node.id;
  return [...nodes].sort((left, right) => (
    label(left).localeCompare(label(right), undefined, { sensitivity: "base", numeric: true })
    || left.id.localeCompare(right.id, undefined, { sensitivity: "base", numeric: true })
  ));
}

const DEFAULT_NODE_AGENT_NAMES: AgentName[] = ["claude", "codex", "kimi"];

/** Agent executors shown on admin node surfaces (Pi only when the daemon reports it). */
export function visibleNodeAgentNames(node: Pick<ControlPanelDaemonNodeRecord, "agents">): AgentName[] {
  const names: AgentName[] = [...DEFAULT_NODE_AGENT_NAMES];
  if (node.agents.pi && node.agents.pi !== "unknown") names.push("pi");
  return names;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function defaultBackendUrl(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://127.0.0.1:8790";
}

/** Mirror backend daemon_start_command so cached node tokens stay usable after restart. */
export function buildDaemonStartCommand(
  node: Pick<ControlPanelDaemonNodeRecord, "id" | "employeeId" | "workspacePath" | "sandboxMode">,
  _nodeToken: string,
  backendUrl = defaultBackendUrl(),
): string {
  const sandboxMode = node.sandboxMode === "none" ? "none" : "boxlite";
  const parts = [
    "relay-daemon",
    "--backend-url",
    backendUrl,
    "--sandbox-id",
    node.id,
    "--sandbox",
    sandboxMode,
  ];
  if (sandboxMode === "none") parts.push("--use-local-agent-home");
  if (node.employeeId) parts.push("--employee-id", node.employeeId);
  if (node.workspacePath) parts.push("--workspace", node.workspacePath);
  return `read -rsp 'Relay node token: ' RELAY_DAEMON_NODE_TOKEN && echo && export RELAY_DAEMON_NODE_TOKEN && ${parts.map(shellQuote).join(" ")}`;
}

export const STALE_AFTER_MS = 15_000;
export interface StoredNodeToken {
  employeeId?: string;
  sandboxToken?: string;
  nodeToken?: string;
  daemonCommand?: string;
  savedAt: string;
}

export type StoredNodeTokenMap = Record<string, StoredNodeToken>;
let volatileNodeTokens: StoredNodeTokenMap = {};

export function isStale(node: ControlPanelDaemonNodeRecord): boolean {
  if (typeof node.stale === "boolean") return node.stale;
  if (!node.online) return true;
  if (!node.lastSeenAt) return true;
  return Date.now() - new Date(node.lastSeenAt).getTime() > STALE_AFTER_MS;
}

export function visualStatus(node: ControlPanelDaemonNodeRecord): string {
  return isStale(node) ? "stale" : node.status;
}

export type NodeQuickFilter = "all" | "ready" | "running" | "provisioning" | "failed" | "stopped" | "unassigned";

/** Match the fleet lifecycle slices while keeping an intentional stop distinct
 * from a lost heartbeat. Assignment remains an overlapping facet. */
export function matchesNodeQuickFilter(
  node: ControlPanelDaemonNodeRecord,
  filter: NodeQuickFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "unassigned") return !node.employeeId;
  const status = visualStatus(node);
  if (filter === "failed") return status === "failed" || status === "stale";
  // "Running" describes the Computer process, not only an actively executing
  // agent run. Healthy idle (ready) and busy Computers are running too.
  if (filter === "running") {
    return isNodeOnline(node)
      && (node.status === "ready" || node.status === "busy" || node.status === "running");
  }
  return status === filter;
}

/** A computer is "online" when its daemon is connected and its heartbeat is fresh. */
export function isNodeOnline(node: ControlPanelDaemonNodeRecord): boolean {
  return Boolean(node.online) && !isStale(node);
}

export function statusTone(status: string): Tone {
  if (status === "ready") return "good";
  if (status === "running" || status === "provisioning") return "info";
  if (status === "failed" || status === "stale") return "bad";
  if (status === "stopped") return "warn";
  return "neutral";
}

export function agentAvailabilityTone(availability: LogicalAgentAvailability): Tone {
  if (availability === "ready") return "good";
  if (availability === "busy") return "info";
  if (availability === "pending") return "warn";
  // Offline is the loud tier — same severity reading as the node presence dot.
  return "bad";
}

/** Runtime-mark tone for a node's agent. Unknown ("no signal yet") reads as
    warn so it stays distinct from disabled — a deliberate operator choice
    (calm neutral), passed via options.disabled by callers that know it. */
export function agentStatusTone(agentStatus: string, options?: { disabled?: boolean }): Tone {
  if (options?.disabled) return "neutral";
  if (agentStatus === "ready") return "good";
  if (agentStatus === "failed") return "bad";
  if (agentStatus === "unknown") return "warn";
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

export interface EmployeeNodeSummary {
  id: string;
  displayName: string;
  email?: string;
  departmentId?: string;
  departmentName?: string;
  nodeCount: number;
  readyCount: number;
  runningCount: number;
  failedCount: number;
  nodes: ControlPanelDaemonNodeRecord[];
}

export type EmployeeQuickFilter = "all" | "running" | "ready" | "idle" | "failed" | "unassigned";
export type EmployeeSummaryStatusKey = "running" | "ready" | "failed" | "idle" | "no_nodes";
type EmployeeSummaryTone = Tone | "muted";

export function matchesEmployeeQuickFilter(
  member: EmployeeNodeSummary,
  filter: EmployeeQuickFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "running") return member.runningCount > 0;
  if (filter === "ready") return member.readyCount > 0;
  if (filter === "failed") return member.failedCount > 0;
  if (filter === "idle") {
    return member.nodeCount > 0
      && member.runningCount === 0
      && member.readyCount === 0
      && member.failedCount === 0;
  }
  return member.nodeCount === 0;
}

export function employeeSummaryStatus(
  member: EmployeeNodeSummary,
): { tone: EmployeeSummaryTone; key: EmployeeSummaryStatusKey } {
  if (member.runningCount > 0) return { tone: "info", key: "running" };
  if (member.readyCount > 0) return { tone: "good", key: "ready" };
  if (member.failedCount > 0) return { tone: "bad", key: "failed" };
  if (member.nodeCount > 0) return { tone: "muted", key: "idle" };
  return { tone: "muted", key: "no_nodes" };
}

export function employeeEmptyStateTranslationKey(
  query: string,
  filter: EmployeeQuickFilter,
): "admin.v2.no_match" | "admin.v2.no_employees_for_filter" {
  return query.trim() || filter === "all"
    ? "admin.v2.no_match"
    : "admin.v2.no_employees_for_filter";
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
    // Employee summaries are categorical: an idle ready Computer must not also
    // make its employee look like they have an actively running agent.
    const readyCount = employeeNodes.filter((node) => visualStatus(node) === "ready").length;
    const runningCount = employeeNodes.filter((node) => visualStatus(node) === "running").length;
    const failedCount = employeeNodes.filter((node) => matchesNodeQuickFilter(node, "failed")).length;
    return {
      id,
      displayName: employee?.displayName || id,
      email: employee?.email,
      departmentId: employee?.departmentId,
      departmentName: employee?.departmentName,
      nodeCount: employeeNodes.length,
      readyCount,
      runningCount,
      failedCount,
      nodes: employeeNodes,
    };
  });
}

// Agents are placed on computers, not owned by employees. An agent belongs to a
// set of nodes when one of its live placements runs on one of them — this is the
// only correct way to associate agents with an employee (via the employee's
// nodes), never agent.employeeId.
export function agentsOnNodes(nodeIds: Iterable<string>, agents: EmployeeAgent[]): EmployeeAgent[] {
  const ids = new Set(nodeIds);
  return agents.filter(
    (agent) =>
      !agent.deletedAt &&
      agent.placements.some(
        (placement) => placement.desiredState !== "removed" && ids.has(placement.daemonNodeId),
      ),
  );
}

/** Agents running on the computers a given employee owns. */
export function agentsForEmployee(member: EmployeeNodeSummary, agents: EmployeeAgent[]): EmployeeAgent[] {
  return agentsOnNodes(member.nodes.map((node) => node.id), agents);
}

export function readStoredNodeTokens(): StoredNodeTokenMap {
  return { ...volatileNodeTokens };
}

export function writeStoredNodeToken(nodeId: string, token: StoredNodeToken): void {
  volatileNodeTokens = { ...volatileNodeTokens, [nodeId]: token };
}

export interface NodeLocalityFlags {
  hasCachedCredentials: boolean;
  isColocatedLive: boolean;
}

export type NodeOwnershipProfile = "managed" | "local" | "pending";
export type NodeSandboxProfile = "boxlite" | "host" | "pending";

export type NodeLocalityKind = "this_host" | "saved_here" | "remote";

/** Management ownership is independent of the daemon's sandbox implementation. */
export function nodeOwnershipProfile(node: Pick<ControlPanelDaemonNodeRecord, "nodeLocation" | "sandboxMode">): NodeOwnershipProfile {
  if (node.nodeLocation === "managed") return "managed";
  if (node.nodeLocation === "employee-device") return "local";
  return "pending";
}

export function nodeSandboxProfile(
  node: Pick<ControlPanelDaemonNodeRecord, "sandboxMode">,
): NodeSandboxProfile {
  if (node.sandboxMode === "boxlite") return "boxlite";
  if (node.sandboxMode === "none") return "host";
  return "pending";
}

export function nodeLocalityKind(
  node: ControlPanelDaemonNodeRecord,
  options: { storedTokens: StoredNodeTokenMap; colocated: boolean },
): NodeLocalityKind {
  if (!options.colocated) return "remote";
  const cached = options.storedTokens[node.id];
  if (cached?.nodeToken || cached?.sandboxToken || cached?.daemonCommand) return "saved_here";
  return "remote";
}

export function nodeLocalityKinds(
  node: ControlPanelDaemonNodeRecord,
  options: { storedTokens: StoredNodeTokenMap; colocated: boolean },
): Array<Exclude<NodeLocalityKind, "remote">> {
  if (!options.colocated) return [];
  const kinds: Array<Exclude<NodeLocalityKind, "remote">> = [];
  const cached = options.storedTokens[node.id];
  if (cached?.nodeToken || cached?.sandboxToken || cached?.daemonCommand) kinds.push("saved_here");
  return kinds;
}

export function nodeLocalityFlags(
  node: ControlPanelDaemonNodeRecord,
  options: { storedTokens: StoredNodeTokenMap; colocated: boolean },
): NodeLocalityFlags {
  const cached = options.storedTokens[node.id];
  return {
    hasCachedCredentials: Boolean(cached?.nodeToken || cached?.sandboxToken || cached?.daemonCommand),
    isColocatedLive: false,
  };
}

export function resolveNodeCredentials(
  node: ControlPanelDaemonNodeRecord,
  storedToken?: StoredNodeToken,
  backendUrl = defaultBackendUrl(),
): {
  sandboxToken?: string;
  nodeToken?: string;
  daemonCommand?: string;
  source: "none" | "cache" | "server" | "cache+server";
} {
  const nodeToken = storedToken?.nodeToken ?? node.nodeToken;
  const sandboxToken = storedToken?.sandboxToken;
  const daemonCommand = storedToken?.daemonCommand
    ?? (nodeToken ? buildDaemonStartCommand(node, nodeToken, backendUrl) : undefined);
  const fromCache = Boolean(storedToken?.nodeToken || storedToken?.sandboxToken || storedToken?.daemonCommand);
  const fromServer = Boolean(node.nodeToken);
  let source: "none" | "cache" | "server" | "cache+server" = "none";
  if (fromCache && fromServer) source = "cache+server";
  else if (fromCache) source = "cache";
  else if (fromServer) source = "server";
  if (!nodeToken && !sandboxToken && !daemonCommand) {
    return { source: "none" };
  }
  return { sandboxToken, nodeToken, daemonCommand, source };
}

/** Persist ephemeral control-panel node tokens before the backend drops them from RAM. */
export function upsertStoredCredentialsFromNodes(
  map: StoredNodeTokenMap,
  nodes: ControlPanelDaemonNodeRecord[],
  backendUrl = defaultBackendUrl(),
): StoredNodeTokenMap | null {
  let next = map;
  let changed = false;
  for (const node of nodes) {
    if (!node.nodeToken) continue;
    const existing = next[node.id];
    const merged: StoredNodeToken = {
      employeeId: node.employeeId ?? existing?.employeeId,
      nodeToken: node.nodeToken,
      sandboxToken: existing?.sandboxToken,
      daemonCommand: existing?.daemonCommand ?? buildDaemonStartCommand(node, node.nodeToken, backendUrl),
      savedAt: existing?.savedAt ?? new Date().toISOString(),
    };
    if (
      existing?.nodeToken !== merged.nodeToken
      || existing?.daemonCommand !== merged.daemonCommand
      || existing?.employeeId !== merged.employeeId
    ) {
      next = { ...next, [node.id]: merged };
      changed = true;
    }
  }
  return changed ? next : null;
}

export function persistStoredNodeTokenMap(map: StoredNodeTokenMap): void {
  volatileNodeTokens = { ...map };
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

/** Initials for employee/operator avatars in admin drawers. */
export function initialsOf(value: string): string {
  const trimmed = value.replace(/^@/, "").trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
