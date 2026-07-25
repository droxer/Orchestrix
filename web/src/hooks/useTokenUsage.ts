import { useQuery } from "@tanstack/react-query";
import { getDashboardTokens, type TokenUsageSnapshot } from "../api";

export type { TokenUsageSnapshot };

const KEY = ["admin", "dashboard", "tokens"] as const;
const POLL_INTERVAL_MS = 10_000;

export function useTokenUsage(): TokenUsageSnapshot {
  const query = useQuery<TokenUsageSnapshot>({
    queryKey: KEY,
    queryFn: ({ signal }) => getDashboardTokens(signal),
    refetchInterval: POLL_INTERVAL_MS,
  });
  return query.data ?? {
    available: false,
    totalInput: 0,
    totalOutput: 0,
    totalCache: 0,
    total: 0,
    unsupportedAgents: ["kimi"],
    daily: [],
    byEmployee: [],
    recentSessions: [],
  };
}
