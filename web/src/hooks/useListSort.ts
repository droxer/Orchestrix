"use client";

import { useCallback, useMemo } from "react";
import { useUrlSearchState } from "./useUrlSearchState";
import {
  nextSortState,
  parseSortParam,
  serializeSortParam,
  type SortColumn,
  type SortState,
} from "../lib/listSort";

/**
 * Column-header sort state for a list surface, persisted in the query string.
 *
 * The URL is the store rather than component state so a sorted list survives
 * navigating into a record and back, and so "the overdue ones, oldest first"
 * is a link somebody can paste. It rides the same `useUrlSearchState` seam the
 * surfaces already use for their filters, which means one history entry
 * shape and one popstate listener for the whole bar.
 *
 * `param` defaults to `sort`; pass a distinct name only when two independent
 * lists can be on screen at once.
 */
export function useListSort<T, K extends string>(
  columns: readonly SortColumn<T, K>[],
  param = "sort",
): {
  sort: SortState<K> | null;
  /** Header click: cycles default direction → reversed → unsorted. */
  toggleSort: (key: K) => void;
  /** Direct set, for the narrow-width sort menu, which names a state outright. */
  setSort: (sort: SortState<K> | null) => void;
  clearSort: () => void;
} {
  // Identity-stable across renders so the parse/serialize callbacks below do
  // not re-subscribe the URL listener on every keystroke in the search box.
  const keys = useMemo(() => columns.map((column) => column.key), [columns]);

  const parse = useCallback(
    (value: string | null) => parseSortParam<K>(value, keys),
    [keys],
  );
  const serialize = useCallback((state: SortState<K> | null) => serializeSortParam(state), []);

  const [sort, setSort] = useUrlSearchState<SortState<K> | null>(param, null, parse, serialize);

  const toggleSort = useCallback(
    (key: K) => setSort((current) => nextSortState(current, key, columns)),
    [columns, setSort],
  );
  const clearSort = useCallback(() => setSort(null), [setSort]);

  return { sort, toggleSort, setSort, clearSort };
}
