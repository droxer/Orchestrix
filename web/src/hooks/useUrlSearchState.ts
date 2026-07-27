"use client";

import { useCallback, useEffect, useState } from "react";
import { APP_NAVIGATION_EVENT, canonicalBrowserUrl } from "../lib/appRoute";

export function useUrlSearchState<T>(
  key: string,
  fallback: T,
  parse: (value: string | null) => T,
  serialize: (value: T) => string | null,
  historyMode: "replace" | "push" = "replace",
): [T, (value: T | ((current: T) => T)) => void] {
  const read = useCallback(() => {
    if (typeof window === "undefined") return fallback;
    return parse(new URL(window.location.href).searchParams.get(key));
  }, [fallback, key, parse]);
  const [value, setValue] = useState<T>(read);

  useEffect(() => {
    const sync = () => setValue(read());
    window.addEventListener("popstate", sync);
    window.addEventListener(APP_NAVIGATION_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(APP_NAVIGATION_EVENT, sync);
    };
  }, [read]);

  const update = useCallback((nextValue: T | ((current: T) => T)) => {
    setValue((current) => {
      const next = typeof nextValue === "function"
        ? (nextValue as (current: T) => T)(current)
        : nextValue;
      const url = new URL(window.location.href);
      const encoded = serialize(next);
      if (encoded === null) url.searchParams.delete(key);
      else url.searchParams.set(key, encoded);
      const nextUrl = canonicalBrowserUrl(url.pathname, url.search);
      window.history[historyMode === "push" ? "pushState" : "replaceState"](window.history.state, "", nextUrl);
      window.dispatchEvent(new Event(APP_NAVIGATION_EVENT));
      return next;
    });
  }, [historyMode, key, serialize]);

  return [value, update];
}
