export type UrlSearchStateUpdate<T> = T | ((current: T) => T);

export function resolveUrlSearchValue<T>(
  current: T,
  nextValue: UrlSearchStateUpdate<T>,
): T {
  return typeof nextValue === "function"
    ? (nextValue as (current: T) => T)(current)
    : nextValue;
}
