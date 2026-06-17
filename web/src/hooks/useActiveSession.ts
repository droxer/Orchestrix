import { useCallback, useEffect, useState } from "react";

type SessionLike = { id: string; archived?: boolean; createdAt?: string };

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
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return eligible[0]?.id ?? null;
}

export function useActiveSession(employeeId: string, sessions: readonly SessionLike[]) {
  const key = STORAGE_PREFIX + employeeId;
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeId) {
      setActiveSessionIdState(null);
      return;
    }
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
