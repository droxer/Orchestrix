import type { DaemonNodeMonitorRecord, SandboxRecord } from "../types.js";

/** Every status value the thread surface can hand to StatusPill:
    LogicalAgentAvailability plus the daemon/sandbox lifecycle states. */
export type StatusValue =
  | "ready"
  | "running"
  | "busy"
  | "pending"
  | "provisioning"
  | "stopped"
  | "stale"
  | "offline"
  | "failed"
  | "blocked"
  | "cancelled"
  | "completed"
  | "done";

type ThreadDaemonSource = {
  node?: DaemonNodeMonitorRecord;
  sandbox?: Pick<SandboxRecord, "status">;
  activeRun?: DaemonNodeMonitorRecord["activeRuns"][number];
};

export function threadDaemonStatus(source: ThreadDaemonSource): StatusValue {
  if (source.node) {
    // A stale heartbeat overrides liveness: a node we cannot reach must
    // never render the live "running" pulse.
    if (source.node.stale) return "stale";
    if (source.activeRun || source.node.activeRuns.length > 0) return "running";
    return source.node.status;
  }
  return source.sandbox?.status ?? "provisioning";
}
