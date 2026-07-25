import { useCallback, useEffect, useRef, useState } from "react";

type SessionLike = { id: string; archived?: boolean; createdAt?: string; updatedAt?: string };

const STORAGE_PREFIX = "relay.activeSession.";

export function pickInitialActiveSessionId(
  stored: string | null,
  sessions: readonly SessionLike[],
): string | null {
  if (stored) {
    const hit = sessions.find((s) => s.id === stored && !s.archived);
    if (hit) return hit.id;
  }
  const eligible = sessions
    .filter((s) => !s.archived)
    .slice()
    .sort((a, b) => (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? ""));
  return eligible[0]?.id ?? null;
}

// Whether the effect below should pick an opening thread. The pick is
// per-employee and one-shot: the session list changes on every poll tick and
// every streamed update, and re-deriving on each of those would drag the
// selection back to the most recent thread — undoing an explicit "new
// thread", which deliberately clears both the selection and its stored
// id. An empty list means the first load has not landed yet, so wait.
export function shouldDeriveActiveSession(input: {
  employeeId: string;
  derivedFor: string | null;
  sessionCount: number;
}): boolean {
  if (!input.employeeId) return false;
  if (input.derivedFor === input.employeeId) return false;
  return input.sessionCount > 0;
}

export function useActiveSession(employeeId: string, sessions: readonly SessionLike[]) {
  const key = STORAGE_PREFIX + employeeId;
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);
  const derivedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!employeeId) {
      derivedForRef.current = null;
      setActiveSessionIdState(null);
      return;
    }
    if (!shouldDeriveActiveSession({
      employeeId,
      derivedFor: derivedForRef.current,
      sessionCount: sessions.length,
    })) return;
    derivedForRef.current = employeeId;
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    setActiveSessionIdState(pickInitialActiveSessionId(stored, sessions));
  }, [employeeId, sessions, key]);

  const setActiveSessionId = useCallback(
    (id: string | null) => {
      setActiveSessionIdState(id);
      if (typeof window === "undefined" || !employeeId) return;
      if (id) window.localStorage.setItem(key, id);
      else window.localStorage.removeItem(key);
    },
    [employeeId, key],
  );

  return { activeSessionId, setActiveSessionId };
}
