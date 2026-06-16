import { useEffect, useState } from "react";
import { getMe } from "../api";
import type { CurrentUser } from "../types";

// Owns the authenticated-user session: probes /me once on mount, then exposes
// the current user plus a setter for login/logout transitions. authChecked
// gates the app shell behind a loading state until the probe resolves.
export function useAuthSession(): {
  user: CurrentUser | null;
  authChecked: boolean;
  setUser: (user: CurrentUser | null) => void;
} {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void getMe(controller.signal)
      .then((result) => {
        if (result.authenticated && result.user) {
          setUser(result.user);
        }
      })
      .catch(() => undefined)
      .finally(() => setAuthChecked(true));
    return () => controller.abort();
  }, []);

  return { user, authChecked, setUser };
}
