/**
 * Filter-bar state in the query string — the same seam sort (`listSort.ts`)
 * and pagination (`pagination.ts`) already ride, generalized to a whole bar:
 * a filtered view survives opening a record and coming back, and "the blocked
 * ones assigned to Fei" is a link somebody can paste.
 *
 * Each field owns ONE query param (?status=blocked, not ?filters=...), so the
 * URL stays readable and the route's ownership registry in `appRoute.ts` can
 * keep foreign params from being echoed. A field at its default is an ABSENCE
 * rather than a value — the URL never advertises a filter that is not set.
 */

export interface FilterFieldSpec {
  /** Query parameter this field owns. */
  param: string;
  /**
   * Enum fields list their real values; anything else in the URL reads as the
   * default. Absent means free text, copied verbatim.
   */
  allowed?: readonly string[];
}

export type FilterSpec<T extends { [K in keyof T]: string }> = {
  [K in keyof T]: FilterFieldSpec;
};

/** Reads the params `spec` owns out of a search string; unset or invalid
 *  values fall back to the field's default. */
export function parseUrlFilters<T extends { [K in keyof T]: string }>(
  search: string | null,
  defaults: T,
  spec: FilterSpec<T>,
): T {
  const params = new URLSearchParams(search ?? "");
  const next = { ...defaults };
  for (const key of Object.keys(spec) as (keyof T)[]) {
    const field = spec[key];
    const value = params.get(field.param);
    if (value === null) continue;
    if (field.allowed && !field.allowed.includes(value)) continue;
    next[key] = value as T[keyof T];
  }
  return next;
}

/** Rewrites `url`'s search so exactly the non-default fields are present.
 *  Params the spec does not own (sort, page cursors) are left alone. */
export function writeUrlFilters<T extends { [K in keyof T]: string }>(
  url: URL,
  next: T,
  defaults: T,
  spec: FilterSpec<T>,
): void {
  for (const key of Object.keys(spec) as (keyof T)[]) {
    const field = spec[key];
    if (next[key] === defaults[key]) url.searchParams.delete(field.param);
    else url.searchParams.set(field.param, next[key]);
  }
}
