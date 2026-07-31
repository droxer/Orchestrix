import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSession } from "../api";
import type { RelaySession } from "../types";
import { mergeSessionSnapshotIntoSessions } from "../lib/sessionPollMerge";
import { applySessionEventUnchecked } from "../lib/sessionEvents";

const SESSIONS_KEY = ["relay", "sessions"] as const;

/** Hydrate the selected compact summary without letting a stale response erase SSE events. */
export function useSessionDetail(sessionId: string | undefined, enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!sessionId || !enabled) return;
    const controller = new AbortController();
    void getSession(sessionId, controller.signal)
      .then((snapshot) => {
        queryClient.setQueryData<RelaySession[]>(SESSIONS_KEY, (current) =>
          mergeSessionSnapshotIntoSessions(current ?? [], snapshot, applySessionEventUnchecked),
        );
      })
      .catch((error: unknown) => {
        // The summary row remains usable if hydration fails; the next
        // selection retries. Abort errors are equally safe to ignore.
        void error;
      });
    return () => controller.abort();
  }, [enabled, queryClient, sessionId]);
}
