"use client";

import { useQuery } from "@tanstack/react-query";
import { listEmployeeAgents } from "../api";
import type { EmployeeAgent } from "../types";

export const EMPLOYEE_AGENTS_QUERY_KEY = "employee-agents";

export function useEmployeeAgents(employeeId?: string): {
  agents: EmployeeAgent[];
  isFetching: boolean;
} {
  const query = useQuery({
    queryKey: [EMPLOYEE_AGENTS_QUERY_KEY, employeeId],
    queryFn: ({ signal }) => listEmployeeAgents(signal),
    enabled: Boolean(employeeId),
    refetchInterval: 10_000,
  });
  return {
    agents: query.data?.agents ?? [],
    isFetching: query.isFetching,
  };
}
