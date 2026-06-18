export interface TokenUsageSnapshot {
  available: boolean;
  totalInput: number;
  totalOutput: number;
  totalCache: number;
  daily: Array<{ date: string; input: number; output: number; cache: number }>;
}

// Token-usage tracking is not yet wired into the backend. This hook returns a
// stable zero snapshot so the dashboard surfaces the empty state until the
// `/cp/dashboard/tokens` endpoint lands. Swap the body for a useQuery call at
// that point — consumers don't change.
export function useTokenUsage(): TokenUsageSnapshot {
  return {
    available: false,
    totalInput: 0,
    totalOutput: 0,
    totalCache: 0,
    daily: [],
  };
}
