import type { RelaySession } from "../types.js";

export function lastSessionEventId(sessions: readonly RelaySession[] | undefined, sessionId: string): string | undefined {
  const events = sessions?.find((session) => session.id === sessionId)?.events;
  return events?.at(-1)?.id;
}

export function sessionEventsUrl(sessionId: string, afterEventId?: string): string {
  const base = `/sessions/${encodeURIComponent(sessionId)}/events`;
  return afterEventId ? `${base}?after=${encodeURIComponent(afterEventId)}` : base;
}
