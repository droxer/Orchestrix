import type { DaemonNodeMonitorRecord, SandboxRecord } from "../types.js";

type ConversationDaemonSource = {
  node?: DaemonNodeMonitorRecord;
  sandbox?: Pick<SandboxRecord, "status">;
  activeRun?: DaemonNodeMonitorRecord["activeRuns"][number];
};

export function conversationDaemonStatus(source: ConversationDaemonSource): string {
  if (source.node) {
    if (source.activeRun || source.node.activeRuns.length > 0) return "running";
    if (source.node.stale) return "stale";
    return source.node.status;
  }
  return source.sandbox?.status ?? "provisioning";
}
