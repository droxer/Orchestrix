"use client";

import { useCallback, useEffect, useState } from "react";

export function useUrlSearchState<T>(
  key: string,
  fallback: T,
  parse: (value: string | null) => T,
  serialize: (value: T) => string | null,
): [T, (value: T | ((current: T) => T)) => void] {
  const read = useCallback(() => {
    if (typeof window === "undefined") return fallback;
    return parse(new URL(window.location.href).searchParams.get(key));
  }, [fallback, key, parse]);
  const [value, setValue] = useState<T>(read);

  useEffect(() => {
    const sync = () => setValue(read());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
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
      window.history.replaceState(window.history.state, "", url);
      return next;
    });
  }, [key, serialize]);

  return [value, update];
}
