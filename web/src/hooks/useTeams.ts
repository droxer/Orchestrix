"use client";

import { useQuery } from "@tanstack/react-query";
import { listTeams } from "../api";
import type { AgentTeam } from "../types";

export const TEAMS_QUERY_KEY = "teams";

export function useTeams(
  employeeId?: string,
): { teams: AgentTeam[]; isFetching: boolean; refetch: () => Promise<unknown> } {
  const query = useQuery({
    queryKey: [TEAMS_QUERY_KEY, employeeId],
    queryFn: ({ signal }) => listTeams(signal),
    enabled: Boolean(employeeId),
    refetchInterval: 10_000,
  });
  return { teams: query.data?.teams ?? [], isFetching: query.isFetching, refetch: query.refetch };
}
