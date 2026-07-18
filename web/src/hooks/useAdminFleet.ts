import { useCallback } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { listControlPanelEmployees } from "../api";
import type { ControlPanelDaemonNodeRecord, EmployeeRecord } from "../types";
import {
  CONTROL_PANEL_NODES_KEY,
  CONTROL_PANEL_POLL_MS,
  fetchControlPanelNodes,
} from "../lib/controlPanelQueries";

const ADMIN_EMPLOYEES_KEY = ["admin", "employees"] as const;

export interface AdminFleet {
  nodes: ControlPanelDaemonNodeRecord[];
  employees: EmployeeRecord[];
}

// Admin console fleet snapshot (daemon nodes + employees). Node polling shares
// CONTROL_PANEL_NODES_KEY with useLocalDaemonNodes so localhost chat + admin
// reuse one /cp/daemon-nodes poll instead of two timers. When `live` is false the
// data is fetched once and not refreshed, which keeps the admin card view stable.
export function useAdminFleet(enabled: boolean, live: boolean = true): {
  nodes: ControlPanelDaemonNodeRecord[];
  employees: EmployeeRecord[];
  lastUpdated: Date | null;
  pollError: string | null;
  isFetching: boolean;
  mergeFleet: (updater: (prev: AdminFleet) => AdminFleet) => void;
  refetch: () => Promise<unknown>;
} {
  const queryClient = useQueryClient();

  const [nodesQuery, employeesQuery] = useQueries({
    queries: [
      {
        queryKey: CONTROL_PANEL_NODES_KEY,
        queryFn: ({ signal }: { signal: AbortSignal }) => fetchControlPanelNodes(signal),
        enabled,
        refetchInterval: live ? CONTROL_PANEL_POLL_MS : false,
      },
      {
        queryKey: ADMIN_EMPLOYEES_KEY,
        queryFn: async ({ signal }: { signal: AbortSignal }) =>
          (await listControlPanelEmployees(signal)).employees,
        enabled,
        refetchInterval: live ? CONTROL_PANEL_POLL_MS : false,
      },
    ],
  });

  const nodes = nodesQuery.data ?? [];
  const employees = employeesQuery.data ?? [];
  const pollError = nodesQuery.error ?? employeesQuery.error;
  const isFetching = nodesQuery.isFetching || employeesQuery.isFetching;
  const dataUpdatedAt = Math.max(nodesQuery.dataUpdatedAt, employeesQuery.dataUpdatedAt);

  const mergeFleet = useCallback(
    (updater: (prev: AdminFleet) => AdminFleet) => {
      queryClient.setQueryData<ControlPanelDaemonNodeRecord[]>(CONTROL_PANEL_NODES_KEY, (prevNodes) => {
        const prevEmployees = queryClient.getQueryData<EmployeeRecord[]>(ADMIN_EMPLOYEES_KEY) ?? [];
        const next = updater({ nodes: prevNodes ?? [], employees: prevEmployees });
        queryClient.setQueryData(ADMIN_EMPLOYEES_KEY, next.employees);
        return next.nodes;
      });
    },
    [queryClient],
  );

  const refetch = useCallback(
    () => Promise.all([
      queryClient.refetchQueries({ queryKey: CONTROL_PANEL_NODES_KEY }),
      queryClient.refetchQueries({ queryKey: ADMIN_EMPLOYEES_KEY }),
    ]),
    [queryClient],
  );

  return {
    nodes,
    employees,
    lastUpdated: nodes.length > 0 || employees.length > 0 ? new Date(dataUpdatedAt) : null,
    pollError: pollError instanceof Error ? pollError.message : pollError ? String(pollError) : null,
    isFetching,
    mergeFleet,
    refetch,
  };
}
