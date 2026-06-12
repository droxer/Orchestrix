import type { ControlPanelDaemonNodeRecord, DaemonNodeMonitorRecord } from "../types.js";

function stripControlPanelToken(node: ControlPanelDaemonNodeRecord): DaemonNodeMonitorRecord {
  const { nodeToken: _nodeToken, ...safeNode } = node;
  return safeNode;
}

function nodeRank(node: DaemonNodeMonitorRecord): number {
  if (node.activeRuns.length > 0) return 4;
  if (node.online && !node.stale && node.status === "ready") return 3;
  if (node.online && !node.stale) return 2;
  if (!node.stale) return 1;
  return 0;
}

function preferDaemonNode(a: DaemonNodeMonitorRecord, b: DaemonNodeMonitorRecord): DaemonNodeMonitorRecord {
  const rankDelta = nodeRank(b) - nodeRank(a);
  if (rankDelta > 0) return b;
  if (rankDelta < 0) return a;
  return (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? "") > 0 ? b : a;
}

export function mergeVisibleDaemonNodes(
  authenticatedNodes: DaemonNodeMonitorRecord[],
  controlPanelNodes: ControlPanelDaemonNodeRecord[],
): DaemonNodeMonitorRecord[] {
  const byEmployee = new Map<string, DaemonNodeMonitorRecord>();
  for (const node of authenticatedNodes) {
    const existing = byEmployee.get(node.employeeId);
    byEmployee.set(node.employeeId, existing ? preferDaemonNode(existing, node) : node);
  }
  for (const controlPanelNode of controlPanelNodes) {
    const node = stripControlPanelToken(controlPanelNode);
    const existing = byEmployee.get(node.employeeId);
    byEmployee.set(node.employeeId, existing ? preferDaemonNode(existing, node) : node);
  }
  return [...byEmployee.values()].sort((a, b) => a.employeeId.localeCompare(b.employeeId));
}

export function shouldClaimLocalDaemonNode(
  controlPanelNode: ControlPanelDaemonNodeRecord,
  authenticatedNodes: DaemonNodeMonitorRecord[],
): boolean {
  if (!controlPanelNode.nodeToken || !controlPanelNode.online || controlPanelNode.stale) return false;
  return !authenticatedNodes.some((node) =>
    (node.id === controlPanelNode.id || node.employeeId === controlPanelNode.employeeId) &&
    node.online &&
    !node.stale
  );
}
