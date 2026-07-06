/**
 * Persisted view-mode preference helpers shared by list/board/card pages.
 *
 * SSR-safe (returns the fallback when `window` is undefined) and tolerant of
 * unavailable localStorage — the preference simply falls back to the default.
 */

export function readViewPreference<T extends string>(key: string, fallback: T, values: readonly T[]): T {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    return values.includes(stored as T) ? (stored as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeViewPreference(key: string, view: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, view);
  } catch {
    /* storage unavailable — falls back to default next load */
  }
}
