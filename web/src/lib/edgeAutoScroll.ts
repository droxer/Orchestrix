/**
 * Edge auto-scroll for horizontally scrolling drag surfaces.
 *
 * Chrome does not auto-scroll an `overflow-x` container during an HTML5 drag,
 * so a lane parked off-screen is otherwise unreachable — on a 1440px window the
 * task board hides its last ~2.5 lanes, Done among them.
 */
export const EDGE_ZONE_PX = 88;
export const MAX_SCROLL_STEP_PX = 22;

/**
 * Pixels to scroll per frame for a pointer at `clientX`: negative scrolls back,
 * positive scrolls forward, zero holds. Speed ramps with how deep the pointer
 * sits in the edge zone, so nudging the edge creeps and parking on it races.
 */
export function edgeScrollVelocity(bounds: { left: number; right: number }, clientX: number): number {
  const fromLeft = clientX - bounds.left;
  const fromRight = bounds.right - clientX;
  if (fromLeft < EDGE_ZONE_PX) return -stepFor(EDGE_ZONE_PX - fromLeft);
  if (fromRight < EDGE_ZONE_PX) return stepFor(EDGE_ZONE_PX - fromRight);
  return 0;
}

function stepFor(depth: number): number {
  const ratio = Math.min(Math.max(depth, 0), EDGE_ZONE_PX) / EDGE_ZONE_PX;
  return Math.ceil(ratio * MAX_SCROLL_STEP_PX);
}
