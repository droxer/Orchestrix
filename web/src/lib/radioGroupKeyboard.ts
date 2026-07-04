import type { KeyboardEvent, MutableRefObject } from "react";

/** Roving-tabindex keyboard handling for an ARIA radiogroup: arrows + Home/End
 *  move the selection and focus together, so the group is one tab stop and the
 *  checked option is the only one reachable by Tab (WAI-ARIA radio pattern). */
export function moveRadioSelection<T>(
  event: KeyboardEvent,
  values: readonly T[],
  current: T,
  refs: MutableRefObject<Map<T, HTMLButtonElement | null>>,
  onChange: (value: T) => void,
): void {
  const index = values.indexOf(current);
  if (index < 0) return;
  let next: number;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown": next = (index + 1) % values.length; break;
    case "ArrowLeft":
    case "ArrowUp":   next = (index - 1 + values.length) % values.length; break;
    case "Home":      next = 0; break;
    case "End":       next = values.length - 1; break;
    default: return;
  }
  event.preventDefault();
  const value = values[next];
  onChange(value);
  refs.current.get(value)?.focus();
}
