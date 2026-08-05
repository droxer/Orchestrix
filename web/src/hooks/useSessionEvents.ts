import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RelaySession } from "../types";
import { applySessionEventUnchecked } from "../lib/sessionEvents";
import { mergeSessionEventsIntoSessions } from "../lib/sessionEventMerge";
import { isTerminalSessionStatus, lastSessionEventId, sessionEventsUrl } from "../lib/sessionEventStream";
import { browserFrameSchedulerHost, createFrameScheduler } from "../lib/frameScheduler";

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

    const source = new EventSource(sessionEventsUrl(
      sessionId,
      lastSessionEventId(queryClient.getQueryData<RelaySession[]>(SESSIONS_KEY), sessionId),
    ), {
      withCredentials: true,
    });

    // Track ids we've already merged so dedup is O(1) per frame rather than a
    // linear scan of the session's growing event list on every streamed delta.
    const cached = queryClient.getQueryData<RelaySession[]>(SESSIONS_KEY)
      ?.find((session) => session.id === sessionId);
    const seen = new Set(cached?.events.map((event) => event.id) ?? []);
    const queued = new Set<string>();
    let pending: RelayEvent[] = [];
    // Frame-aligned when the page paints, timer-backed when it does not — a
    // backgrounded or occluded tab must still commit streamed output.
    const scheduler = createFrameScheduler(browserFrameSchedulerHost());

    const flush = () => {
      const events = pending;
      pending = [];
      queryClient.setQueryData<RelaySession[]>(SESSIONS_KEY, (sessions) => {
        const result = mergeSessionEventsIntoSessions(
          sessions,
          sessionId,
          events,
          applySessionEventUnchecked,
        );
        if (sessions?.some((session) => session.id === sessionId)) {
          for (const event of events) seen.add(event.id);
        }
        return result.sessions;
      });
      for (const event of events) queued.delete(event.id);
    };

    const enqueue = (events: RelayEvent[]) => {
      for (const event of events) {
        if (!event?.id || seen.has(event.id) || queued.has(event.id)) continue;
        queued.add(event.id);
        pending.push(event);
      }
      if (pending.length > 0) scheduler.request(flush);
    };

    source.onmessage = (message) => {
      if (!message.data) return;
      try {
        enqueue([JSON.parse(message.data) as RelayEvent]);
      } catch {
        // Ignore malformed frames; the list poll still reconciles state.
      }
    };

    source.addEventListener("batch", (message) => {
      if (!(message as MessageEvent<string>).data) return;
      try {
        const payload = JSON.parse((message as MessageEvent<string>).data) as { events?: RelayEvent[] };
        if (Array.isArray(payload.events)) enqueue(payload.events);
      } catch {
        // Ignore malformed frames; the summary poll and detail fetch reconcile state.
      }
    });

    // The server emits `done` before closing terminal sessions and long-lived
    // timeout windows. Only terminal sessions should stop reconnecting; active
    // runs should let EventSource reconnect with its last event id.
    source.addEventListener("done", (event) => {
      let status: RelaySession["status"] | undefined;
      try {
        const data = JSON.parse((event as MessageEvent<string>).data) as { status?: RelaySession["status"] };
        status = data.status;
      } catch {
        // Unknown control frames should not loop forever.
        source.close();
        return;
      }
      if (isTerminalSessionStatus(status)) source.close();
    });

    // EventSource auto-reconnects on transient errors, but it cannot read the
    // HTTP status, so a permanent failure (auth lost, session gone) would loop
    // forever hammering the backend. Cap consecutive failures and fall back to
    // the list poll, which remains the source of truth.
    let failures = 0;
    const MAX_FAILURES = 5;
    source.onerror = () => {
      // A reconnect attempt (CONNECTING) is normal; only count hard failures.
      if (source.readyState !== EventSource.CLOSED) {
        failures += 1;
        if (failures >= MAX_FAILURES) source.close();
        return;
      }
      source.close();
    };
    source.onopen = () => {
      failures = 0;
    };

    return () => {
      source.close();
      scheduler.cancel();
    };
  }, [sessionId, enabled, queryClient]);
}
