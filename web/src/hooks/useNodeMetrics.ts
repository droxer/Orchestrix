import { useMemo } from "react";
import { isStale, visualStatus } from "../lib/adminHelpers";
import type { ControlPanelDaemonNodeRecord, EmployeeRecord } from "../types";

export interface NodeMetrics {
  total: number;
  ready: number;
  running: number;
  failed: number;
  queued: number;
  employeeTotal: number;
}

export function useNodeMetrics(
  nodes: ControlPanelDaemonNodeRecord[],
  employees: EmployeeRecord[],
): NodeMetrics {
  return useMemo(() => {
    const total = nodes.length;
    const ready = nodes.filter((node) => visualStatus(node) === "ready").length;
    const running = nodes.filter((node) => !isStale(node) && node.status === "running").length;
    const failed = nodes.filter((node) => {
      const status = visualStatus(node);
      return status === "failed" || status === "stale";
    }).length;
    const queued = nodes.reduce((acc, node) => acc + node.queuedCommandCount, 0);
    const employeeTotal =
      employees.length || new Set(nodes.map((node) => node.employeeId).filter(Boolean)).size;
    return { total, ready, running, failed, queued, employeeTotal };
  }, [nodes, employees]);
}
