import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { listDaemonNodes, listSandboxes, listSessions } from "../api";
import type { DaemonNodeMonitorRecord, RelaySession, SandboxRecord, Tone } from "../types";

type StatusUpdate = { tone: Tone; message: string };

const RELAY_KEY = ["relay"] as const;
const SANDBOXES_KEY = ["relay", "sandboxes"] as const;
const NODES_KEY = ["relay", "daemon-nodes"] as const;
const SESSIONS_KEY = ["relay", "sessions"] as const;
const POLL_INTERVAL_MS = 3000;

type RelayDataResult = {
  sandboxes: SandboxRecord[];
  nodes: DaemonNodeMonitorRecord[];
  sessions: RelaySession[];
  isRefreshing: boolean;
  refresh: (signal?: AbortSignal, tokenOverride?: string) => Promise<void>;
  setSandboxes: Dispatch<SetStateAction<SandboxRecord[]>>;
};

// Server state for the control-plane console, owned by TanStack Query. The
// steady 3s poll lives on each query's refetchInterval; dedup, cancellation,
// and retry/backoff come from the cache instead of hand-rolled setInterval +
// AbortController + Promise.allSettled. The hook keeps its previous external
// shape so callers (App.tsx) are unchanged.
export function useRelayData(
  setStatus: (status: StatusUpdate) => void,
  token: string | undefined,
  enabled: boolean,
): RelayDataResult {
  const queryClient = useQueryClient();

  // The token used by the next fetch. Held in a ref (not the query key) to
  // preserve the previous single-bucket behavior: the lists are one cache
  // entry refetched with whatever token is current, regardless of which token
  // produced the rows already on screen.
  const tokenRef = useRef(token);
  tokenRef.current = token;
  // One-shot override applied by refresh(_, tokenOverride) during sandbox
  // provisioning, before the freshly minted token has propagated into state.
  const overrideRef = useRef<string | undefined>(undefined);
  const fetchToken = () => overrideRef.current ?? tokenRef.current;

  const results = useQueries({
    queries: [
      {
        queryKey: SANDBOXES_KEY,
        enabled,
        refetchInterval: POLL_INTERVAL_MS,
        queryFn: async ({ signal }: { signal: AbortSignal }): Promise<SandboxRecord[]> => {
          const tk = fetchToken();
          return tk ? (await listSandboxes(tk, signal)).sandboxes : [];
        },
      },
      {
        queryKey: NODES_KEY,
        enabled,
        refetchInterval: POLL_INTERVAL_MS,
        queryFn: async ({ signal }: { signal: AbortSignal }): Promise<DaemonNodeMonitorRecord[]> => {
          const tk = fetchToken();
          return tk ? (await listDaemonNodes(tk, signal)).nodes : [];
        },
      },
      {
        queryKey: SESSIONS_KEY,
        enabled,
        refetchInterval: POLL_INTERVAL_MS,
        queryFn: async ({ signal }: { signal: AbortSignal }): Promise<RelaySession[]> =>
          (await listSessions(signal)).sessions,
      },
    ],
  });

  const [sandboxesQuery, nodesQuery, sessionsQuery] = results;
  const sandboxes = sandboxesQuery.data ?? [];
  const nodes = nodesQuery.data ?? [];
  const sessions = sessionsQuery.data ?? [];
  const isRefreshing = results.some((result) => result.isFetching);

  // When disabled (e.g. logged out) drop cached rows so the UI clears at once,
  // matching the previous reset-to-empty behavior.
  useEffect(() => {
    if (!enabled) {
      queryClient.setQueryData(SANDBOXES_KEY, []);
      queryClient.setQueryData(NODES_KEY, []);
      queryClient.setQueryData(SESSIONS_KEY, []);
    }
  }, [enabled, queryClient]);

  // Surface the first failing query as a status warning, mirroring the prior
  // Promise.allSettled error reporting.
  const firstError = sandboxesQuery.error ?? nodesQuery.error ?? sessionsQuery.error;
  useEffect(() => {
    if (firstError) {
      setStatus({
        tone: "warn",
        message: firstError instanceof Error ? firstError.message : String(firstError),
      });
    }
  }, [firstError, setStatus]);

  // Refetch under the new credential whenever the active token changes.
  useEffect(() => {
    if (enabled) void queryClient.refetchQueries({ queryKey: RELAY_KEY });
  }, [token, enabled, queryClient]);

  const refresh = useCallback(
    async (_signal?: AbortSignal, tokenOverride?: string) => {
      if (!enabled) return;
      if (tokenOverride) overrideRef.current = tokenOverride;
      try {
        await queryClient.refetchQueries({ queryKey: RELAY_KEY });
      } finally {
        overrideRef.current = undefined;
      }
    },
    [enabled, queryClient],
  );

  // Optimistic sandbox updates write straight into the cache so callers keep
  // their familiar setState-style API.
  const setSandboxes = useCallback<Dispatch<SetStateAction<SandboxRecord[]>>>(
    (update) => {
      queryClient.setQueryData<SandboxRecord[]>(SANDBOXES_KEY, (current) => {
        const base = current ?? [];
        return typeof update === "function"
          ? (update as (prev: SandboxRecord[]) => SandboxRecord[])(base)
          : update;
      });
    },
    [queryClient],
  );

  return { sandboxes, nodes, sessions, isRefreshing, refresh, setSandboxes };
}
