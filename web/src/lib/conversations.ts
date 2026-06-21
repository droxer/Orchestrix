import type { RelaySession } from "../types.js";

type Labelled = { title?: string; taskGoal: string };

// The logged-in employee's own conversations, newest first. /sessions is already
// owner-scoped by the backend, but we defensively filter by owner (and drop
// archived/closed ones) so the list never surfaces another employee's work.
export function myConversationSessions(
  sessions: readonly RelaySession[],
  employeeId: string,
): RelaySession[] {
  return sessions
    .filter((s) => !s.archived && (!s.ownerEmployeeId || s.ownerEmployeeId === employeeId))
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// The human-facing label for a conversation: the editable title when set,
// otherwise the originating task goal.
export function conversationLabel(session: Labelled): string {
  return session.title?.trim() || session.taskGoal;
}

// Title/goal substring search used by the conversation list filter.
export function matchesConversationQuery(session: Labelled, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (session.title?.toLowerCase() ?? "").includes(q) || session.taskGoal.toLowerCase().includes(q);
}
