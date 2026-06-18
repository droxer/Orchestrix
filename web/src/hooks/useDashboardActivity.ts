import { useQuery } from "@tanstack/react-query";
import { getDashboardActivity, type DashboardActivityItem } from "../api";

const KEY = ["admin", "dashboard", "activity"] as const;
const POLL_INTERVAL_MS = 10_000;

export function useDashboardActivity(enabled: boolean): {
  items: DashboardActivityItem[];
  isLoading: boolean;
  error: string | null;
} {
  const query = useQuery<{ items: DashboardActivityItem[] }>({
    queryKey: KEY,
    queryFn: ({ signal }) => getDashboardActivity(signal),
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
  });
  return {
    items: query.data?.items ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null,
  };
}
