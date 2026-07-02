import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listControlPanelDaemonNodes, listControlPanelEmployees } from "../api";
import type { ControlPanelDaemonNodeRecord, EmployeeRecord } from "../types";

const ADMIN_FLEET_KEY = ["admin", "fleet"] as const;
const POLL_INTERVAL_MS = 2000;

export interface AdminFleet {
  nodes: ControlPanelDaemonNodeRecord[];
  employees: EmployeeRecord[];
}

// Admin console fleet snapshot (daemon nodes + employees). The 2s poll lives on
// the query's refetchInterval (replacing a hand-rolled setInterval); onboard /
// assign flows call mergeFleet() to fold their result into the same cache, and
// the derived lastUpdated bumps automatically via dataUpdatedAt.
export function useAdminFleet(enabled: boolean): {
  nodes: ControlPanelDaemonNodeRecord[];
  employees: EmployeeRecord[];
  lastUpdated: Date | null;
  pollError: string | null;
  isFetching: boolean;
  mergeFleet: (updater: (prev: AdminFleet) => AdminFleet) => void;
  refetch: () => Promise<unknown>;
} {
  const queryClient = useQueryClient();

  const query = useQuery<AdminFleet>({
    queryKey: ADMIN_FLEET_KEY,
    queryFn: async ({ signal }) => {
      const [nodeResult, employeeResult] = await Promise.all([
        listControlPanelDaemonNodes(signal),
        listControlPanelEmployees(signal),
      ]);
      return { nodes: nodeResult.nodes, employees: employeeResult.employees };
    },
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const mergeFleet = useCallback(
    (updater: (prev: AdminFleet) => AdminFleet) => {
      queryClient.setQueryData<AdminFleet>(ADMIN_FLEET_KEY, (prev) => updater(prev ?? { nodes: [], employees: [] }));
    },
    [queryClient],
  );

  return {
    nodes: query.data?.nodes ?? [],
    employees: query.data?.employees ?? [],
    lastUpdated: query.data ? new Date(query.dataUpdatedAt) : null,
    pollError: query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null,
    isFetching: query.isFetching,
    mergeFleet,
    refetch: () => query.refetch(),
  };
}
