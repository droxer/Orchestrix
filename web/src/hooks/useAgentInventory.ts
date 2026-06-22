import { useQuery } from "@tanstack/react-query";
import { listDaemonNodes } from "../api";
import type { DaemonNodeMonitorRecord } from "../types";

const INVENTORY_KEY = ["relay", "agent-inventory-nodes"] as const;
const POLL_INTERVAL_MS = 5000;

// Polls the daemon nodes the current session can see and exposes their records
// so the Skills/MCP pages can derive a per-agent inventory. Session-scoped (no
// bearer token): the backend returns whichever nodes the actor may access.
export function useAgentInventoryNodes(): {
  nodes: DaemonNodeMonitorRecord[];
  isLoading: boolean;
  error: string | null;
} {
  const query = useQuery({
    queryKey: INVENTORY_KEY,
    refetchInterval: POLL_INTERVAL_MS,
    queryFn: async ({ signal }): Promise<DaemonNodeMonitorRecord[]> =>
      (await listDaemonNodes(undefined, signal)).nodes,
  });

  return {
    nodes: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null,
  };
}
