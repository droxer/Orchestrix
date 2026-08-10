import type { RelaySession, SessionSummary } from "../types.js";

type RelayEvent = RelaySession["events"][number];

function inflateSessionSummary(summary: SessionSummary): RelaySession {
  const { artifactCount: _artifactCount, eventCount: _eventCount, runCount: _runCount, ...fields } = summary;
  return {
    ...fields,
    participants: ["human"],
    agentRuns: [],
    artifacts: [],
    decisions: [],
    collaborationRounds: [],
    events: [],
  } as RelaySession;
}

export function mergeSessionSummaries(
  current: RelaySession[],
  summaries: SessionSummary[],
): RelaySession[] {
  const byId = new Map(current.map((session) => [session.id, session]));
  return summaries.map((summary) => {
    const existing = byId.get(summary.id);
    if (!existing) return inflateSessionSummary(summary);
    // A summary request can start before an SSE frame is committed and return
    // afterward. Never roll event-derived state backward in that race.
    if (summary.eventCount < existing.events.length) return existing;
    const { artifactCount: _artifactCount, eventCount: _eventCount, runCount: _runCount, ...fields } = summary;
    return { ...existing, ...fields } as RelaySession;
  });
}

export function mergeSessionSnapshotIntoSessions(
  current: RelaySession[],
  snapshot: RelaySession,
  applyEvent: (session: RelaySession, event: RelayEvent) => RelaySession = (session, event) => ({
    ...session,
    updatedAt: event.timestamp,
    events: [...session.events, event],
  }),
): RelaySession[] {
  const index = current.findIndex((session) => session.id === snapshot.id);
  if (index < 0) return [snapshot, ...current];

  const snapshotIds = new Set(snapshot.events.map((event) => event.id));
  const merged = current[index].events
    .filter((event) => !snapshotIds.has(event.id))
    .reduce(applyEvent, snapshot);
  if (merged === current[index]) return current;
  const next = [...current];
  next[index] = merged;
  return next;
}
