"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { APP_NAVIGATION_EVENT, canonicalBrowserUrl } from "../lib/appRoute";
import { parseUrlFilters, writeUrlFilters, type FilterSpec } from "../lib/urlFilters";
import { resolveUrlSearchValue, type UrlSearchStateUpdate } from "../lib/urlSearchState";

/**
 * A whole filter bar in the query string.
 *
 * Same store and same reasoning as `useListSort` and `usePagination`: the
 * filters are part of what the reader is looking at, so they survive opening
 * a record and coming back, and they are linkable. One hook for the whole bar
 * rather than one `useUrlSearchState` per field — a keystroke in the search
 * box would otherwise pay one history write per field.
 *
 * `defaults` and `spec` must be module-level constants: as `useCallback`
 * dependencies, fresh literals each render would re-subscribe the navigation
 * listener on every keystroke.
 */
export function useUrlFilters<T extends { [K in keyof T]: string }>(
  defaults: T,
  spec: FilterSpec<T>,
): [T, (value: UrlSearchStateUpdate<T>) => void] {
  const read = useCallback(() => {
    if (typeof window === "undefined") return defaults;
    return parseUrlFilters(new URL(window.location.href).search, defaults, spec);
  }, [defaults, spec]);
  const [value, setValue] = useState<T>(read);
  const valueRef = useRef(value);

  useEffect(() => {
    const sync = () => {
      const next = read();
      valueRef.current = next;
      setValue(next);
    };
    window.addEventListener("popstate", sync);
    window.addEventListener(APP_NAVIGATION_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(APP_NAVIGATION_EVENT, sync);
    };
  }, [read]);

  const update = useCallback((nextValue: UrlSearchStateUpdate<T>) => {
    const next = resolveUrlSearchValue(valueRef.current, nextValue);
    valueRef.current = next;
    setValue(next);

    const url = new URL(window.location.href);
    writeUrlFilters(url, next, defaults, spec);
    const nextUrl = canonicalBrowserUrl(url.pathname, url.search);
    window.history.replaceState(window.history.state, "", nextUrl);
    window.dispatchEvent(new Event(APP_NAVIGATION_EVENT));
  }, [defaults, spec]);

  return [value, update];
}
