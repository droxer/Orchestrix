/**
 * Gesture thresholds for dragging a board card by touch.
 *
 * HTML5 drag-and-drop never fires for touch input, so the board runs its own
 * gesture: press and hold to pick a card up, leaving a plain swipe free to
 * scroll the lane or the board as usual.
 */
export const LONG_PRESS_MS = 320;

/** A finger that travels further than this before the hold completes is scrolling, not dragging. */
export const SCROLL_SLOP_PX = 10;

export interface DragPoint {
  x: number;
  y: number;
}

export function movedBeyondSlop(from: DragPoint, to: DragPoint, slop = SCROLL_SLOP_PX): boolean {
  return Math.abs(to.x - from.x) > slop || Math.abs(to.y - from.y) > slop;
}

/**
 * The board lane under a point, read from the `data-status` of the closest
 * lane element. Returns null when the point is outside every lane.
 */
export function laneStatusAtPoint(root: Document | null, point: DragPoint): string | null {
  // Duck-typed rather than `instanceof Element` so the lookup stays unit
  // testable outside a DOM, and safe against a null hit-test result.
  const element = root?.elementFromPoint(point.x, point.y);
  if (typeof element?.closest !== "function") return null;
  return element.closest<HTMLElement>(".backlog-lane")?.dataset.status ?? null;
}
