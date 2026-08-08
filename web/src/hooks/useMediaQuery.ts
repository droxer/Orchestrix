"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Subscribe to a CSS media query from JS. Server/off-DOM renders report
 *  `false`, so callers should express the query as the *exception* to the
 *  default layout (e.g. the narrow-screen overlay), not the other way round. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  }, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
