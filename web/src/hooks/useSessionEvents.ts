import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RelaySession } from "../types";

const SESSIONS_KEY = ["relay", "sessions"] as const;

type RelayEvent = RelaySession["events"][number];

// Live tail of a single session over SSE. Domain events arrive as default
// `message` frames (the backend tags control frames `heartbeat`/`done`); each
// is merged into the cached sessions list so the existing activeSession
// derivation reflects streamed output at push latency, without the list poll
// having to run faster. The 3s list query remains the fallback/source of
// truth for everything else.
export function useSessionEvents(sessionId: string | undefined, enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!sessionId || !enabled || typeof window === "undefined") return;

    const source = new EventSource(`/sessions/${encodeURIComponent(sessionId)}/events`, {
      withCredentials: true,
    });

    const mergeEvent = (event: RelayEvent) => {
      queryClient.setQueryData<RelaySession[]>(SESSIONS_KEY, (sessions) => {
        if (!sessions) return sessions;
        let changed = false;
        const next = sessions.map((session) => {
          if (session.id !== sessionId) return session;
          if (session.events.some((existing) => existing.id === event.id)) return session;
          changed = true;
          return { ...session, events: [...session.events, event] };
        });
        return changed ? next : sessions;
      });
    };

    source.onmessage = (message) => {
      if (!message.data) return;
      try {
        mergeEvent(JSON.parse(message.data) as RelayEvent);
      } catch {
        // Ignore malformed frames; the list poll still reconciles state.
      }
    };

    // The server closes the stream at a terminal status; stop reconnecting.
    source.addEventListener("done", () => source.close());

    // EventSource auto-reconnects on transient errors, which is what we want
    // for a long-lived run; nothing to do here beyond letting it retry.

    return () => source.close();
  }, [sessionId, enabled, queryClient]);
}
