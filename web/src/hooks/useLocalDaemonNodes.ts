import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ControlPanelDaemonNodeRecord } from "../types";

const LOCAL_NODES_KEY = ["relay", "local-nodes"] as const;
const POLL_INTERVAL_MS = 3000;

// Admin-only discovery of daemon nodes registered with a co-located control
// panel. The 3s poll lives on the query's refetchInterval (replacing a manual
// setInterval); provisioning/adopt flows call refreshLocalDaemonNodes() for a
// guaranteed-fresh read, which also writes the cache so localNodes stays in
// sync. When disabled (non-admin / not local) the poll is off but imperative
// fetches still populate the same cache, matching the prior behavior.
export function useLocalDaemonNodes(
  fetcher: () => Promise<ControlPanelDaemonNodeRecord[]>,
  enabled: boolean,
): {
  localNodes: ControlPanelDaemonNodeRecord[];
  refreshLocalDaemonNodes: () => Promise<ControlPanelDaemonNodeRecord[]>;
} {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: LOCAL_NODES_KEY,
    queryFn: fetcher,
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const refreshLocalDaemonNodes = useCallback(
    () => queryClient.fetchQuery({ queryKey: LOCAL_NODES_KEY, queryFn: fetcher, staleTime: 0 }),
    [queryClient, fetcher],
  );

  return { localNodes: query.data ?? [], refreshLocalDaemonNodes };
}
