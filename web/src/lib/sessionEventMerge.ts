import type { RelaySession } from "../types.js";

type RelayEvent = RelaySession["events"][number];

export type SessionEventMergeResult = {
  sessions: RelaySession[] | undefined;
  consumed: boolean;
};

export type SessionEventsMergeResult = {
  sessions: RelaySession[] | undefined;
  consumed: number;
};

export function mergeSessionEventsIntoSessions(
  sessions: RelaySession[] | undefined,
  sessionId: string,
  events: RelayEvent[],
  applyEvent: (session: RelaySession, event: RelayEvent) => RelaySession,
): SessionEventsMergeResult {
  if (!sessions) return { sessions, consumed: 0 };
  const target = sessions.find((session) => session.id === sessionId);
  if (!target) return { sessions, consumed: 0 };

  const known = new Set(target.events.map((event) => event.id));
  let merged = target;
  let consumed = 0;
  for (const event of events) {
    if (known.has(event.id)) continue;
    known.add(event.id);
    merged = applyEvent(merged, event);
    consumed += 1;
  }
  if (consumed === 0) return { sessions, consumed };
  return {
    sessions: sessions.map((session) => session.id === sessionId ? merged : session),
    consumed,
  };
}

export function mergeSessionEventIntoSessions(
  sessions: RelaySession[] | undefined,
  sessionId: string,
  event: RelayEvent,
  applyEvent: (session: RelaySession, event: RelayEvent) => RelaySession,
): SessionEventMergeResult {
  if (!sessions) return { sessions, consumed: false };
  let changed = false;
  let consumed = false;
  const next = sessions.map((session) => {
    if (session.id !== sessionId) return session;
    consumed = true;
    if (session.events.some((existing) => existing.id === event.id)) return session;
    changed = true;
    return applyEvent(session, event);
  });
  return { sessions: changed ? next : sessions, consumed };
}
