import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ControlPanelDaemonNodeRecord } from "../types";
import {
  CONTROL_PANEL_NODES_KEY,
  CONTROL_PANEL_POLL_MS,
  fetchControlPanelNodes,
} from "../lib/controlPanelQueries";

// Admin-only discovery of daemon nodes registered with a co-located control
// panel. Shares CONTROL_PANEL_NODES_KEY with useAdminNodes so threads + admin do
// not double-poll /cp/daemon-nodes on localhost.
export function useLocalDaemonNodes(enabled: boolean): {
  localNodes: ControlPanelDaemonNodeRecord[];
  refreshLocalDaemonNodes: () => Promise<ControlPanelDaemonNodeRecord[]>;
} {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: CONTROL_PANEL_NODES_KEY,
    queryFn: ({ signal }) => fetchControlPanelNodes(signal),
    enabled,
    refetchInterval: CONTROL_PANEL_POLL_MS,
  });

  const refreshLocalDaemonNodes = useCallback(
    async () => {
      try {
        return (await queryClient.fetchQuery({
          queryKey: CONTROL_PANEL_NODES_KEY,
          queryFn: ({ signal }) => fetchControlPanelNodes(signal),
          staleTime: 0,
        })) ?? [];
      } catch {
        return [];
      }
    },
    [queryClient],
  );

  return { localNodes: query.data ?? [], refreshLocalDaemonNodes };
}
