import { relayApiPath } from "relay-core/api-url";
import type { RelaySession, SessionStatus } from "../types.js";

const TERMINAL_SESSION_STATUSES: ReadonlySet<SessionStatus> = new Set(["completed", "failed", "cancelled"]);

export function isTerminalSessionStatus(status: SessionStatus | undefined): boolean {
  return Boolean(status && TERMINAL_SESSION_STATUSES.has(status));
}

export function shouldTailSessionEvents(status: SessionStatus | undefined): boolean {
  return Boolean(status && !isTerminalSessionStatus(status));
}

export function lastSessionEventId(sessions: readonly RelaySession[] | undefined, sessionId: string): string | undefined {
  const events = sessions?.find((session) => session.id === sessionId)?.events;
  return events?.at(-1)?.id;
}

export function sessionEventsUrl(sessionId: string, afterEventId?: string): string {
  const base = relayApiPath(`/threads/${encodeURIComponent(sessionId)}/events`);
  return afterEventId ? `${base}?after=${encodeURIComponent(afterEventId)}` : base;
}
