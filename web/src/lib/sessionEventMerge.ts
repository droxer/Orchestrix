import type { RelaySession } from "../types.js";

type RelayEvent = RelaySession["events"][number];

export type SessionEventMergeResult = {
  sessions: RelaySession[] | undefined;
  consumed: boolean;
};

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
