import type { AgentName, RelaySession } from "../types.js";

// A thread is one owner-scoped session. The row binds to the session
// itself (not an employee), so the logged-in employee can hold several in
// parallel and switch between them.
export type ThreadItem = {
  session: RelaySession;
  /** Agent of an in-flight run for this thread, if any. */
  runningAgent?: AgentName;
};

/** Deletion is safe only after both the session snapshot and daemon report no active run. */
export function canDeleteThread(item: ThreadItem): boolean {
  return item.session.status !== "running" && !item.runningAgent;
}

type Labelled = { title?: string; taskGoal: string };

// The logged-in employee's own threads, newest first. /api/v1/threads is already
// owner-scoped by the backend, but we defensively filter by owner (and drop
// archived/closed ones) so the list never surfaces another employee's work.
export function myThreadSessions(
  sessions: readonly RelaySession[],
  employeeId: string,
): RelaySession[] {
  return sessions
    .filter((s) => !s.archived && (!s.ownerEmployeeId || s.ownerEmployeeId === employeeId))
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// Merge a session returned by a mutation into the cached list, replacing any
// record with the same id. Creating a thread resolves with the new
// session long before the list refetch lands, so the caller seeds it here to
// keep the selection resolvable — otherwise pickActiveThreadSession
// cannot find the selected id and falls back to the most recent thread.
export function upsertThreadSession(
  sessions: readonly RelaySession[],
  session: RelaySession,
): RelaySession[] {
  const others = sessions.filter((candidate) => candidate.id !== session.id);
  return [session, ...others].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function pickActiveThreadSession(input: {
  threads: readonly RelaySession[];
  selectedSessionId?: string;
  activeSessionId: string | null;
  composingNew: boolean;
}): RelaySession | undefined {
  if (input.composingNew) return undefined;
  if (input.selectedSessionId) {
    const selected = input.threads.find((session) => session.id === input.selectedSessionId);
    if (selected) return selected;
  }
  if (input.activeSessionId) {
    const active = input.threads.find((session) => session.id === input.activeSessionId);
    if (active) return active;
  }
  return input.threads[0];
}

// The human-facing label for a thread: the editable title when set,
// otherwise the originating task goal.
export function threadLabel(session: Labelled): string {
  return session.title?.trim() || session.taskGoal;
}

// The distinct agents that have worked a thread — every agent that has a
// run, plus the current one — in first-appearance order so the row's mark
// cluster is deterministic per session and reflects who touched it, in order.
export function sessionAgents(
  session: Pick<RelaySession, "agentRuns" | "currentAgent">,
): AgentName[] {
  const seen = new Set<AgentName>();
  const order: AgentName[] = [];
  const add = (agent: AgentName | undefined) => {
    if (agent && !seen.has(agent)) {
      seen.add(agent);
      order.push(agent);
    }
  };
  for (const run of session.agentRuns ?? []) add(run.agent);
  add(session.currentAgent);
  return order;
}

// Title/goal substring search used by the thread list filter.
export function matchesThreadQuery(session: Labelled, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (session.title?.toLowerCase() ?? "").includes(q) || session.taskGoal.toLowerCase().includes(q);
}
